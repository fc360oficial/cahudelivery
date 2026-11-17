import 'package:flutter/material.dart';

import '../../app_servicos.dart';
import '../../core/formatadores.dart';
import '../../core/tema.dart';
import '../../data/modelos.dart';
import '../../services/carrinho_service.dart';
import '../../widgets/comuns.dart';
import '../../widgets/foto_produto.dart';
import 'etapa_catalogo.dart' show ControleQuantidade;

/// Produtos que o cliente já comprou (histórico do aparelho), do mais ao menos frequente, com o preço
/// de [tabelaId]. Só entra o que tem estoque e preço. [exceto] tira o produto que está aberto.
Future<List<ProdutoComPreco>> produtosJaComprados(
  AppServicos s, {
  required String clienteId,
  required String tabelaId,
  String? exceto,
  int limite = 12,
}) async {
  final vezes = <String, int>{};
  for (final pedido in await s.historico.porCliente(clienteId)) {
    for (final id in pedido.itens.map((i) => i.produtoId).toSet()) {
      if (id != exceto) vezes[id] = (vezes[id] ?? 0) + 1;
    }
  }
  if (vezes.isEmpty) return [];
  final achados =
      (await s.produtos.buscarPorIds(
          vezes.keys.toList(),
          tabelaId: tabelaId,
        )).where((x) => !x.semPreco && x.produto.estoque > 0).toList()
        ..sort((a, b) {
          final d = vezes[b.produto.id]!.compareTo(vezes[a.produto.id]!);
          return d != 0 ? d : a.produto.nome.compareTo(b.produto.nome);
        });
  return achados.take(limite).toList();
}

/// Tela de um produto: foto grande, valor da caixa, valor da unidade, quantas vêm na caixa, estoque e,
/// dentro de um pedido, a quantidade e os produtos que o cliente já comprou.
class ProdutoPage extends StatefulWidget {
  const ProdutoPage({super.key, required this.item, this.carrinho, this.mostrarPreco = true});
  final ProdutoComPreco item;

  /// Falso quando aberto pelo Catálogo avulso: sem tabela não há preço para mostrar.
  final bool mostrarPreco;

  /// Nulo = somente leitura (aberto pelo Catálogo): sem quantidade nem sugestões.
  final CarrinhoService? carrinho;

  @override
  State<ProdutoPage> createState() => _ProdutoPageState();
}

class _ProdutoPageState extends State<ProdutoPage> {
  List<ProdutoComPreco> _sugeridos = const [];
  bool _iniciou = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_iniciou) return;
    _iniciou = true;
    _carregarSugeridos();
  }

  Future<void> _carregarSugeridos() async {
    final cart = widget.carrinho;
    final cliente = cart?.cliente;
    final tabela = cart?.tabela?.tabela.id;
    if (cliente == null || tabela == null) return;
    try {
      final r = await produtosJaComprados(
        Servicos.of(context),
        clienteId: cliente.id,
        tabelaId: tabela,
        exceto: widget.item.produto.id,
      );
      if (mounted) setState(() => _sugeridos = r);
    } catch (_) {
      /* sem sugestões: a tela do produto continua */
    }
  }

  @override
  Widget build(BuildContext context) {
    final item = widget.item;
    final p = item.produto;
    final cart = widget.carrinho;
    final porCaixa = p.qtdPorEmbalagem > 1;
    final preco = item.preco;
    final emb = _embalagem(p.unidade);
    final lado = (MediaQuery.sizeOf(context).width - 96).clamp(160.0, 280.0);
    return Scaffold(
      backgroundColor: Cores.fundo,
      body: Column(
        children: [
          TopoTela(
            titulo: 'Produto',
            aoVoltar: () => Navigator.of(context).pop(),
          ),
          Expanded(
            child: ListView(
              padding: const EdgeInsets.fromLTRB(16, 14, 16, 20),
              children: [
                Cartao(
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Center(
                          child: FotoProduto(
                            url: p.imagemUrl,
                            lado: lado,
                            raio: 14,
                          ),
                        ),
                        const SizedBox(height: 14),
                        Text(
                          p.nome,
                          key: const Key('produto-nome'),
                          style: const TextStyle(
                            fontSize: 19,
                            fontWeight: FontWeight.w800,
                            color: Cores.marinho,
                            height: 1.2,
                          ),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          [
                            'Cód. ${p.sku}',
                            if ((p.ean ?? '').isNotEmpty) 'EAN ${p.ean}',
                          ].join(' · '),
                          style: const TextStyle(
                            color: Cores.textoSuave,
                            fontSize: 13.5,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 12),
                Cartao(
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(16, 6, 16, 6),
                    child: Column(
                      children: [
                        if (!widget.mostrarPreco)
                          const SizedBox.shrink()
                        else if (preco == null)
                          const _Linha(
                            rotulo: 'Valor',
                            valor: 'sem preço nesta tabela',
                            alerta: true,
                          )
                        else if (porCaixa) ...[
                          _Linha(
                            chave: 'valor-caixa',
                            rotulo: 'Valor ${emb.$1} (${p.unidade})',
                            valor: moeda(preco),
                            forte: true,
                          ),
                          _Linha(
                            chave: 'valor-unidade',
                            rotulo: 'Valor da unidade',
                            valor: moeda(preco / p.qtdPorEmbalagem),
                          ),
                        ] else
                          _Linha(
                            chave: 'valor-caixa',
                            rotulo: 'Valor (${p.unidade})',
                            valor: moeda(preco),
                            forte: true,
                          ),
                        _Linha(
                          chave: 'vem-na-caixa',
                          rotulo: porCaixa ? 'Vem ${emb.$2}' : 'Embalagem',
                          valor: porCaixa
                              ? '${quantidade(p.qtdPorEmbalagem)} unidades'
                              : 'Vendido por unidade',
                        ),
                        _Linha(
                          rotulo: 'Estoque',
                          valor: p.estoque > 0
                              ? '${quantidade(p.estoque)} ${p.unidade}'
                              : 'Sem estoque',
                          alerta: p.estoque <= 0,
                          ultima: true,
                        ),
                      ],
                    ),
                  ),
                ),
                if (_sugeridos.isNotEmpty) ...[
                  const SizedBox(height: 18),
                  const Text(
                    'Este cliente já comprou',
                    style: TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w800,
                      color: Cores.marinho,
                    ),
                  ),
                  const SizedBox(height: 10),
                  for (final sug in _sugeridos) ...[
                    _LinhaSugerido(item: sug, carrinho: cart!),
                    const SizedBox(height: 8),
                  ],
                ],
              ],
            ),
          ),
          if (cart != null && preco != null)
            _BarraQuantidade(item: item, cart: cart),
        ],
      ),
    );
  }
}

/// Nome da embalagem pela unidade de venda do ERP: ("da caixa", "na caixa"), ("do fardo", "no fardo")...
(String, String) _embalagem(String unidade) => switch (unidade.trim().toUpperCase()) {
  'FD' || 'FDO' || 'FARDO' => ('do fardo', 'no fardo'),
  'PC' || 'PCT' || 'PT' || 'PACOTE' => ('do pacote', 'no pacote'),
  'DP' || 'DISPLAY' => ('do display', 'no display'),
  _ => ('da caixa', 'na caixa'),
};

class _Linha extends StatelessWidget {
  const _Linha({
    required this.rotulo,
    required this.valor,
    this.chave,
    this.forte = false,
    this.alerta = false,
    this.ultima = false,
  });
  final String rotulo, valor;
  final String? chave;
  final bool forte, alerta, ultima;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 11),
      decoration: BoxDecoration(
        border: ultima
            ? null
            : const Border(bottom: BorderSide(color: Cores.linha)),
      ),
      child: Row(
        children: [
          Expanded(
            child: Text(
              rotulo,
              style: const TextStyle(color: Cores.textoSuave, fontSize: 14.5),
            ),
          ),
          const SizedBox(width: 12),
          Text(
            valor,
            key: chave == null ? null : Key(chave!),
            style: TextStyle(
              fontSize: forte ? 20 : 15.5,
              fontWeight: forte ? FontWeight.w800 : FontWeight.w700,
              color: alerta ? Cores.erro : Cores.marinho,
            ),
          ),
        ],
      ),
    );
  }
}

/// Linha de produto sugerido: foto, nome, valor da caixa e o botão + (ou − qtd +). Tocar abre o produto.
class _LinhaSugerido extends StatelessWidget {
  const _LinhaSugerido({required this.item, required this.carrinho});
  final ProdutoComPreco item;
  final CarrinhoService carrinho;

  @override
  Widget build(BuildContext context) {
    final p = item.produto;
    return ListenableBuilder(
      listenable: carrinho,
      builder: (context, _) {
        final qtd = carrinho.quantidadeDe(p.id);
        return Cartao(
          child: InkWell(
            key: ValueKey('sugerido-${p.id}'),
            borderRadius: BorderRadius.circular(16),
            onTap: () => Navigator.of(context).pushReplacement(
              MaterialPageRoute(
                builder: (_) => ProdutoPage(item: item, carrinho: carrinho),
              ),
            ),
            child: Padding(
              padding: const EdgeInsets.fromLTRB(10, 8, 6, 8),
              child: Row(
                children: [
                  FotoProduto(url: p.imagemUrl, lado: 54, raio: 10),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          p.nome,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            fontWeight: FontWeight.w600,
                            color: Cores.texto,
                            fontSize: 13.5,
                            height: 1.2,
                          ),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          '${moeda(item.preco!)} / ${p.unidade}',
                          style: const TextStyle(
                            fontWeight: FontWeight.w800,
                            color: Cores.marinho,
                            fontSize: 14.5,
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 6),
                  if (qtd > 0)
                    ControleQuantidade(
                      qtd: qtd,
                      aoMudar: (v) => carrinho.definirQuantidade(item, v),
                    )
                  else
                    IconButton.filled(
                      tooltip: 'Adicionar',
                      style: IconButton.styleFrom(
                        backgroundColor: Cores.azul,
                        minimumSize: const Size(44, 44),
                      ),
                      icon: const Icon(Icons.add_rounded, color: Colors.white),
                      onPressed: () => carrinho.definirQuantidade(item, 1),
                    ),
                ],
              ),
            ),
          ),
        );
      },
    );
  }
}

/// Barra fixa da tela do produto: quantidade no pedido (ou "Adicionar ao pedido") e o total da linha.
class _BarraQuantidade extends StatelessWidget {
  const _BarraQuantidade({required this.item, required this.cart});
  final ProdutoComPreco item;
  final CarrinhoService cart;

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: cart,
      builder: (context, _) {
        final qtd = cart.quantidadeDe(item.produto.id);
        return Container(
          decoration: const BoxDecoration(
            color: Colors.white,
            border: Border(top: BorderSide(color: Cores.linha)),
          ),
          child: SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 10, 16, 10),
              child: qtd <= 0
                  ? FilledButton.icon(
                      key: const Key('produto-adicionar'),
                      onPressed: () => cart.definirQuantidade(item, 1),
                      style: FilledButton.styleFrom(
                        minimumSize: const Size.fromHeight(52),
                      ),
                      icon: const Icon(Icons.add_rounded),
                      label: const Text('Adicionar ao pedido'),
                    )
                  : Row(
                      children: [
                        ControleQuantidade(
                          qtd: qtd,
                          aoMudar: (v) => cart.definirQuantidade(item, v),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.end,
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              const Text(
                                'No pedido',
                                style: TextStyle(
                                  color: Cores.textoSuave,
                                  fontSize: 13,
                                ),
                              ),
                              FittedBox(
                                fit: BoxFit.scaleDown,
                                child: Text(
                                  moeda(item.preco! * qtd),
                                  key: const Key('produto-total-linha'),
                                  style: const TextStyle(
                                    fontSize: 20,
                                    fontWeight: FontWeight.w800,
                                    color: Cores.marinho,
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
            ),
          ),
        );
      },
    );
  }
}
