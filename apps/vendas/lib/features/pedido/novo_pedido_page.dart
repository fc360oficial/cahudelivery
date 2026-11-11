import 'package:flutter/material.dart';

import '../../app_servicos.dart';
import '../../core/formatadores.dart';
import '../../core/tema.dart';
import '../../data/modelos.dart';
import '../../services/carrinho_service.dart';
import 'etapa_catalogo.dart';
import 'etapa_revisao.dart';
import 'etapas_iniciais.dart';

enum EtapaPedido { cliente, tabela, forma, catalogo, revisao }

/// Em que passo um rascunho deve reabrir.
EtapaPedido etapaInicialDo(CarrinhoService c) {
  if (c.cliente == null) return EtapaPedido.cliente;
  if (c.tabela == null) return EtapaPedido.tabela;
  if (c.precisaEscolherForma && c.forma == null) return EtapaPedido.forma;
  return EtapaPedido.catalogo;
}

/// O fluxo do pedido numa tela só: cliente -> tabela -> forma (só se preciso) -> itens -> revisão.
/// O voltar do aparelho volta um passo; no primeiro passo sai (o rascunho fica guardado).
class NovoPedidoPage extends StatefulWidget {
  const NovoPedidoPage({super.key, this.etapaInicial});

  /// Passo em que abre (nulo = o que o rascunho pede: [etapaInicialDo]).
  final EtapaPedido? etapaInicial;

  @override
  State<NovoPedidoPage> createState() => _NovoPedidoPageState();
}

class _NovoPedidoPageState extends State<NovoPedidoPage> {
  EtapaPedido? _etapa;

  CarrinhoService get _cart => Servicos.of(context).carrinho;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_etapa == null) {
      final cart = _cart;
      _etapa = widget.etapaInicial ?? etapaInicialDo(cart);
      final aviso = cart.aviso;
      if (aviso != null) {
        cart.limparAviso();
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(aviso), duration: const Duration(seconds: 6)));
        });
      }
    }
  }

  void _ir(EtapaPedido e) {
    ScaffoldMessenger.of(context).clearSnackBars(); // um aviso do passo anterior não fica por cima da barra do próximo
    setState(() => _etapa = e);
  }

  EtapaPedido? _anterior() => switch (_etapa!) {
        EtapaPedido.cliente => null,
        EtapaPedido.tabela => EtapaPedido.cliente,
        EtapaPedido.forma => EtapaPedido.tabela,
        EtapaPedido.catalogo => _cart.precisaEscolherForma ? EtapaPedido.forma : EtapaPedido.tabela,
        EtapaPedido.revisao => EtapaPedido.catalogo,
      };

  void _voltar() {
    final a = _anterior();
    if (a == null) {
      Navigator.of(context).maybePop();
    } else {
      _ir(a);
    }
  }

  Future<void> _escolherCliente(Cliente c) async {
    final cart = _cart;
    if (cart.cliente?.id != c.id) {
      if (cart.temRascunho && !cart.vazio) {
        final ok = await _confirmar(
          titulo: 'Trocar o cliente?',
          texto: 'Os itens do pedido atual serão descartados, porque os preços dependem do cliente e da tabela.',
          confirmar: 'Trocar cliente',
        );
        if (ok != true || !mounted) return;
      }
      cart.iniciar(c);
    }
    _ir(EtapaPedido.tabela);
  }

  Future<void> _escolherTabela(TabelaComFormas t) async {
    final cart = _cart;
    if (cart.tabela?.tabela.id != t.tabela.id) {
      if (!cart.vazio) {
        final prev = await cart.previsaoTroca(t);
        if (!mounted) return;
        final ok = await _confirmarTroca(prev, t);
        if (ok != true || !mounted) return;
      }
      await cart.escolherTabela(t);
      if (!mounted) return;
    }
    _ir(cart.precisaEscolherForma && cart.forma == null ? EtapaPedido.forma : EtapaPedido.catalogo);
  }

  void _escolherForma(FormaPagamento f) {
    _cart.escolherForma(f);
    _ir(EtapaPedido.catalogo);
  }

  Future<bool?> _confirmar({required String titulo, required String texto, required String confirmar}) {
    return showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(titulo),
        content: Text(texto),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancelar')),
          FilledButton(
              style: FilledButton.styleFrom(minimumSize: const Size(0, 48)),
              onPressed: () => Navigator.pop(ctx, true),
              child: Text(confirmar)),
        ],
      ),
    );
  }

  Future<bool?> _confirmarTroca(PrevisaoTrocaTabela prev, TabelaComFormas nova) {
    return showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Trocar a tabela de preço?'),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Todos os preços do pedido serão recalculados pela tabela "${nova.tabela.nome}".'),
              const SizedBox(height: 12),
              Container(
                key: const Key('troca-totais'),
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(color: Cores.fundo, borderRadius: BorderRadius.circular(12)),
                child: Row(
                  children: [
                    Expanded(child: Text(moeda(prev.totalAtual), style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700))),
                    const Icon(Icons.arrow_forward_rounded, size: 20),
                    Expanded(
                      child: Text(moeda(prev.totalNovo),
                          textAlign: TextAlign.right, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800, color: Cores.azul)),
                    ),
                  ],
                ),
              ),
              if (prev.removidos.isNotEmpty) ...[
                const SizedBox(height: 12),
                Text(
                  prev.removidos.length == 1
                      ? 'Este item não tem preço na nova tabela e será removido:'
                      : 'Estes itens não têm preço na nova tabela e serão removidos:',
                  style: const TextStyle(fontWeight: FontWeight.w700),
                ),
                const SizedBox(height: 4),
                for (final i in prev.removidos) Text('• ${i.produto.nome}', style: const TextStyle(color: Cores.erro)),
              ],
              if (prev.formaPerdida) ...[
                const SizedBox(height: 12),
                const Text('A forma de pagamento escolhida não vale nesta tabela. Você vai escolher de novo.',
                    style: TextStyle(fontWeight: FontWeight.w600)),
              ],
            ],
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancelar')),
          FilledButton(
              style: FilledButton.styleFrom(minimumSize: const Size(0, 48)),
              onPressed: () => Navigator.pop(ctx, true),
              child: const Text('Trocar tabela')),
        ],
      ),
    );
  }

  String get _titulo => switch (_etapa!) {
        EtapaPedido.cliente => 'Escolha o cliente',
        EtapaPedido.tabela => 'Tabela de preço',
        EtapaPedido.forma => 'Forma de pagamento',
        EtapaPedido.catalogo => 'Itens do pedido',
        EtapaPedido.revisao => 'Revisar pedido',
      };

  @override
  Widget build(BuildContext context) {
    final etapa = _etapa!;
    final cart = _cart;
    return PopScope(
      canPop: etapa == EtapaPedido.cliente,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _voltar();
      },
      child: Scaffold(
        appBar: AppBar(
          leading: IconButton(tooltip: 'Voltar', icon: const Icon(Icons.arrow_back_rounded), onPressed: _voltar),
          title: Text(_titulo),
        ),
        body: Column(
          children: [
            _Passos(atual: etapa, cart: cart),
            Expanded(
              child: switch (etapa) {
                EtapaPedido.cliente => EtapaCliente(aoEscolher: _escolherCliente),
                EtapaPedido.tabela => EtapaTabela(aoEscolher: _escolherTabela),
                EtapaPedido.forma => EtapaForma(aoEscolher: _escolherForma),
                EtapaPedido.catalogo => EtapaCatalogo(aoRevisar: () => _ir(EtapaPedido.revisao)),
                EtapaPedido.revisao => EtapaRevisao(aoAdicionarItens: () => _ir(EtapaPedido.catalogo)),
              },
            ),
          ],
        ),
      ),
    );
  }
}

/// Faixa de passos no alto (cliente, tabela, pagamento, itens, revisão).
class _Passos extends StatelessWidget {
  const _Passos({required this.atual, required this.cart});
  final EtapaPedido atual;
  final CarrinhoService cart;

  @override
  Widget build(BuildContext context) {
    const nomes = ['Cliente', 'Tabela', 'Pagamento', 'Itens', 'Revisão'];
    return ListenableBuilder(
      listenable: cart,
      builder: (context, _) {
        return Container(
          color: Cores.marinho,
          padding: const EdgeInsets.fromLTRB(8, 0, 8, 12),
          child: Row(
            children: [
              for (var i = 0; i < nomes.length; i++)
                Expanded(
                  child: Column(
                    children: [
                      Container(
                        height: 4,
                        margin: const EdgeInsets.symmetric(horizontal: 3),
                        decoration: BoxDecoration(
                          color: i <= atual.index ? Cores.amarelo : Colors.white24,
                          borderRadius: BorderRadius.circular(2),
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        nomes[i],
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          fontSize: 11,
                          fontWeight: i == atual.index ? FontWeight.w800 : FontWeight.w500,
                          color: i == atual.index ? Colors.white : Colors.white60,
                        ),
                      ),
                    ],
                  ),
                ),
            ],
          ),
        );
      },
    );
  }
}
