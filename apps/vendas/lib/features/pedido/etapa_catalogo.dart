import 'dart:async';

import 'package:flutter/material.dart';

import '../../app_servicos.dart';
import '../../core/formatadores.dart';
import '../../core/tema.dart';
import '../../data/modelos.dart';
import '../../services/carrinho_service.dart';
import '../../widgets/comuns.dart';
import '../../widgets/foto_produto.dart';
import '../../widgets/seletor_quantidade.dart';

export '../../widgets/foto_produto.dart' show FotoProduto;

/// Passo 4: catálogo da tabela escolhida. Cliente no alto, busca, categorias, produtos em duas
/// colunas (foto, nome, preço da tabela, estoque, botão +) e a barra fixa com itens, total e "Revisar".
class EtapaCatalogo extends StatefulWidget {
  const EtapaCatalogo({
    super.key,
    required this.aoRevisar,
    required this.aoTrocarCliente,
  });
  final VoidCallback aoRevisar;

  /// Tocar no cartão do cliente volta ao passo de escolher o cliente.
  final VoidCallback aoTrocarCliente;

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
    } catch (_) {
      /* sem chips: o catálogo continua */
    }
  }

  void _aoRolar() {
    if (_rolagem.position.pixels > _rolagem.position.maxScrollExtent - 400 &&
        _temMais &&
        !_carregando) {
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
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
          child: Column(
            children: [
              _CartaoCliente(cart: cart, aoTocar: widget.aoTrocarCliente),
              const SizedBox(height: 10),
              CampoBusca(
                chave: const Key('busca-produtos'),
                controlador: _busca,
                dica: 'Buscar produto...',
                aoMudar: (_) {
                  _espera?.cancel();
                  _espera = Timer(
                    const Duration(milliseconds: 250),
                    () => _carregar(reiniciar: true),
                  );
                },
              ),
              SizedBox(
                height: 56,
                child: ListView(
                  scrollDirection: Axis.horizontal,
                  children: [
                    ChipFiltro(
                      rotulo: 'Todos',
                      ativo: _categoria == null,
                      aoTocar: () => _escolherCategoria(null),
                    ),
                    for (final c in _categorias)
                      ChipFiltro(
                        rotulo: c.nome,
                        ativo: _categoria == c.id,
                        aoTocar: () => _escolherCategoria(c.id),
                      ),
                  ],
                ),
              ),
            ],
          ),
        ),
        Expanded(child: _corpo(cart)),
        _BarraPedido(cart: cart, aoRevisar: widget.aoRevisar),
      ],
    );
  }

  Widget _corpo(CarrinhoService cart) {
    if (_erro != null) {
      return EstadoErro(
        mensagem: _erro!,
        aoTentarDeNovo: () => _carregar(reiniciar: true),
      );
    }
    if (_lista.isEmpty) {
      if (_carregando) return const Center(child: CircularProgressIndicator());
      final filtrando = _busca.text.trim().isNotEmpty || _categoria != null;
      return EstadoVazio(
        icone: filtrando
            ? Icons.search_off_rounded
            : Icons.inventory_2_outlined,
        titulo: filtrando ? 'Nenhum produto encontrado' : 'Catálogo vazio',
        texto: filtrando
            ? 'Tente outro nome, código ou categoria.'
            : 'Sincronize o aplicativo para baixar os produtos.',
      );
    }
    return GradeProdutos(
      controlador: _rolagem,
      itens: _lista,
      temMais: _temMais,
      carrinho: cart,
    );
  }
}

/// Cartão do cliente no alto do catálogo: loja, nome, endereço e a seta para trocar de cliente.
class _CartaoCliente extends StatelessWidget {
  const _CartaoCliente({required this.cart, required this.aoTocar});
  final CarrinhoService cart;
  final VoidCallback aoTocar;

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: cart,
      builder: (_, _) {
        final c = cart.cliente;
        final retirada = cart.tipoEntrega == TipoEntrega.retirada;
        final end = c?.endereco?.resumo ?? '';
        final tabela = cart.tabela?.tabela.nome;
        return Cartao(
          key: const Key('cartao-cliente-pedido'),
          child: InkWell(
            borderRadius: BorderRadius.circular(16),
            onTap: aoTocar,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(12, 10, 6, 10),
              child: Row(
                children: [
                  const IconeCaixa(
                    Icons.storefront_rounded,
                    tamanho: 46,
                    redondo: true,
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          c?.nomeFantasia ?? '',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.w800,
                            color: Cores.marinho,
                          ),
                        ),
                        if (end.isNotEmpty)
                          Row(
                            children: [
                              const Icon(
                                Icons.location_on_outlined,
                                size: 15,
                                color: Cores.textoSuave,
                              ),
                              const SizedBox(width: 3),
                              Expanded(
                                child: Text(
                                  end,
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(
                                    color: Cores.textoSuave,
                                    fontSize: 13,
                                  ),
                                ),
                              ),
                            ],
                          ),
                        if (tabela != null)
                          Text(
                            '$tabela · ${retirada ? 'Retirada' : 'Entrega'}',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              color: Cores.azul,
                              fontSize: 12.5,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                      ],
                    ),
                  ),
                  const Icon(Icons.chevron_right_rounded, color: Cores.marinho),
                ],
              ),
            ),
          ),
        );
      },
    );
  }
}

/// Produtos em duas colunas, com a rolagem infinita do catálogo. [carrinho] nulo = somente leitura.
class GradeProdutos extends StatelessWidget {
  const GradeProdutos({
    super.key,
    required this.controlador,
    required this.itens,
    required this.temMais,
    this.carrinho,
  });
  final ScrollController controlador;
  final List<ProdutoComPreco> itens;
  final bool temMais;
  final CarrinhoService? carrinho;

  @override
  Widget build(BuildContext context) {
    final escala = MediaQuery.textScalerOf(context).scale(1);
    return CustomScrollView(
      controller: controlador,
      slivers: [
        SliverPadding(
          padding: const EdgeInsets.fromLTRB(16, 4, 16, 12),
          sliver: SliverGrid(
            gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
              crossAxisCount: 2,
              mainAxisSpacing: 12,
              crossAxisSpacing: 12,
              mainAxisExtent: (carrinho == null ? 186 : 182) + 56 * escala,
            ),
            delegate: SliverChildBuilderDelegate(
              (_, i) => CartaoProduto(item: itens[i], carrinho: carrinho),
              childCount: itens.length,
            ),
          ),
        ),
        if (temMais)
          const SliverToBoxAdapter(
            child: Padding(
              padding: EdgeInsets.all(16),
              child: Center(child: CircularProgressIndicator(strokeWidth: 2.5)),
            ),
          ),
      ],
    );
  }
}

/// Cartão de produto em grade: foto, nome, preço da tabela, estoque e o botão + (vira − qtd + quando
/// o item está no pedido).
class CartaoProduto extends StatelessWidget {
  const CartaoProduto({super.key, required this.item, this.carrinho});
  final ProdutoComPreco item;

  /// Nulo = somente leitura (Catálogo avulso): sem quantidade nem botão de adicionar.
  final CarrinhoService? carrinho;

  @override
  Widget build(BuildContext context) {
    final p = item.produto;
    final semPreco = item.semPreco;
    return ListenableBuilder(
      listenable: carrinho ?? _SemMudanca(),
      builder: (context, _) {
        final carrinho = this.carrinho;
        final qtd = carrinho?.quantidadeDe(p.id) ?? 0;
        final acima = qtd > p.estoque;
        final temEstoque = p.estoque > 0;
        return Opacity(
          opacity: semPreco ? 0.6 : 1,
          child: Cartao(
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(16),
              side: qtd > 0
                  ? const BorderSide(color: Cores.azul, width: 1.5)
                  : BorderSide.none,
            ),
            child: Padding(
              padding: const EdgeInsets.fromLTRB(10, 10, 10, 6),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Center(
                    child: Stack(
                      children: [
                        FotoProduto(url: p.imagemUrl, lado: 88, raio: 10),
                        if (acima)
                          Positioned(
                            left: 0,
                            top: 0,
                            child: Container(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 6,
                                vertical: 2,
                              ),
                              decoration: BoxDecoration(
                                color: Cores.ambar,
                                borderRadius: BorderRadius.circular(8),
                              ),
                              child: const Text(
                                'acima do estoque',
                                style: TextStyle(
                                  color: Colors.white,
                                  fontWeight: FontWeight.w800,
                                  fontSize: 10,
                                ),
                              ),
                            ),
                          ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 6),
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
                  if (semPreco)
                    const Text(
                      'sem preço nesta tabela',
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        color: Cores.erro,
                        fontWeight: FontWeight.w700,
                        fontSize: 13,
                      ),
                    )
                  else
                    FittedBox(
                      fit: BoxFit.scaleDown,
                      alignment: Alignment.centerLeft,
                      child: Text.rich(
                        TextSpan(
                          children: [
                            TextSpan(
                              text: moeda(item.preco!),
                              style: const TextStyle(
                                fontWeight: FontWeight.w800,
                                fontSize: 16,
                                color: Cores.marinho,
                              ),
                            ),
                            TextSpan(
                              text: ' / ${p.unidade}',
                              style: const TextStyle(
                                color: Cores.textoSuave,
                                fontSize: 12,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  const Spacer(),
                  SizedBox(
                    height: 48,
                    child: !semPreco && carrinho != null && qtd > 0
                        ? Center(
                            child: _ControleQuantidade(
                              qtd: qtd,
                              aoMudar: (v) =>
                                  carrinho.definirQuantidade(item, v),
                            ),
                          )
                        : Row(
                            children: [
                              Expanded(
                                child: Text(
                                  temEstoque
                                      ? 'Estoque: ${quantidade(p.estoque)}'
                                      : 'Sem estoque',
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: TextStyle(
                                    fontSize: 12.5,
                                    fontWeight: FontWeight.w600,
                                    color: temEstoque ? Cores.ok : Cores.erro,
                                  ),
                                ),
                              ),
                              if (!semPreco && carrinho != null)
                                Tooltip(
                                  message: 'Adicionar',
                                  child: InkWell(
                                    key: ValueKey('adicionar-${p.id}'),
                                    customBorder: const CircleBorder(),
                                    onTap: () =>
                                        carrinho.definirQuantidade(item, 1),
                                    child: Container(
                                      width: 48,
                                      height: 48,
                                      alignment: Alignment.center,
                                      child: Container(
                                        width: 38,
                                        height: 38,
                                        decoration: const BoxDecoration(
                                          color: Cores.azul,
                                          shape: BoxShape.circle,
                                        ),
                                        child: const Icon(
                                          Icons.add_rounded,
                                          color: Colors.white,
                                          size: 24,
                                        ),
                                      ),
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

/// − qtd + compacto do cartão em grade (alvos de 44 x 48 dp). Tocar na quantidade abre o campo para digitar.
class _ControleQuantidade extends StatelessWidget {
  const _ControleQuantidade({required this.qtd, required this.aoMudar});
  final double qtd;
  final ValueChanged<double> aoMudar;

  @override
  Widget build(BuildContext context) {
    Widget botao(
      IconData i,
      String dica,
      VoidCallback f, {
      bool cheio = false,
    }) => Tooltip(
      message: dica,
      child: InkWell(
        customBorder: const CircleBorder(),
        onTap: f,
        child: SizedBox(
          width: 44,
          height: 48,
          child: Center(
            child: Container(
              width: 30,
              height: 30,
              decoration: BoxDecoration(
                color: cheio ? Cores.azul : Colors.white,
                shape: BoxShape.circle,
                border: cheio
                    ? null
                    : Border.all(color: Cores.azul, width: 1.5),
              ),
              child: Icon(
                i,
                size: 20,
                color: cheio ? Colors.white : Cores.azul,
              ),
            ),
          ),
        ),
      ),
    );
    return Container(
      decoration: BoxDecoration(
        color: Cores.azulClaro,
        borderRadius: BorderRadius.circular(24),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          botao(
            Icons.remove_rounded,
            'Diminuir',
            () => aoMudar(qtd - 1 < 0 ? 0 : qtd - 1),
          ),
          InkWell(
            onTap: () async {
              final v = await SeletorQuantidade.digitar(context, qtd);
              if (v != null) aoMudar(v);
            },
            child: Container(
              constraints: const BoxConstraints(minWidth: 34, minHeight: 48),
              alignment: Alignment.center,
              child: Text(
                quantidade(qtd),
                style: const TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w800,
                  color: Cores.marinho,
                ),
              ),
            ),
          ),
          botao(
            Icons.add_rounded,
            'Aumentar',
            () => aoMudar(qtd + 1),
            cheio: true,
          ),
        ],
      ),
    );
  }
}

/// Notificador que nunca avisa (cartão somente leitura).
class _SemMudanca extends ChangeNotifier {
  _SemMudanca();
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
            boxShadow: [
              BoxShadow(
                color: Color(0x140B1F4B),
                blurRadius: 12,
                offset: Offset(0, -2),
              ),
            ],
          ),
          padding: const EdgeInsets.fromLTRB(16, 10, 16, 10),
          child: Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      cart.qtdItens == 0
                          ? 'Nenhum item'
                          : '${cart.qtdItens} ${cart.qtdItens == 1 ? 'item' : 'itens'}',
                      key: const Key('barra-itens'),
                      style: const TextStyle(
                        color: Cores.textoSuave,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    FittedBox(
                      fit: BoxFit.scaleDown,
                      alignment: Alignment.centerLeft,
                      child: Text(
                        moeda(cart.total),
                        key: const Key('barra-total'),
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
              const SizedBox(width: 12),
              FilledButton(
                key: const Key('revisar'),
                onPressed: cart.vazio ? null : aoRevisar,
                style: FilledButton.styleFrom(minimumSize: const Size(132, 52)),
                child: const Text('Revisar'),
              ),
            ],
          ),
        );
      },
    );
  }
}
