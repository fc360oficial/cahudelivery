import 'dart:async';

import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';

import '../../app_servicos.dart';
import '../../core/formatadores.dart';
import '../../core/tema.dart';
import '../../data/modelos.dart';
import '../../services/carrinho_service.dart';
import '../../widgets/comuns.dart';
import '../../widgets/seletor_quantidade.dart';

/// Passo 4: catálogo da tabela escolhida. Busca, categorias, foto, estoque, preço da tabela,
/// quantidade e a barra fixa com itens, total e "Revisar".
class EtapaCatalogo extends StatefulWidget {
  const EtapaCatalogo({super.key, required this.aoRevisar});
  final VoidCallback aoRevisar;

  @override
  State<EtapaCatalogo> createState() => _EtapaCatalogoState();
}

class _EtapaCatalogoState extends State<EtapaCatalogo> {
  static const _pagina = 30;
  final _busca = TextEditingController();
  final _rolagem = ScrollController();
  Timer? _espera;
  List<Categoria> _categorias = const [];
  String? _categoria;
  final List<ProdutoComPreco> _lista = [];
  bool _carregando = true;
  bool _temMais = true;
  String? _erro;
  int _geracao = 0;
  bool _iniciou = false;

  AppServicos get _s => Servicos.of(context);

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (!_iniciou) {
      _iniciou = true;
      _rolagem.addListener(_aoRolar);
      _carregarCategorias();
      _carregar(reiniciar: true);
    }
  }

  @override
  void dispose() {
    _espera?.cancel();
    _busca.dispose();
    _rolagem.dispose();
    super.dispose();
  }

  Future<void> _carregarCategorias() async {
    try {
      final c = await _s.produtos.categorias();
      if (mounted) setState(() => _categorias = c);
    } catch (_) {/* sem chips: o catálogo continua */}
  }

  void _aoRolar() {
    if (_rolagem.position.pixels > _rolagem.position.maxScrollExtent - 400 && _temMais && !_carregando) {
      _carregar(reiniciar: false);
    }
  }

  Future<void> _carregar({required bool reiniciar}) async {
    final minha = ++_geracao;
    final tabelaId = _s.carrinho.tabela?.tabela.id;
    if (reiniciar) {
      setState(() {
        _carregando = true;
        _erro = null;
      });
    } else {
      setState(() => _carregando = true);
    }
    try {
      final r = await _s.produtos.buscar(
        termo: _busca.text,
        categoriaId: _categoria,
        tabelaId: tabelaId,
        limite: _pagina,
        deslocamento: reiniciar ? 0 : _lista.length,
      );
      if (!mounted || minha != _geracao) return;
      setState(() {
        if (reiniciar) _lista.clear();
        _lista.addAll(r);
        _temMais = r.length == _pagina;
        _carregando = false;
      });
    } catch (_) {
      if (!mounted || minha != _geracao) return;
      setState(() {
        _erro = 'Não foi possível ler o catálogo deste aparelho.';
        _carregando = false;
      });
    }
  }

  void _escolherCategoria(String? id) {
    if (_categoria == id) return;
    setState(() => _categoria = id);
    _carregar(reiniciar: true);
  }

  @override
  Widget build(BuildContext context) {
    final cart = _s.carrinho;
    return Column(
      children: [
        Container(
          color: Colors.white,
          padding: const EdgeInsets.fromLTRB(16, 10, 16, 0),
          child: Column(
            children: [
              _ResumoPedido(cart: cart),
              const SizedBox(height: 8),
              CampoBusca(
                chave: const Key('busca-produtos'),
                controlador: _busca,
                dica: 'Buscar produto, código ou EAN',
                aoMudar: (_) {
                  _espera?.cancel();
                  _espera = Timer(const Duration(milliseconds: 250), () => _carregar(reiniciar: true));
                },
              ),
              SizedBox(
                height: 56,
                child: ListView(
                  scrollDirection: Axis.horizontal,
                  children: [
                    _Chip(rotulo: 'Todos', ativo: _categoria == null, aoTocar: () => _escolherCategoria(null)),
                    for (final c in _categorias) _Chip(rotulo: c.nome, ativo: _categoria == c.id, aoTocar: () => _escolherCategoria(c.id)),
                  ],
                ),
              ),
            ],
          ),
        ),
        const Divider(height: 1),
        Expanded(child: _corpo(cart)),
        _BarraPedido(cart: cart, aoRevisar: widget.aoRevisar),
      ],
    );
  }

  Widget _corpo(CarrinhoService cart) {
    if (_erro != null) return EstadoErro(mensagem: _erro!, aoTentarDeNovo: () => _carregar(reiniciar: true));
    if (_lista.isEmpty) {
      if (_carregando) return const Center(child: CircularProgressIndicator());
      final filtrando = _busca.text.trim().isNotEmpty || _categoria != null;
      return EstadoVazio(
        icone: filtrando ? Icons.search_off_rounded : Icons.inventory_2_outlined,
        titulo: filtrando ? 'Nenhum produto encontrado' : 'Catálogo vazio',
        texto: filtrando ? 'Tente outro nome, código ou categoria.' : 'Sincronize o aplicativo para baixar os produtos.',
      );
    }
    return ListView.separated(
      controller: _rolagem,
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
      itemCount: _lista.length + (_temMais ? 1 : 0),
      separatorBuilder: (_, _) => const SizedBox(height: 8),
      itemBuilder: (_, i) {
        if (i >= _lista.length) {
          return const Padding(padding: EdgeInsets.all(16), child: Center(child: CircularProgressIndicator(strokeWidth: 2.5)));
        }
        return CartaoProduto(item: _lista[i], carrinho: cart);
      },
    );
  }
}

class _Chip extends StatelessWidget {
  const _Chip({required this.rotulo, required this.ativo, required this.aoTocar});
  final String rotulo;
  final bool ativo;
  final VoidCallback aoTocar;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(right: 8),
      child: Center(
        child: ChoiceChip(
          label: Text(rotulo),
          selected: ativo,
          onSelected: (_) => aoTocar(),
          selectedColor: Cores.amarelo,
          labelStyle: TextStyle(fontWeight: FontWeight.w700, color: ativo ? Cores.marinho : Cores.textoSuave),
          materialTapTargetSize: MaterialTapTargetSize.padded,
        ),
      ),
    );
  }
}

/// "Mercado Bom · Entrega · Boleto" no alto do catálogo.
class _ResumoPedido extends StatelessWidget {
  const _ResumoPedido({required this.cart});
  final CarrinhoService cart;

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: cart,
      builder: (_, _) {
        final retirada = cart.tipoEntrega == TipoEntrega.retirada;
        return Row(
          children: [
            Expanded(
              child: Text(
                cart.cliente?.nomeFantasia ?? '',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(fontWeight: FontWeight.w800, color: Cores.marinho),
              ),
            ),
            const SizedBox(width: 8),
            Etiqueta(retirada ? 'Retirada' : 'Entrega', cor: retirada ? Cores.marinho : Cores.azul),
            if (cart.forma != null) ...[const SizedBox(width: 6), Flexible(child: Etiqueta(cart.forma!.descricao, cor: Cores.textoSuave))],
          ],
        );
      },
    );
  }
}

/// Cartão de produto do catálogo: foto, nome, estoque, preço da tabela e quantidade.
class CartaoProduto extends StatelessWidget {
  const CartaoProduto({super.key, required this.item, required this.carrinho});
  final ProdutoComPreco item;
  final CarrinhoService carrinho;

  @override
  Widget build(BuildContext context) {
    final p = item.produto;
    final semPreco = item.semPreco;
    return ListenableBuilder(
      listenable: carrinho,
      builder: (context, _) {
        final qtd = carrinho.quantidadeDe(p.id);
        final acima = qtd > p.estoque;
        return Opacity(
          opacity: semPreco ? 0.55 : 1,
          child: Card(
            color: qtd > 0 ? const Color(0xFFF3F7FF) : Colors.white,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(16),
              side: BorderSide(color: qtd > 0 ? Cores.azul : Cores.linha, width: qtd > 0 ? 1.5 : 1),
            ),
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _Foto(url: p.imagemUrl),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(p.nome, maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w700, color: Cores.texto)),
                        const SizedBox(height: 2),
                        Text(
                          p.estoque > 0 ? 'Estoque: ${quantidade(p.estoque)} ${p.unidade}' : 'Sem estoque',
                          style: TextStyle(fontSize: 12, color: p.estoque > 0 ? Cores.textoSuave : Cores.erro, fontWeight: FontWeight.w600),
                        ),
                        const SizedBox(height: 4),
                        if (semPreco)
                          const Text('sem preço nesta tabela', style: TextStyle(color: Cores.erro, fontWeight: FontWeight.w700, fontSize: 13))
                        else
                          Text.rich(TextSpan(children: [
                            TextSpan(text: moeda(item.preco!), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16, color: Cores.marinho)),
                            TextSpan(text: ' / ${p.unidade}', style: const TextStyle(color: Cores.textoSuave, fontSize: 12)),
                          ])),
                        if (acima)
                          const Padding(
                            padding: EdgeInsets.only(top: 2),
                            child: Text('acima do estoque', style: TextStyle(color: Color(0xFFB26A00), fontWeight: FontWeight.w800, fontSize: 12)),
                          ),
                        if (!semPreco)
                          Align(
                            alignment: Alignment.centerRight,
                            child: qtd == 0
                                ? TextButton.icon(
                                    onPressed: () => carrinho.definirQuantidade(item, 1),
                                    icon: const Icon(Icons.add_rounded),
                                    label: const Text('Adicionar'),
                                    style: TextButton.styleFrom(minimumSize: const Size(48, 48)),
                                  )
                                : SeletorQuantidade(quantidade: qtd, aoMudar: (v) => carrinho.definirQuantidade(item, v)),
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

class _Foto extends StatelessWidget {
  const _Foto({this.url});
  final String? url;

  @override
  Widget build(BuildContext context) {
    const lado = 64.0;
    Widget vazio() => Container(
          width: lado,
          height: lado,
          color: Cores.fundo,
          child: const Icon(Icons.image_outlined, color: Cores.textoSuave),
        );
    return ClipRRect(
      borderRadius: BorderRadius.circular(12),
      child: (url == null || url!.isEmpty)
          ? vazio()
          : CachedNetworkImage(
              imageUrl: url!,
              width: lado,
              height: lado,
              fit: BoxFit.cover,
              placeholder: (_, _) => Container(
                  width: lado,
                  height: lado,
                  color: Cores.fundo,
                  alignment: Alignment.center,
                  child: const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))),
              errorWidget: (_, _, _) => vazio(),
            ),
    );
  }
}

/// Barra fixa: quantas linhas, total e o botão "Revisar".
class _BarraPedido extends StatelessWidget {
  const _BarraPedido({required this.cart, required this.aoRevisar});
  final CarrinhoService cart;
  final VoidCallback aoRevisar;

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: cart,
      builder: (_, _) {
        return Container(
          decoration: const BoxDecoration(
            color: Colors.white,
            border: Border(top: BorderSide(color: Cores.linha)),
            boxShadow: [BoxShadow(color: Color(0x14000000), blurRadius: 12, offset: Offset(0, -2))],
          ),
          child: SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 10, 16, 10),
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          cart.qtdItens == 0 ? 'Nenhum item' : '${cart.qtdItens} ${cart.qtdItens == 1 ? 'item' : 'itens'}',
                          key: const Key('barra-itens'),
                          style: const TextStyle(color: Cores.textoSuave, fontWeight: FontWeight.w600),
                        ),
                        FittedBox(
                          fit: BoxFit.scaleDown,
                          alignment: Alignment.centerLeft,
                          child: Text(moeda(cart.total),
                              key: const Key('barra-total'), style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800, color: Cores.marinho)),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 12),
                  FilledButton(
                    key: const Key('revisar'),
                    onPressed: cart.vazio ? null : aoRevisar,
                    style: FilledButton.styleFrom(minimumSize: const Size(132, 52)),
                    child: const Text('Revisar'),
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
