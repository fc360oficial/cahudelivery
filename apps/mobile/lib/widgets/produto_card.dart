import 'package:flutter/material.dart';

import '../core/api_client.dart';
import '../core/carrinho_store.dart';
import '../core/favoritos_store.dart';
import '../core/formatadores.dart';
import '../core/tenant_theme.dart';
import '../features/auth/entrar_ou_criar_screen.dart';
import '../features/catalog/produto_screen.dart';

/// Card de produto usado nas vitrines da Home (largura fixa) e nas grades
/// de categoria/busca (largura fluida). Preço já vem resolvido pela API
/// (promoção vigente vence a tabela do cliente). Visual estilo Praso: sem
/// moldura de Card, coração/selo de embalagem/botão "+" sobrepostos na foto.
class ProdutoCard extends StatelessWidget {
  const ProdutoCard({super.key, required this.produto, this.largura});

  final Map<String, dynamic> produto;
  final double? largura;

  @override
  Widget build(BuildContext context) {
    final imagens = produto['imagens'] as List?;
    final imagemUrl = (imagens != null && imagens.isNotEmpty) ? imagens.first['url'] as String? : null;
    final emPromocao = produto['preco_promocional'] != null;
    final semEstoque = asDouble(produto['estoque']) <= 0;
    final produtoId = produto['id'] as String;

    return SizedBox(
      width: largura,
      child: Container(
        decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(14)),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: () => Navigator.of(context).push(
            MaterialPageRoute(builder: (_) => ProdutoScreen(produtoId: produtoId)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Stack(
                children: [
                  AspectRatio(
                    aspectRatio: 1.0,
                    child: imagemUrl != null
                        ? Image.network(imagemUrl, fit: BoxFit.cover,
                            errorBuilder: (_, e, s) => _semFoto())
                        : _semFoto(),
                  ),
                  Positioned(top: 8, right: 8, child: _BotaoFavorito(produtoId: produtoId)),
                  Positioned(
                    bottom: 8,
                    left: 8,
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 3),
                      decoration: BoxDecoration(
                        color: Colors.white,
                        borderRadius: BorderRadius.circular(6),
                      ),
                      child: Text(_unidade(produto),
                          style: TextStyle(
                              fontSize: 10.5, fontWeight: FontWeight.w700, color: Colors.grey.shade700)),
                    ),
                  ),
                  if (!semEstoque)
                    Positioned(bottom: 8, right: 8, child: _BotaoAdicionar(produto: produto)),
                ],
              ),
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(10, 8, 10, 10),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      semEstoque
                          ? const Text('Sem estoque',
                              style: TextStyle(
                                  fontSize: 13, fontWeight: FontWeight.w800, color: Colors.grey))
                          : _blocoPreco(produto, emPromocao),
                      const SizedBox(height: 4),
                      Text(
                        produto['nome'] ?? '',
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, height: 1.2),
                      ),
                      _blocoSelos(produto),
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

  static String _formatarData(String iso) {
    final d = DateTime.tryParse(iso);
    if (d == null) return iso;
    return '${d.day.toString().padLeft(2, '0')}/${d.month.toString().padLeft(2, '0')}';
  }

  static bool _estoqueBaixo(Map<String, dynamic> produto) {
    final estoque = asDouble(produto['estoque']);
    final limite = asDouble(TenantTheme.instance.configuracoes['limite_estoque_baixo']);
    return estoque > 0 && limite > 0 && estoque <= limite;
  }

  /// Linha do preço: preto normal, ou verde + "X% OFF" + tabela riscada quando
  /// em promoção — igual ao Praso. Preço do pacote/caixa (quando vendido em
  /// fardo/caixa) logo abaixo, em texto cinza simples (sem fundo colorido).
  static Widget _blocoPreco(Map<String, dynamic> produto, bool emPromocao) {
    final porEmb = asDouble(produto['qtd_por_embalagem']);
    final sigla = siglaUnidade(produto);
    final unit = precoUnitario(produto);
    final precoAtual = asDouble(produto['preco']);
    final precoTabela = asDouble(produto['preco_tabela']);
    final percentual = emPromocao && precoTabela > 0
        ? ((precoTabela - precoAtual) / precoTabela * 100).round()
        : 0;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Wrap(
          spacing: 6,
          runSpacing: 2,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            Text('${moeda(unit)} /un',
                maxLines: 1,
                style: TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w800,
                    color: emPromocao ? Colors.green.shade700 : Colors.black87)),
            if (emPromocao && percentual > 0) ...[
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
                decoration: BoxDecoration(
                  color: Colors.green.shade600,
                  borderRadius: BorderRadius.circular(4),
                ),
                child: Text('$percentual% OFF',
                    style: const TextStyle(
                        color: Colors.white, fontSize: 10, fontWeight: FontWeight.w800)),
              ),
              Text(
                moeda(precoUnitario(produto, campoPreco: 'preco_tabela')),
                style: TextStyle(
                  fontSize: 11,
                  color: Colors.grey.shade500,
                  decoration: TextDecoration.lineThrough,
                ),
              ),
            ],
          ],
        ),
        if (porEmb > 1)
          Padding(
            padding: const EdgeInsets.only(top: 2),
            child: Text('$sigla c/${porEmb.toInt()} ${moeda(produto['preco'])}',
                style: TextStyle(fontSize: 10.5, color: Colors.grey.shade600)),
          ),
      ],
    );
  }

  /// Selos empilhados abaixo do nome: desconto por quantidade, estoque baixo,
  /// validade próxima — mantidos do design anterior.
  static Widget _blocoSelos(Map<String, dynamic> produto) {
    final descontoQtdMinima = produto['desconto_qtd_minima'] as int?;
    final descontoQtdPreco = produto['desconto_qtd_preco'];
    final dataValidade = produto['data_validade'] as String?;
    final selos = <Widget>[];
    if (descontoQtdMinima != null && descontoQtdPreco != null) {
      selos.add(_selo('a partir de $descontoQtdMinima un: ${moeda(descontoQtdPreco)}',
          Colors.green.shade50, Colors.green.shade800));
    }
    if (_estoqueBaixo(produto)) {
      selos.add(_selo('${asDouble(produto['estoque']).toInt()} em estoque',
          Colors.orange.shade50, Colors.orange.shade800));
    }
    if (dataValidade != null) {
      selos.add(_selo('Val. ${_formatarData(dataValidade)}', Colors.red.shade50, Colors.red.shade700));
    }
    if (selos.isEmpty) return const SizedBox.shrink();
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: selos);
  }

  static Widget _selo(String texto, Color fundo, Color cor) {
    return Padding(
      padding: const EdgeInsets.only(top: 3),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
        decoration: BoxDecoration(color: fundo, borderRadius: BorderRadius.circular(6)),
        child: Text(texto, style: TextStyle(fontSize: 10.5, fontWeight: FontWeight.w700, color: cor)),
      ),
    );
  }

  Widget _semFoto() => Container(
        color: Colors.grey.shade100,
        child: Icon(Icons.inventory_2_outlined, size: 40, color: Colors.grey.shade400),
      );
}

/// Coração de favoritar: contorno se não favoritado, preenchido/vermelho se
/// favoritado. Visitante que toca é levado ao gate de login/cadastro (mesmo
/// padrão do checkout, `EntrarOuCriarScreen`) antes de favoritar.
class _BotaoFavorito extends StatefulWidget {
  const _BotaoFavorito({required this.produtoId});
  final String produtoId;

  @override
  State<_BotaoFavorito> createState() => _BotaoFavoritoState();
}

class _BotaoFavoritoState extends State<_BotaoFavorito> {
  bool _enviando = false;

  Future<void> _tocar(BuildContext context) async {
    if (_enviando) return;
    if (!ApiClient.instance.logado) {
      final ok = await Navigator.of(context)
          .push<bool>(MaterialPageRoute(builder: (_) => const EntrarOuCriarScreen()));
      if (ok != true || !context.mounted) return;
    }
    setState(() => _enviando = true);
    try {
      await FavoritosStore.instance.alternar(widget.produtoId);
    } catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
      }
    } finally {
      if (mounted) setState(() => _enviando = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: FavoritosStore.instance,
      builder: (context, _) {
        final ativo = FavoritosStore.instance.favoritado(widget.produtoId);
        return InkWell(
          onTap: () => _tocar(context),
          borderRadius: BorderRadius.circular(20),
          child: Container(
            padding: const EdgeInsets.all(6),
            decoration: const BoxDecoration(color: Colors.white70, shape: BoxShape.circle),
            child: _enviando
                ? const SizedBox(
                    width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                : Icon(
                    ativo ? Icons.favorite : Icons.favorite_border,
                    size: 18,
                    color: ativo ? Colors.red.shade600 : Colors.grey.shade700,
                  ),
          ),
        );
      },
    );
  }
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
