import 'package:flutter/material.dart';

import '../../app_servicos.dart';
import '../../core/formatadores.dart';
import '../../core/tema.dart';
import '../../data/pedido_local.dart';
import '../../data/situacao_pedido.dart';
import '../../widgets/barra_navegacao.dart';
import '../../widgets/comuns.dart';
import '../../widgets/pilulas.dart';
import 'orcamento_detalhe_page.dart';

enum _Filtro {
  todos('Todos'),
  abertos('Abertos'),
  aguardando('Aguardando envio'),
  convertidos('Convertidos'),
  cancelados('Cancelados');

  const _Filtro(this.rotulo);
  final String rotulo;

  bool aceita(SituacaoOrcamento s) => switch (this) {
    _Filtro.todos => true,
    _Filtro.abertos => s == SituacaoOrcamento.aberto,
    _Filtro.aguardando =>
      s == SituacaoOrcamento.aguardandoEnvio || s == SituacaoOrcamento.recusado,
    _Filtro.convertidos => s == SituacaoOrcamento.convertido,
    _Filtro.cancelados => s == SituacaoOrcamento.cancelado,
  };
}

/// Lista de orçamentos (Início > Orçamentos e aba Mais): os do aparelho e os do servidor,
/// reconciliados pelo id do orçamento.
class OrcamentosPage extends StatefulWidget {
  const OrcamentosPage({super.key});

  @override
  State<OrcamentosPage> createState() => _OrcamentosPageState();
}

class _OrcamentosPageState extends State<OrcamentosPage> {
  AppServicos? _s;
  List<({OrcamentoLocal orcamento, String cliente})> _linhas = const [];
  bool _carregando = true;
  String? _erro;
  int _geracao = 0;
  _Filtro _filtro = _Filtro.todos;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final s = Servicos.of(context);
    if (!identical(s, _s)) {
      _s?.pedidos.removeListener(_carregar);
      _s?.fila.removeListener(_carregar);
      _s = s;
      s.pedidos.addListener(_carregar);
      s.fila.addListener(_carregar);
      _carregar();
      s.pedidos.reconciliar();
    }
  }

  @override
  void dispose() {
    _s?.pedidos.removeListener(_carregar);
    _s?.fila.removeListener(_carregar);
    super.dispose();
  }

  Future<void> _carregar() async {
    final minha = ++_geracao;
    final s = _s!;
    try {
      final lista = await s.orcamentosLocais.listar();
      final clientes = {
        for (final c in await s.clientes.buscar()) c.id: c.nomeFantasia,
      };
      if (!mounted || minha != _geracao) return;
      setState(() {
        _linhas = [
          for (final o in lista)
            (
              orcamento: o,
              cliente: clientes[o.clienteId] ?? 'Cliente fora da carteira',
            ),
        ];
        _carregando = false;
        _erro = null;
      });
    } catch (_) {
      if (!mounted || minha != _geracao) return;
      setState(() {
        _carregando = false;
        _erro = 'Não foi possível ler os orçamentos deste aparelho.';
      });
    }
  }

  Future<void> _atualizar() async {
    final s = _s!;
    await s.fila.enviarFila();
    final ok = await s.pedidos.reconciliar();
    if (!mounted || ok) return;
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text(
          'Sem internet. Mostrando os orçamentos salvos no aparelho.',
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final visiveis = _linhas
        .where((l) => _filtro.aceita(situacaoOrcamentoDe(l.orcamento)))
        .toList();
    return Scaffold(
      appBar: AppBar(title: const Text('Orçamentos')),
      bottomNavigationBar: const BarraNavegacaoEmpilhada(
        atual: AbaVendas.pedidos,
      ),
      body: Column(
        children: [
          SizedBox(
            key: const Key('filtros-orcamentos'),
            height: 60,
            child: ListView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 16),
              children: [
                for (final f in _Filtro.values)
                  ChipFiltro(
                    rotulo: f.rotulo,
                    ativo: f == _filtro,
                    aoTocar: () => setState(() => _filtro = f),
                  ),
              ],
            ),
          ),
          Expanded(child: _corpo(visiveis)),
        ],
      ),
    );
  }

  Widget _corpo(List<({OrcamentoLocal orcamento, String cliente})> visiveis) {
    if (_carregando) return const Center(child: CircularProgressIndicator());
    if (_erro != null) {
      return EstadoErro(mensagem: _erro!, aoTentarDeNovo: _carregar);
    }
    return ListaAtualizavel(
      aoAtualizar: _atualizar,
      vazio: _filtro == _Filtro.todos
          ? const EstadoVazio(
              key: Key('vazio-orcamentos'),
              icone: Icons.request_quote_outlined,
              titulo: 'Nenhum orçamento ainda',
              texto:
                  'Na revisão de um pedido, use "Salvar como orçamento". Depois você altera, transforma em pedido ou cancela aqui.',
            )
          : const EstadoVazio(
              key: Key('vazio-filtro'),
              icone: Icons.filter_list_off_rounded,
              titulo: 'Nenhum orçamento neste filtro',
            ),
      itens: [
        for (final l in visiveis) ...[
          LinhaOrcamento(
            orcamento: l.orcamento,
            cliente: l.cliente,
            aoTocar: () => Navigator.of(context).push(
              MaterialPageRoute<void>(
                builder: (_) =>
                    OrcamentoDetalhePage(orcamentoId: l.orcamento.id),
              ),
            ),
          ),
          const SizedBox(height: 8),
        ],
      ],
    );
  }
}

/// Linha da lista de orçamentos: ícone, cliente, data, total e situação.
class LinhaOrcamento extends StatelessWidget {
  const LinhaOrcamento({
    super.key,
    required this.orcamento,
    required this.cliente,
    required this.aoTocar,
  });
  final OrcamentoLocal orcamento;
  final String cliente;
  final VoidCallback aoTocar;

  @override
  Widget build(BuildContext context) {
    final itens = orcamento.itens.length;
    return Cartao(
      margin: EdgeInsets.zero,
      child: InkWell(
        borderRadius: BorderRadius.circular(16),
        onTap: aoTocar,
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: 48),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(12, 12, 8, 12),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const IconeCaixa(Icons.request_quote_rounded, tamanho: 46),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        cliente,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontWeight: FontWeight.w800,
                          color: Cores.marinho,
                          fontSize: 15.5,
                        ),
                      ),
                      Text(
                        '${dataHoraCurta(orcamento.atualizadoEm.toLocal())} · $itens ${itens == 1 ? 'item' : 'itens'}',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          color: Cores.textoSuave,
                          fontSize: 13,
                        ),
                      ),
                      const SizedBox(height: 6),
                      Wrap(
                        spacing: 10,
                        runSpacing: 4,
                        crossAxisAlignment: WrapCrossAlignment.center,
                        children: [
                          PilulaOrcamento(situacaoOrcamentoDe(orcamento)),
                          Text(
                            moeda(orcamento.total),
                            style: const TextStyle(fontWeight: FontWeight.w800, color: Cores.marinho, fontSize: 15),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
                const Padding(
                  padding: EdgeInsets.only(top: 10),
                  child: Icon(
                    Icons.chevron_right_rounded,
                    color: Cores.textoSuave,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
