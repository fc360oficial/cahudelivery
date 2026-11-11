import 'package:flutter/material.dart';

import '../../app_servicos.dart';
import '../../core/formatadores.dart';
import '../../data/modelos.dart';
import 'novo_pedido_page.dart';

/// Ponto de entrada único do "Novo pedido" (botão do Início e detalhe do cliente).
///
/// [cliente] nulo = começa pela escolha do cliente. Se já existe um pedido em andamento com
/// itens, pergunta se continua ou descarta (um rascunho por vez).
Future<void> iniciarNovoPedido(BuildContext context, {Cliente? cliente}) async {
  final cart = Servicos.of(context).carrinho;
  final nav = Navigator.of(context);
  if (cart.temRascunho && !cart.vazio) {
    final decisao = await showDialog<_Decisao>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Você tem um pedido em andamento'),
        content: Text('Pedido de ${cart.cliente!.nomeFantasia} com ${cart.qtdItens} '
            '${cart.qtdItens == 1 ? 'item' : 'itens'} (${moeda(cart.total)}). '
            'Começar outro descarta esse.'),
        actionsOverflowDirection: VerticalDirection.down,
        actionsOverflowAlignment: OverflowBarAlignment.end,
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, _Decisao.cancelar), child: const Text('Cancelar')),
          TextButton(onPressed: () => Navigator.pop(ctx, _Decisao.descartar), child: const Text('Descartar e começar outro')),
          FilledButton(
            style: FilledButton.styleFrom(minimumSize: const Size(0, 48)),
            onPressed: () => Navigator.pop(ctx, _Decisao.continuar),
            child: const Text('Continuar esse pedido'),
          ),
        ],
      ),
    );
    if (decisao == null || decisao == _Decisao.cancelar) return;
    if (decisao == _Decisao.descartar) {
      if (cliente != null) {
        cart.iniciar(cliente);
      } else {
        await cart.limpar();
      }
    }
  } else if (cliente != null) {
    cart.iniciar(cliente);
  }
  await nav.push(MaterialPageRoute<void>(builder: (_) => const NovoPedidoPage()));
}

/// "Continuar pedido de {cliente}" do Início: reabre o rascunho no passo em que parou.
Future<void> continuarPedido(BuildContext context) =>
    Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => const NovoPedidoPage()));

enum _Decisao { continuar, descartar, cancelar }
