import 'dart:async';

import 'package:flutter/material.dart';

import '../../app_servicos.dart';
import '../../core/formatadores.dart';
import '../../core/tema.dart';
import '../../data/modelos.dart';
import '../../widgets/comuns.dart';
import 'cliente_page.dart';

/// Aba Clientes: a carteira do vendedor, com busca por nome, código ou documento.
class ClientesPage extends StatefulWidget {
  const ClientesPage({super.key});

  @override
  State<ClientesPage> createState() => _ClientesPageState();
}

class _ClientesPageState extends State<ClientesPage> {
  final _busca = TextEditingController();
  Timer? _espera;
  List<Cliente>? _lista;
  String? _erro;
  AppServicos? _s;
  int _geracao = 0;

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
      setState(() => _erro = 'Não foi possível ler os clientes deste aparelho.');
    }
  }

  @override
  Widget build(BuildContext context) {
    final temBusca = _busca.text.trim().isNotEmpty;
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
          child: CampoBusca(
              chave: const Key('busca-clientes'),
              controlador: _busca,
              dica: 'Buscar por nome, código ou CNPJ/CPF',
              aoMudar: _aoDigitar),
        ),
        Expanded(
          child: _erro != null
              ? EstadoErro(mensagem: _erro!, aoTentarDeNovo: _carregar)
              : _lista == null
                  ? const Center(child: CircularProgressIndicator())
                  : _lista!.isEmpty
                      ? EstadoVazio(
                          icone: temBusca ? Icons.search_off_rounded : Icons.storefront_outlined,
                          titulo: temBusca ? 'Nenhum cliente encontrado' : 'Sua carteira está vazia',
                          texto: temBusca
                              ? 'Confira o nome, o código ou o documento digitado.'
                              : 'Os clientes da sua carteira aparecem aqui depois da sincronização.')
                      : ListView.separated(
                          padding: const EdgeInsets.fromLTRB(16, 4, 16, 16),
                          itemCount: _lista!.length,
                          separatorBuilder: (_, _) => const SizedBox(height: 8),
                          itemBuilder: (_, i) => LinhaCliente(cliente: _lista![i], agora: _s!.agora()),
                        ),
        ),
      ],
    );
  }
}

/// Cartão de cliente: nome, código, cidade, crédito disponível e última compra.
class LinhaCliente extends StatelessWidget {
  const LinhaCliente({super.key, required this.cliente, required this.agora, this.aoTocar, this.avisoBloqueio = false});
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
    final u = c.ultimaCompra?.toLocal();
    return Card(
      child: InkWell(
        borderRadius: BorderRadius.circular(16),
        onTap: aoTocar ?? () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => ClientePage(clienteId: c.id))),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: Text(c.nomeFantasia,
                        maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800, color: Cores.marinho)),
                  ),
                  if (c.bloqueado) ...[const SizedBox(width: 8), const Etiqueta('Bloqueado', cor: Cores.erro)],
                  if (!c.bloqueado && !c.temCadastroErp) ...[const SizedBox(width: 8), const Etiqueta('Sem cadastro', cor: Cores.erro)],
                ],
              ),
              if (partes.isNotEmpty) Text(partes.join(' · '), style: const TextStyle(color: Cores.textoSuave)),
              const SizedBox(height: 8),
              Wrap(
                alignment: WrapAlignment.spaceBetween,
                spacing: 12,
                runSpacing: 2,
                children: [
                  Text(
                    disp == null ? 'Sem limite cadastrado' : 'Crédito disponível: ${moeda(disp)}',
                    style: TextStyle(fontWeight: FontWeight.w600, color: disp != null && disp < 0 ? Cores.erro : Cores.texto, fontSize: 13),
                  ),
                  Text(u == null ? 'Sem compras' : 'Última compra: ${dataCurta(u)}',
                      style: const TextStyle(color: Cores.textoSuave, fontSize: 13)),
                ],
              ),
              if (avisoBloqueio && (c.bloqueado || !c.temCadastroErp))
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: Text(
                    c.bloqueado ? 'Cliente bloqueado: não é possível fazer pedido.' : 'Cliente sem cadastro no ERP: não é possível vender.',
                    style: const TextStyle(color: Cores.erro, fontWeight: FontWeight.w600, fontSize: 13),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}
