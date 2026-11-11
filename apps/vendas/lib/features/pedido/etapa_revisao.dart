import 'package:flutter/material.dart';

import '../../app_servicos.dart';
import '../../core/formatadores.dart';
import '../../core/mensagens.dart';
import '../../core/tema.dart';
import '../../data/modelos.dart';
import '../../data/pedido_local.dart';
import '../../services/carrinho_service.dart';
import '../../services/fila_envio_service.dart';
import '../../widgets/comuns.dart';
import '../../widgets/seletor_quantidade.dart';
import 'resultado_envio_page.dart';

/// Passo 5: revisão. Cliente, tabela, forma, itens com edição, total, observação,
/// avisos (crédito e dados antigos) e as duas saídas: enviar pedido ou salvar como orçamento.
class EtapaRevisao extends StatefulWidget {
  const EtapaRevisao({super.key, required this.aoAdicionarItens});
  final VoidCallback aoAdicionarItens;

  @override
  State<EtapaRevisao> createState() => _EtapaRevisaoState();
}

class _EtapaRevisaoState extends State<EtapaRevisao> {
  late final TextEditingController _obs;
  bool _iniciou = false;
  bool _ocupado = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (!_iniciou) {
      _iniciou = true;
      _obs = TextEditingController(text: Servicos.of(context).carrinho.observacoes);
    }
  }

  @override
  void dispose() {
    _obs.dispose();
    super.dispose();
  }

  Future<void> _concluir({required bool orcamento}) async {
    if (_ocupado) return;
    final s = Servicos.of(context);
    final cart = s.carrinho;
    if (cart.vazio || cart.cliente == null || cart.tabela == null || cart.forma == null) return;
    cart.definirObservacoes(_obs.text);
    setState(() => _ocupado = true);
    final nomeCliente = cart.cliente!.nomeFantasia;
    final itens = cart.itens.map((i) => i.paraEnvio()).toList();
    final total = cart.total;
    final clienteId = cart.cliente!.id, tabelaId = cart.tabela!.tabela.id, formaId = cart.forma!.id;
    final obs = cart.observacoes;
    final nav = Navigator.of(context);
    try {
      final ResultadoEnvio r;
      if (orcamento) {
        r = await s.fila.salvarOrcamento(
          NovoOrcamento(clienteId: clienteId, tabelaId: tabelaId, formaId: formaId, itens: itens, total: total, observacoes: obs),
          aposGravar: cart.limpar,
        );
      } else {
        r = await s.fila.enviarPedido(
          NovoPedido(
              clienteId: clienteId,
              tabelaId: tabelaId,
              formaId: formaId,
              itens: itens,
              total: total,
              observacoes: obs,
              orcamentoId: cart.orcamentoId),
          aposGravar: cart.limpar,
        );
      }
      await nav.pushReplacement(MaterialPageRoute<void>(builder: (_) => ResultadoEnvioPage(resultado: r, cliente: nomeCliente)));
    } catch (e) {
      if (!mounted) return;
      setState(() => _ocupado = false);
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(mensagemDeErro(e))));
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = Servicos.of(context);
    final cart = s.carrinho;
    return ListenableBuilder(
      listenable: Listenable.merge([cart, s.sincronizacao]),
      builder: (context, _) {
        if (_ocupado) return const Center(child: CircularProgressIndicator());
        final c = cart.cliente;
        final t = cart.tabela;
        if (c == null || t == null || cart.forma == null) {
          return const EstadoVazio(icone: Icons.receipt_long_outlined, titulo: 'Pedido sem dados', texto: 'Volte e escolha cliente, tabela e forma de pagamento.');
        }
        final retirada = t.tabela.tipoEntrega == TipoEntrega.retirada;
        final sync = s.sincronizacao;
        final disp = cart.creditoDisponivel;
        final ultima = sync.ultimaSincronizacao?.toLocal();
        return Column(
          children: [
            Expanded(
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(14),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(c.nomeFantasia, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800, color: Cores.marinho)),
                          if (c.temCadastroErp) Text('Cód. ${c.erpClienteId}', style: const TextStyle(color: Cores.textoSuave)),
                          const Divider(height: 20),
                          LinhaInfo('Tabela', t.tabela.nome),
                          LinhaInfo('Tipo', retirada ? 'Retirada pelo cliente' : 'Entrega'),
                          LinhaInfo('Pagamento', cart.forma!.descricao),
                          if (cart.formaAutomatica)
                            const Align(
                              alignment: Alignment.centerRight,
                              child: Text('única forma desta tabela', style: TextStyle(color: Cores.textoSuave, fontSize: 12)),
                            ),
                        ],
                      ),
                    ),
                  ),
                  if (sync.dadosAntigos && ultima != null) ...[
                    const SizedBox(height: 12),
                    CaixaAviso(
                      key: const Key('aviso-precos-antigos'),
                      texto: 'Preços podem estar desatualizados. Última sincronização: ${dataHoraCurta(ultima)}.',
                    ),
                  ],
                  if (disp != null) ...[
                    const SizedBox(height: 12),
                    CaixaAviso(
                      key: const Key('aviso-credito'),
                      tom: cart.passaDoLimite ? TomAviso.atencao : TomAviso.info,
                      texto: cart.passaDoLimite
                          ? 'Este pedido passa do limite disponível. Ele pode ficar retido para você confirmar.\nCrédito disponível: ${moeda(disp)}.'
                          : 'Crédito disponível do cliente: ${moeda(disp)}.',
                    ),
                  ],
                  const SizedBox(height: 16),
                  Row(
                    children: [
                      const Expanded(child: TituloSecao('ITENS')),
                      TextButton.icon(
                        onPressed: widget.aoAdicionarItens,
                        icon: const Icon(Icons.add_rounded),
                        label: const Text('Adicionar itens'),
                        style: TextButton.styleFrom(minimumSize: const Size(48, 48)),
                      ),
                    ],
                  ),
                  for (final i in cart.itens) ...[
                    _LinhaItem(item: i, carrinho: cart),
                    const SizedBox(height: 8),
                  ],
                  const SizedBox(height: 8),
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(14),
                      child: Row(
                        children: [
                          Expanded(
                            child: Text('Total · ${cart.qtdItens} ${cart.qtdItens == 1 ? 'item' : 'itens'}',
                                style: const TextStyle(fontWeight: FontWeight.w700)),
                          ),
                          Text(moeda(cart.total),
                              key: const Key('revisao-total'), style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800, color: Cores.marinho)),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(height: 16),
                  const TituloSecao('OBSERVAÇÃO (OPCIONAL)'),
                  TextField(
                    key: const Key('observacao'),
                    controller: _obs,
                    maxLength: 500,
                    maxLines: 3,
                    minLines: 2,
                    textCapitalization: TextCapitalization.sentences,
                    onChanged: cart.definirObservacoes,
                    decoration: const InputDecoration(hintText: 'Ex.: entregar pela manhã'),
                  ),
                  const SizedBox(height: 8),
                ],
              ),
            ),
            Container(
              decoration: const BoxDecoration(color: Colors.white, border: Border(top: BorderSide(color: Cores.linha))),
              child: SafeArea(
                top: false,
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(16, 10, 16, 10),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      FilledButton(
                        key: const Key('enviar-pedido'),
                        onPressed: _ocupado || cart.vazio ? null : () => _concluir(orcamento: false),
                        child: _ocupado
                            ? const SizedBox(height: 22, width: 22, child: CircularProgressIndicator(strokeWidth: 2.5, color: Colors.white))
                            : const Text('Enviar pedido'),
                      ),
                      const SizedBox(height: 8),
                      OutlinedButton(
                        key: const Key('salvar-orcamento'),
                        onPressed: _ocupado || cart.vazio ? null : () => _concluir(orcamento: true),
                        child: const Text('Salvar como orçamento'),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ],
        );
      },
    );
  }
}

class _LinhaItem extends StatelessWidget {
  const _LinhaItem({required this.item, required this.carrinho});
  final ItemCarrinho item;
  final CarrinhoService carrinho;

  @override
  Widget build(BuildContext context) {
    final p = item.produto;
    return Card(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(14, 10, 6, 6),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(child: Text(p.nome, maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w700))),
                IconButton(
                  tooltip: 'Remover item',
                  constraints: const BoxConstraints(minWidth: 48, minHeight: 48),
                  icon: const Icon(Icons.delete_outline_rounded, color: Cores.erro),
                  onPressed: () => carrinho.remover(p.id),
                ),
              ],
            ),
            Text('${moeda(item.precoUnit)} / ${p.unidade}', style: const TextStyle(color: Cores.textoSuave, fontSize: 13)),
            if (item.acimaDoEstoque)
              Padding(
                padding: const EdgeInsets.only(top: 2),
                child: Text('acima do estoque (há ${quantidade(p.estoque)})',
                    style: const TextStyle(color: Color(0xFFB26A00), fontWeight: FontWeight.w800, fontSize: 12)),
              ),
            Row(
              children: [
                SeletorQuantidade(quantidade: item.quantidade, aoMudar: (v) => carrinho.alterarQuantidade(p.id, v)),
                const Spacer(),
                Padding(
                  padding: const EdgeInsets.only(right: 8),
                  child: Text(moeda(item.total), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16, color: Cores.marinho)),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
