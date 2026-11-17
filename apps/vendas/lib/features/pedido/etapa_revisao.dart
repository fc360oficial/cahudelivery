import 'package:flutter/material.dart';

import '../../app_servicos.dart';
import '../../core/dinheiro.dart';
import '../../core/formatadores.dart';
import '../../core/mensagens.dart';
import '../../core/tema.dart';
import '../../data/modelos.dart';
import '../../data/pedido_local.dart';
import '../../services/carrinho_service.dart';
import '../../services/fila_envio_service.dart';
import '../../widgets/comuns.dart';
import '../../widgets/foto_produto.dart';
import '../../widgets/seletor_quantidade.dart';
import 'resultado_envio_page.dart';

/// Passo 5: revisão. Cliente, tabela, forma, itens com edição, total, observação,
/// avisos (crédito e dados antigos) e as duas saídas: enviar pedido ou salvar como orçamento.
class EtapaRevisao extends StatefulWidget {
  const EtapaRevisao({
    super.key,
    required this.aoAdicionarItens,
    required this.aoTrocarForma,
  });
  final VoidCallback aoAdicionarItens;

  /// Abre o passo da forma de pagamento (só quando a tabela aceita mais de uma).
  final VoidCallback aoTrocarForma;

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
      _obs = TextEditingController(
        text: Servicos.of(context).carrinho.observacoes,
      );
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
    if (cart.vazio ||
        cart.cliente == null ||
        cart.tabela == null ||
        cart.forma == null) {
      return;
    }
    cart.definirObservacoes(_obs.text);
    setState(() => _ocupado = true);
    final nomeCliente = cart.cliente!.nomeFantasia;
    final itens = cart.itens.map((i) => i.paraEnvio()).toList();
    final total = cart.total;
    final clienteId = cart.cliente!.id,
        tabelaId = cart.tabela!.tabela.id,
        formaId = cart.forma!.id;
    final obs = cart.observacoes;
    final nav = Navigator.of(context);
    try {
      final ResultadoEnvio r;
      if (orcamento) {
        r = await s.fila.salvarOrcamento(
          NovoOrcamento(
            clienteId: clienteId,
            tabelaId: tabelaId,
            formaId: formaId,
            itens: itens,
            total: total,
            observacoes: obs,
          ),
          id: cart.orcamentoId, // orçamento editado: o MESMO id (PUT)
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
            orcamentoId: cart.orcamentoId,
          ),
          aposGravar: cart.limpar,
        );
      }
      await nav.pushReplacement(
        MaterialPageRoute<void>(
          builder: (_) =>
              ResultadoEnvioPage(resultado: r, cliente: nomeCliente),
        ),
      );
    } catch (e) {
      if (!mounted) return;
      setState(() => _ocupado = false);
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(mensagemDeErro(e))));
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
          return const EstadoVazio(
            icone: Icons.receipt_long_outlined,
            titulo: 'Pedido sem dados',
            texto: 'Volte e escolha cliente, tabela e forma de pagamento.',
          );
        }
        final retirada = t.tabela.tipoEntrega == TipoEntrega.retirada;
        final sync = s.sincronizacao;
        final disp = cart.creditoDisponivel;
        final ultima = sync.ultimaSincronizacao?.toLocal();
        return SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
            if (sync.dadosAntigos && ultima != null) ...[
              CaixaAviso(
                key: const Key('aviso-precos-antigos'),
                texto:
                    'Preços podem estar desatualizados. Última sincronização: ${dataHoraCurta(ultima)}.',
              ),
              const SizedBox(height: 12),
            ],
            if (cart.totalAnterior != null &&
                arredondar(cart.totalAnterior!) != arredondar(cart.total)) ...[
              CaixaAviso(
                key: const Key('aviso-total-mudou'),
                texto:
                    'O total mudou desde o orçamento: era ${moeda(cart.totalAnterior!)} e agora é ${moeda(cart.total)}, '
                    'com os preços atuais da tabela.',
              ),
              const SizedBox(height: 12),
            ],
            if (cart.bloqueadoPorTitulo) ...[
              const CaixaAviso(
                key: Key('aviso-titulo-vencido'),
                tom: TomAviso.atencao,
                texto:
                    'Cliente com título vencido: não é possível enviar pedido até regularizar. '
                    'Você pode salvar como orçamento.',
              ),
              const SizedBox(height: 12),
            ],
            if (disp != null) ...[
              CaixaAviso(
                key: const Key('aviso-credito'),
                tom: cart.passaDoLimite ? TomAviso.atencao : TomAviso.info,
                texto: cart.passaDoLimite
                    ? 'Este pedido passa do limite disponível. Ele pode ficar retido para você confirmar.\nCrédito disponível: ${moeda(disp)}.'
                    : 'Crédito disponível do cliente: ${moeda(disp)}.',
              ),
              const SizedBox(height: 12),
            ],
            Row(
              children: [
                const Icon(
                  Icons.storefront_rounded,
                  color: Cores.azul,
                  size: 20,
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    c.nomeFantasia,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w800,
                      color: Cores.marinho,
                    ),
                  ),
                ),
                IconButton(
                  key: const Key('adicionar-itens'),
                  tooltip: 'Adicionar itens',
                  onPressed: widget.aoAdicionarItens,
                  icon: const Icon(Icons.add_circle_outline_rounded, color: Cores.azul, size: 26),
                ),
              ],
            ),
            Cartao(
              clipBehavior: Clip.antiAlias,
              child: Column(
                children: [
                  for (var i = 0; i < cart.itens.length; i++) ...[
                    if (i > 0)
                      const Divider(height: 1, indent: 12, endIndent: 12),
                    _LinhaItem(item: cart.itens[i], carrinho: cart),
                  ],
                  const Divider(height: 1),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(16, 14, 16, 14),
                    child: Row(
                      children: [
                        Expanded(
                          child: Text(
                            'Subtotal · ${cart.qtdItens} ${cart.qtdItens == 1 ? 'item' : 'itens'}',
                            style: const TextStyle(
                              fontSize: 15,
                              fontWeight: FontWeight.w600,
                              color: Cores.texto,
                            ),
                          ),
                        ),
                        Text(
                          moeda(cart.total),
                          key: const Key('revisao-subtotal'),
                          style: const TextStyle(
                            fontSize: 15,
                            fontWeight: FontWeight.w700,
                            color: Cores.texto,
                          ),
                        ),
                      ],
                    ),
                  ),
                  Container(
                    color: Cores.azulClaro,
                    padding: const EdgeInsets.fromLTRB(16, 14, 16, 14),
                    child: Row(
                      children: [
                        const Expanded(
                          child: Text(
                            'Total do pedido',
                            style: TextStyle(
                              fontSize: 17,
                              fontWeight: FontWeight.w800,
                              color: Cores.marinho,
                            ),
                          ),
                        ),
                        Text(
                          moeda(cart.total),
                          key: const Key('revisao-total'),
                          style: const TextStyle(
                            fontSize: 24,
                            fontWeight: FontWeight.w800,
                            color: Cores.marinho,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 12),
            Cartao(
              key: const Key('cartao-pagamento'),
              child: InkWell(
                borderRadius: BorderRadius.circular(16),
                onTap: t.formas.length > 1 ? widget.aoTrocarForma : null,
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(14, 12, 10, 12),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          const IconeCaixa(
                            Icons.calendar_month_outlined,
                            tamanho: 42,
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                const Text(
                                  'Forma de pagamento',
                                  style: TextStyle(
                                    color: Cores.textoSuave,
                                    fontSize: 13,
                                  ),
                                ),
                                Text(
                                  cart.forma!.descricao,
                                  style: const TextStyle(
                                    fontSize: 17,
                                    fontWeight: FontWeight.w700,
                                    color: Cores.marinho,
                                  ),
                                ),
                              ],
                            ),
                          ),
                          if (t.formas.length > 1)
                            const Icon(
                              Icons.chevron_right_rounded,
                              color: Cores.marinho,
                            ),
                        ],
                      ),
                      const SizedBox(height: 8),
                      Text(
                        'Tabela ${t.tabela.nome} · ${retirada ? 'Retirada pelo cliente' : 'Entrega'}',
                        style: const TextStyle(
                          color: Cores.textoSuave,
                          fontSize: 13,
                        ),
                      ),
                      if (cart.formaAutomatica)
                        const Text(
                          'única forma desta tabela',
                          style: TextStyle(
                            color: Cores.textoSuave,
                            fontSize: 12,
                          ),
                        ),
                    ],
                  ),
                ),
              ),
            ),
            const SizedBox(height: 12),
            Cartao(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(14, 12, 14, 4),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const IconeCaixa(
                      Icons.chat_bubble_outline_rounded,
                      tamanho: 42,
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text(
                            'Observações (opcional)',
                            style: TextStyle(
                              color: Cores.textoSuave,
                              fontSize: 13,
                            ),
                          ),
                          TextField(
                            key: const Key('observacao'),
                            controller: _obs,
                            maxLength: 500,
                            maxLines: 3,
                            minLines: 1,
                            textCapitalization: TextCapitalization.sentences,
                            onChanged: cart.definirObservacoes,
                            style: const TextStyle(fontSize: 16),
                            decoration: const InputDecoration(
                              hintText: 'Digite aqui...',
                              hintStyle: TextStyle(color: Cores.textoSuave),
                              counterText: '',
                              filled: false,
                              border: InputBorder.none,
                              enabledBorder: InputBorder.none,
                              focusedBorder: InputBorder.none,
                              isDense: true,
                              contentPadding: EdgeInsets.symmetric(vertical: 8),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 18),
            FilledButton.icon(
              key: const Key('enviar-pedido'),
              onPressed: _ocupado || cart.vazio || cart.bloqueadoPorTitulo
                  ? null
                  : () => _concluir(orcamento: false),
              icon: _ocupado
                  ? const SizedBox(
                      height: 22,
                      width: 22,
                      child: CircularProgressIndicator(
                        strokeWidth: 2.5,
                        color: Colors.white,
                      ),
                    )
                  : const Icon(Icons.check_rounded, size: 26),
              label: const Text('Enviar pedido'),
            ),
            const SizedBox(height: 10),
            OutlinedButton(
              key: const Key('salvar-orcamento'),
              onPressed: _ocupado || cart.vazio
                  ? null
                  : () => _concluir(orcamento: true),
              child: const Text('Salvar como orçamento'),
            ),
            ],
          ),
        );
      },
    );
  }
}

/// Linha de item da revisão: foto, nome e preço, − qtd + e o total da linha. Em tela estreita ou com
/// fonte grande o controle e o total descem para uma segunda linha.
class _LinhaItem extends StatelessWidget {
  const _LinhaItem({required this.item, required this.carrinho});
  final ItemCarrinho item;
  final CarrinhoService carrinho;

  @override
  Widget build(BuildContext context) {
    final p = item.produto;
    final escala = MediaQuery.textScalerOf(context).scale(1);
    final controle = SeletorQuantidadeCompacto(
      quantidade: item.quantidade,
      aoMudar: (v) => carrinho.alterarQuantidade(p.id, v),
    );
    final total = Text(
      moeda(item.total),
      maxLines: 1,
      style: const TextStyle(
        fontWeight: FontWeight.w800,
        fontSize: 15,
        color: Cores.marinho,
      ),
    );
    return LayoutBuilder(
      builder: (context, c) {
        final uma = c.maxWidth >= 340 && escala <= 1.15;
        final nome = Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              p.nome,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                fontWeight: FontWeight.w600,
                fontSize: 14,
                color: Cores.texto,
                height: 1.2,
              ),
            ),
            Text(
              '${moeda(item.precoUnit)} / ${p.unidade}',
              style: const TextStyle(color: Cores.textoSuave, fontSize: 13),
            ),
            if (item.acimaDoEstoque)
              Text(
                'acima do estoque (há ${quantidade(p.estoque)})',
                style: const TextStyle(
                  color: Cores.ambar,
                  fontWeight: FontWeight.w800,
                  fontSize: 12,
                ),
              ),
          ],
        );
        return Padding(
          padding: const EdgeInsets.fromLTRB(12, 8, 12, 8),
          child: uma
              ? Row(
                  children: [
                    FotoProduto(url: p.imagemUrl, lado: 48, raio: 8),
                    const SizedBox(width: 10),
                    Expanded(child: nome),
                    const SizedBox(width: 6),
                    controle,
                    SizedBox(
                      width: 76,
                      child: Align(
                        alignment: Alignment.centerRight,
                        child: FittedBox(fit: BoxFit.scaleDown, child: total),
                      ),
                    ),
                  ],
                )
              : Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        FotoProduto(url: p.imagemUrl, lado: 48, raio: 8),
                        const SizedBox(width: 10),
                        Expanded(child: nome),
                      ],
                    ),
                    Row(children: [controle, const Spacer(), total]),
                  ],
                ),
        );
      },
    );
  }
}
