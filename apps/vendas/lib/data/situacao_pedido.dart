import '../core/dinheiro.dart';
import 'pedido_local.dart';

/// Situação mostrada ao vendedor (pílula da lista). Junta o estado local do pedido com o
/// `status` que o servidor devolveu.
enum SituacaoPedido {
  naFila('Na fila'),
  enviando('Enviando'),
  retido('Retido'),
  aguardandoErp('Aguardando o ERP'),
  noErp('No ERP'),
  faturado('Faturado'),
  cancelado('Cancelado'),
  recusado('Recusado');

  const SituacaoPedido(this.rotulo);
  final String rotulo;
}

/// Filtros (chips) da lista de pedidos.
enum FiltroPedido {
  todos('Todos'),
  naFila('Na fila'),
  retidos('Retidos'),
  enviados('Enviados'),
  faturados('Faturados'),
  encerrados('Cancelados e recusados');

  const FiltroPedido(this.rotulo);
  final String rotulo;

  bool aceita(SituacaoPedido s) => switch (this) {
        FiltroPedido.todos => true,
        FiltroPedido.naFila => s == SituacaoPedido.naFila || s == SituacaoPedido.enviando,
        FiltroPedido.retidos => s == SituacaoPedido.retido,
        FiltroPedido.enviados => s == SituacaoPedido.aguardandoErp || s == SituacaoPedido.noErp,
        FiltroPedido.faturados => s == SituacaoPedido.faturado,
        FiltroPedido.encerrados => s == SituacaoPedido.cancelado || s == SituacaoPedido.recusado,
      };
}

/// Situação de um pedido local. Enviado: o `status` do servidor decide entre "Aguardando o ERP"
/// (RECEBIDO), "No ERP" (já foi para o ERP) e "Faturado" (faturado em diante).
SituacaoPedido situacaoDe(PedidoLocal p) {
  switch (p.estado) {
    case EstadoPedido.aguardandoEnvio:
      return SituacaoPedido.naFila;
    case EstadoPedido.enviando:
      return SituacaoPedido.enviando;
    case EstadoPedido.retido:
      return SituacaoPedido.retido;
    case EstadoPedido.recusado:
      return SituacaoPedido.recusado;
    case EstadoPedido.cancelado:
      return SituacaoPedido.cancelado;
    default:
      return switch ((p.statusServidor ?? 'RECEBIDO').toUpperCase()) {
        'ENVIADO_ERP' || 'ABERTO' || 'EM_FATURAMENTO' => SituacaoPedido.noErp,
        'FATURADO' || 'EM_SEPARACAO' || 'SAIU_ENTREGA' || 'ENTREGUE' => SituacaoPedido.faturado,
        'CANCELADO' => SituacaoPedido.cancelado,
        _ => SituacaoPedido.aguardandoErp,
      };
  }
}

/// Itens do pedido retido com o preço ATUAL (o das divergências de preço), para mostrar
/// o novo total se o vendedor confirmar. Nulo quando o aparelho não tem os itens.
double? totalSeConfirmar(PedidoLocal p) {
  final itens = p.itens;
  if (itens.isEmpty) return null;
  final atuais = {
    for (final d in p.divergencias)
      if (d.tipo == 'preco' && d.produtoId != null && d.atual != null) d.produtoId!: d.atual!,
  };
  return somarLinhas(itens.map((i) => totalLinha(atuais[i.produtoId] ?? i.precoUnit, i.quantidade)));
}

/// Itens com o preço atual das divergências aplicado (o que o servidor passa a guardar ao confirmar).
List<ItemEnvio> itensComPrecoAtual(PedidoLocal p) {
  final atuais = {
    for (final d in p.divergencias)
      if (d.tipo == 'preco' && d.produtoId != null && d.atual != null) d.produtoId!: d.atual!,
  };
  return [for (final i in p.itens) ItemEnvio(produtoId: i.produtoId, quantidade: i.quantidade, precoUnit: atuais[i.produtoId] ?? i.precoUnit)];
}

/// Situação de um orçamento local.
enum SituacaoOrcamento {
  aberto('Aberto'),
  aguardandoEnvio('Aguardando envio'),
  convertido('Convertido'),
  cancelado('Cancelado'),
  recusado('Recusado');

  const SituacaoOrcamento(this.rotulo);
  final String rotulo;
}

SituacaoOrcamento situacaoOrcamentoDe(OrcamentoLocal o) => switch (o.estado) {
      EstadoOrcamento.local => SituacaoOrcamento.aguardandoEnvio,
      EstadoOrcamento.convertido => SituacaoOrcamento.convertido,
      EstadoOrcamento.cancelado => SituacaoOrcamento.cancelado,
      EstadoOrcamento.recusado => SituacaoOrcamento.recusado,
      _ => SituacaoOrcamento.aberto,
    };
