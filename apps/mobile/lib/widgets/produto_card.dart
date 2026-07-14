import 'package:flutter/material.dart';

import '../core/carrinho_store.dart';
import '../core/formatadores.dart';
import '../features/catalog/produto_screen.dart';

/// Card de produto usado nas vitrines da Home (largura fixa) e nas grades
/// de categoria/busca (largura fluida). Preço já vem resolvido pela API
/// (promoção vigente vence a tabela do cliente).
class ProdutoCard extends StatelessWidget {
  const ProdutoCard({super.key, required this.produto, this.largura});

  final Map<String, dynamic> produto;
  final double? largura;

  @override
  Widget build(BuildContext context) {
    final tema = Theme.of(context).colorScheme;
    final imagens = produto['imagens'] as List?;
    final imagemUrl = (imagens != null && imagens.isNotEmpty) ? imagens.first['url'] as String? : null;
    final emPromocao = produto['preco_promocional'] != null;
    final semEstoque = asDouble(produto['estoque']) <= 0;

    return SizedBox(
      width: largura,
      child: Card(
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: () => Navigator.of(context).push(
            MaterialPageRoute(builder: (_) => ProdutoScreen(produtoId: produto['id'] as String)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Stack(
                children: [
                  AspectRatio(
                    aspectRatio: 1.15,
                    child: imagemUrl != null
                        ? Image.network(imagemUrl, fit: BoxFit.cover,
                            errorBuilder: (_, e, s) => _semFoto())
                        : _semFoto(),
                  ),
                  if (emPromocao)
                    Positioned(
                      top: 8,
                      left: 8,
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                        decoration: BoxDecoration(
                          color: Colors.red.shade600,
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: const Text('OFERTA',
                            style: TextStyle(
                                color: Colors.white, fontSize: 10, fontWeight: FontWeight.w800)),
                      ),
                    ),
                ],
              ),
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(10, 8, 10, 10),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        produto['nome'] ?? '',
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, height: 1.2),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        _unidade(produto),
                        style: TextStyle(fontSize: 11, color: Colors.grey.shade600),
                      ),
                      const Spacer(),
                      if (emPromocao)
                        Text(
                          moeda(produto['preco_tabela']),
                          style: TextStyle(
                            fontSize: 11,
                            color: Colors.grey.shade500,
                            decoration: TextDecoration.lineThrough,
                          ),
                        ),
                      Row(
                        crossAxisAlignment: CrossAxisAlignment.end,
                        children: [
                          Expanded(
                            child: Text(
                              semEstoque ? 'Sem estoque' : moeda(produto['preco']),
                              style: TextStyle(
                                fontSize: semEstoque ? 13 : 16,
                                fontWeight: FontWeight.w800,
                                color: semEstoque
                                    ? Colors.grey.shade500
                                    : (emPromocao ? Colors.red.shade600 : tema.primary),
                              ),
                            ),
                          ),
                          if (!semEstoque) _BotaoAdicionar(produto: produto),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  static String _unidade(Map<String, dynamic> p) {
    final un = p['unidade_venda'] ?? 'UN';
    final porEmb = asDouble(p['qtd_por_embalagem']);
    return porEmb > 1 ? '$un c/ ${porEmb.toInt()}' : '$un';
  }

  Widget _semFoto() => Container(
        color: Colors.grey.shade100,
        child: Icon(Icons.inventory_2_outlined, size: 40, color: Colors.grey.shade400),
      );
}

/// Adição rápida no card: "+" quando o item não está no carrinho; quando já
/// está, vira um mini stepper "− qtd +" (menos abaixo da qtd mínima remove).
class _BotaoAdicionar extends StatefulWidget {
  const _BotaoAdicionar({required this.produto});
  final Map<String, dynamic> produto;

  @override
  State<_BotaoAdicionar> createState() => _BotaoAdicionarState();
}

class _BotaoAdicionarState extends State<_BotaoAdicionar> {
  bool _enviando = false;

  Future<void> _mudar(double delta) async {
    if (_enviando) return;
    final store = CarrinhoStore.instance;
    final id = widget.produto['id'] as String;
    final minima = asDouble(widget.produto['qtd_minima']);
    final min = minima > 1 ? minima : 1.0;
    final atual = store.quantidadeDe(id);
    double nova;
    if (atual <= 0) {
      nova = min;
    } else {
      nova = atual + delta;
      if (nova < min) nova = 0; // abaixo do mínimo remove do carrinho
    }
    setState(() => _enviando = true);
    try {
      await store.definirQuantidade(id, nova);
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(e.toString())),
        );
      }
    } finally {
      if (mounted) setState(() => _enviando = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return ListenableBuilder(
      listenable: CarrinhoStore.instance,
      builder: (context, _) {
        final qtd = CarrinhoStore.instance.quantidadeDe(widget.produto['id'] as String);
        if (qtd <= 0) {
          return SizedBox(
            height: 32,
            child: FilledButton(
              style: FilledButton.styleFrom(
                minimumSize: const Size(32, 32),
                padding: EdgeInsets.zero,
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                backgroundColor: scheme.primary,
              ),
              onPressed: _enviando ? null : () => _mudar(1),
              child: _enviando
                  ? SizedBox(
                      width: 14, height: 14,
                      child: CircularProgressIndicator(
                          strokeWidth: 2, color: scheme.onPrimary))
                  : const Icon(Icons.add, size: 18),
            ),
          );
        }
        Widget acao(IconData icone, double delta) => InkWell(
              onTap: _enviando ? null : () => _mudar(delta),
              borderRadius: BorderRadius.circular(10),
              child: SizedBox(
                width: 26,
                height: 32,
                child: Icon(icone, size: 15, color: scheme.onPrimary),
              ),
            );
        return Container(
          height: 32,
          decoration: BoxDecoration(
            color: scheme.primary,
            borderRadius: BorderRadius.circular(10),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              acao(Icons.remove, -1),
              _enviando
                  ? SizedBox(
                      width: 14, height: 14,
                      child: CircularProgressIndicator(
                          strokeWidth: 2, color: scheme.onPrimary))
                  : Text(qtd % 1 == 0 ? qtd.toInt().toString() : '$qtd',
                      style: TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w800,
                          color: scheme.onPrimary)),
              acao(Icons.add, 1),
            ],
          ),
        );
      },
    );
  }
}
