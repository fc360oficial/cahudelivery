import 'dart:async';

import 'package:flutter/material.dart';

import '../../app_servicos.dart';
import '../../core/formatadores.dart';
import '../../core/tema.dart';
import '../../data/modelos.dart';
import '../../widgets/comuns.dart';
import '../shell/home_shell.dart';
import 'cliente_page.dart';

/// Aba Clientes ("Minha carteira"): a carteira do vendedor, com busca por nome, código ou documento
/// e os filtros Todos, Sem venda no mês, Ativos e Inativos.
class ClientesPage extends StatefulWidget {
  const ClientesPage({super.key});

  @override
  State<ClientesPage> createState() => _ClientesPageState();
}

enum _Filtro {
  todos('Todos'),
  semVenda('Sem venda no mês'),
  ativos('Ativos'),
  inativos('Inativos');

  const _Filtro(this.rotulo);
  final String rotulo;

  /// "Sem venda no mês": nenhum pedido válido do cliente desde o dia 1 do mês de [agora].
  bool aceita(Cliente c, DateTime agora) => switch (this) {
    _Filtro.todos => true,
    _Filtro.semVenda => semVendaNoMes(c, agora),
    _Filtro.ativos => !c.bloqueado,
    _Filtro.inativos => c.bloqueado,
  };
}

/// Verdadeiro quando o cliente não tem pedido (não cancelado) no mês corrente.
bool semVendaNoMes(Cliente c, DateTime agora) {
  final u = c.ultimaCompra?.toLocal();
  final a = agora.toLocal();
  return u == null || u.isBefore(DateTime(a.year, a.month));
}

class _ClientesPageState extends State<ClientesPage> {
  final _busca = TextEditingController();
  final _foco = FocusNode();
  Timer? _espera;
  List<Cliente>? _lista;
  String? _erro;
  AppServicos? _s;
  int _geracao = 0;
  _Filtro _filtro = _Filtro.todos;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final s = Servicos.of(context);
    if (!identical(s, _s)) {
      _s?.sincronizacao.cargaVersao.removeListener(_carregar);
      _s = s;
      s.sincronizacao.cargaVersao.addListener(_carregar);
      _carregar();
    }
  }

  @override
  void dispose() {
    _espera?.cancel();
    _s?.sincronizacao.cargaVersao.removeListener(_carregar);
    _busca.dispose();
    _foco.dispose();
    super.dispose();
  }

  void _aoDigitar(String _) {
    _espera?.cancel();
    _espera = Timer(const Duration(milliseconds: 250), _carregar);
  }

  Future<void> _carregar() async {
    final minha = ++_geracao;
    try {
      final r = await _s!.clientes.buscar(termo: _busca.text);
      if (!mounted || minha != _geracao) return;
      setState(() {
        _lista = r;
        _erro = null;
      });
    } catch (e) {
      if (!mounted || minha != _geracao) return;
      setState(
        () => _erro = 'Não foi possível ler os clientes deste aparelho.',
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final temBusca = _busca.text.trim().isNotEmpty;
    final filtrando = temBusca || _filtro != _Filtro.todos;
    final agora = _s!.agora();
    final visiveis = _lista?.where((c) => _filtro.aceita(c, agora)).toList();
    final semVenda = _lista?.where((c) => semVendaNoMes(c, agora)).length;
    return Column(
      children: [
        TopoTela(
          titulo: 'Minha carteira',
          aoVoltar: () => HomeShell.ativo?.irPara(AbaVendas.inicio),
          acoes: [
            IconButton(
              tooltip: 'Buscar',
              color: Colors.white,
              icon: const Icon(Icons.search_rounded),
              onPressed: _foco.requestFocus,
            ),
          ],
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 14, 16, 0),
          child: CampoBusca(
            chave: const Key('busca-clientes'),
            controlador: _busca,
            foco: _foco,
            dica: 'Nome, razão social, CNPJ ou CPF',
            aoMudar: _aoDigitar,
          ),
        ),
        SizedBox(
          key: const Key('filtros-clientes'),
          height: 56,
          child: ListView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 16),
            children: [
              for (final f in _Filtro.values)
                ChipFiltro(
                  rotulo: f == _Filtro.semVenda && semVenda != null ? '${f.rotulo} ($semVenda)' : f.rotulo,
                  ativo: f == _filtro,
                  aoTocar: () => setState(() => _filtro = f),
                ),
            ],
          ),
        ),
        Expanded(
          child: _erro != null
              ? EstadoErro(mensagem: _erro!, aoTentarDeNovo: _carregar)
              : visiveis == null
              ? const Center(child: CircularProgressIndicator())
              : visiveis.isEmpty
              ? EstadoVazio(
                  icone: filtrando
                      ? Icons.search_off_rounded
                      : Icons.storefront_outlined,
                  titulo: filtrando
                      ? 'Nenhum cliente encontrado'
                      : 'Sua carteira está vazia',
                  texto: filtrando
                      ? 'Confira o nome, o código, o documento ou o filtro.'
                      : 'Os clientes da sua carteira aparecem aqui depois da sincronização.',
                )
              : ListView.separated(
                  padding: const EdgeInsets.fromLTRB(16, 4, 16, 16),
                  itemCount: visiveis.length,
                  separatorBuilder: (_, _) => const SizedBox(height: 10),
                  itemBuilder: (_, i) =>
                      LinhaCliente(cliente: visiveis[i], agora: _s!.agora()),
                ),
        ),
      ],
    );
  }
}

/// A pílula de situação do cliente: Ativo (verde), Pendente (laranja) ou Bloqueado (vermelho).
Widget etiquetaDoCliente(Cliente c) {
  if (c.status == 'aprovado') {
    return c.temCadastroErp
        ? const Etiqueta('Ativo', cor: Cores.ok)
        : const Etiqueta('Sem cadastro', cor: Cores.ambar);
  }
  if (c.status.toLowerCase().startsWith('pend')) {
    return const Etiqueta('Pendente', cor: Cores.ambar);
  }
  return const Etiqueta('Bloqueado', cor: Cores.erro);
}

/// Cartão de cliente: ícone de loja, nome, última compra, crédito disponível, situação e seta.
class LinhaCliente extends StatelessWidget {
  const LinhaCliente({
    super.key,
    required this.cliente,
    required this.agora,
    this.aoTocar,
    this.avisoBloqueio = false,
  });
  final Cliente cliente;
  final DateTime agora;

  /// Padrão: abre o detalhe do cliente.
  final VoidCallback? aoTocar;

  /// Mostra o motivo escrito quando o cliente não pode receber pedido.
  final bool avisoBloqueio;

  @override
  Widget build(BuildContext context) {
    final c = cliente;
    final cidade = c.endereco?.cidade;
    final partes = [
      if (c.temCadastroErp) 'Cód. ${c.erpClienteId}',
      if (cidade != null && cidade.isNotEmpty) cidade,
    ];
    final disp = c.creditoDisponivel;
    final negativo = disp != null && disp < 0;
    final u = c.ultimaCompra?.toLocal();
    const suave = TextStyle(color: Cores.textoSuave, fontSize: 13.5);
    return Cartao(
      child: InkWell(
        borderRadius: BorderRadius.circular(16),
        onTap:
            aoTocar ??
            () => Navigator.of(context).push(
              MaterialPageRoute(builder: (_) => ClientePage(clienteId: c.id)),
            ),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(12, 12, 8, 12),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const IconeCaixa(
                Icons.storefront_rounded,
                tamanho: 50,
                redondo: true,
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      c.nomeFantasia,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w800,
                        color: Cores.marinho,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      u == null
                          ? 'Sem compras'
                          : 'Última compra: ${dataCompleta(u)}',
                      style: suave,
                    ),
                    Text(
                      disp == null
                          ? 'Sem limite cadastrado'
                          : 'Disponível: ${moeda(disp)}',
                      style: TextStyle(
                        fontSize: 13.5,
                        color: negativo ? Cores.erro : Cores.textoSuave,
                        fontWeight: negativo
                            ? FontWeight.w700
                            : FontWeight.w400,
                      ),
                    ),
                    if (partes.isNotEmpty)
                      Text(partes.join(' · '), style: suave),
                    if (c.temTituloVencido && !avisoBloqueio)
                      const Text(
                        'Título vencido: sem pedido novo',
                        style: TextStyle(
                          color: Cores.erro,
                          fontWeight: FontWeight.w700,
                          fontSize: 13,
                        ),
                      ),
                    if (avisoBloqueio && c.motivoSemPedido != null)
                      Padding(
                        padding: const EdgeInsets.only(top: 6),
                        child: Text(
                          c.motivoSemPedido!,
                          style: const TextStyle(
                            color: Cores.erro,
                            fontWeight: FontWeight.w600,
                            fontSize: 13,
                          ),
                        ),
                      ),
                  ],
                ),
              ),
              const SizedBox(width: 6),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  etiquetaDoCliente(c),
                  const SizedBox(height: 14),
                  const Icon(
                    Icons.chevron_right_rounded,
                    color: Cores.textoSuave,
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}
