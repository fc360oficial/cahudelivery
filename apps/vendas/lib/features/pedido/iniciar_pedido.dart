import 'package:flutter/material.dart';

import '../../app_servicos.dart';
import '../../core/formatadores.dart';
import '../../data/modelos.dart';
import '../../data/pedido_local.dart';
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

/// Abre o fluxo do pedido com o rascunho montado a partir de um orçamento ou de um pedido recusado
/// ("Editar", "Transformar em pedido", "Editar e reenviar"). Preços sempre os atuais da tabela.
/// Falso quando não abriu (cliente/tabela sumiram do aparelho, ou o vendedor desistiu).
///
/// [aoMontar] roda depois do rascunho montado e antes de abrir a tela (ex.: tirar o pedido recusado da lista).
Future<bool> abrirRascunho(
  BuildContext context, {
  required String clienteId,
  required String? tabelaId,
  String? formaId,
  required List<ItemEnvio> itens,
  String? observacoes,
  String? orcamentoId,
  double? totalAnterior,
  String? avisoInicial,
  EtapaPedido etapa = EtapaPedido.revisao,
  Future<void> Function()? aoMontar,
}) async {
  final s = Servicos.of(context);
  final nav = Navigator.of(context);
  final msg = ScaffoldMessenger.of(context);
  final cart = s.carrinho;
  final cliente = await s.clientes.porId(clienteId);
  final tabela = tabelaId == null ? null : await s.tabelas.porId(tabelaId);
  if (cliente == null || tabela == null) {
    msg.showSnackBar(const SnackBar(
        content: Text('O cliente ou a tabela deste pedido não existem mais neste aparelho. Sincronize e tente de novo.')));
    return false;
  }
  if (!context.mounted) return false;
  if (cart.temRascunho && !cart.vazio) {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Você tem um pedido em andamento'),
        content: Text('O pedido de ${cart.cliente!.nomeFantasia} em andamento será descartado para abrir este.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancelar')),
          FilledButton(
              style: FilledButton.styleFrom(minimumSize: const Size(0, 48)),
              onPressed: () => Navigator.pop(ctx, true),
              child: const Text('Descartar e abrir')),
        ],
      ),
    );
    if (ok != true) return false;
  }
  await cart.carregar(
    cliente: cliente,
    tabela: tabela,
    formaId: formaId,
    itens: itens,
    observacoes: observacoes,
    orcamentoId: orcamentoId,
    totalAnterior: totalAnterior,
    avisoInicial: avisoInicial,
  );
  await aoMontar?.call();
  final inicio = etapaInicialDo(cart);
  final destino = cart.vazio || !cart.prontoParaCatalogo ? inicio : etapa;
  await nav.push(MaterialPageRoute<void>(builder: (_) => NovoPedidoPage(etapaInicial: destino)));
  return true;
}

enum _Decisao { continuar, descartar, cancelar }
