import 'dart:convert';

import '../core/formatadores.dart';

double _d(Object? v) => v == null ? 0 : (v as num).toDouble();

/// Estados de `pedidos_locais.estado`.
class EstadoPedido {
  EstadoPedido._();
  static const aguardandoEnvio = 'aguardando_envio';
  static const enviando = 'enviando';
  static const enviado = 'enviado';
  static const retido = 'retido';
  static const recusado = 'recusado';
  static const cancelado = 'cancelado';
}

/// Estados de `orcamentos_locais.estado`.
class EstadoOrcamento {
  EstadoOrcamento._();
  static const local = 'local';
  static const sincronizado = 'sincronizado';
  static const recusado = 'recusado';
  static const cancelado = 'cancelado';
  static const convertido = 'convertido';
}

/// Linha do pedido/orçamento como vai para o servidor (`itens[]` do corpo).
class ItemEnvio {
  const ItemEnvio({required this.produtoId, required this.quantidade, required this.precoUnit});
  final String produtoId;
  final double quantidade, precoUnit;

  Map<String, Object?> toJson() => {'produtoId': produtoId, 'quantidade': quantidade, 'precoUnit': precoUnit};
  factory ItemEnvio.fromJson(Map<String, dynamic> j) =>
      ItemEnvio(produtoId: j['produtoId'] as String, quantidade: _d(j['quantidade']), precoUnit: _d(j['precoUnit']));
}

/// Dados de um pedido pronto para entrar na fila (a fila gera o `idDispositivo`).
class NovoPedido {
  const NovoPedido({
    required this.clienteId,
    required this.tabelaId,
    required this.formaId,
    required this.itens,
    required this.total,
    this.observacoes,
    this.orcamentoId,
  });
  final String clienteId, tabelaId, formaId;
  final List<ItemEnvio> itens;
  final double total;
  final String? observacoes, orcamentoId;
}

/// Dados de um orçamento pronto para entrar na fila. [formaId] é opcional.
class NovoOrcamento {
  const NovoOrcamento({
    required this.clienteId,
    required this.tabelaId,
    required this.itens,
    required this.total,
    this.formaId,
    this.observacoes,
  });
  final String clienteId, tabelaId;
  final String? formaId, observacoes;
  final List<ItemEnvio> itens;
  final double total;
}

/// Corpo exato do `POST /vendas/pedidos`. NÃO leva `tipoEntrega`: quem manda é a tabela.
Map<String, Object?> corpoDoPedido({
  required String idDispositivo,
  required NovoPedido pedido,
  required DateTime criadoNoAparelhoEm,
}) =>
    {
      'idDispositivo': idDispositivo,
      'clienteId': pedido.clienteId,
      'tabelaPrecoId': pedido.tabelaId,
      'formaPagamentoId': pedido.formaId,
      if ((pedido.observacoes ?? '').trim().isNotEmpty) 'observacoes': pedido.observacoes!.trim(),
      if (pedido.orcamentoId != null) 'orcamentoId': pedido.orcamentoId,
      'criadoNoAparelhoEm': criadoNoAparelhoEm.toUtc().toIso8601String(),
      'itens': pedido.itens.map((i) => i.toJson()).toList(),
    };

/// Corpo exato do `PUT /vendas/orcamentos/:id`.
Map<String, Object?> corpoDoOrcamento(NovoOrcamento o) => {
      'clienteId': o.clienteId,
      'tabelaPrecoId': o.tabelaId,
      if (o.formaId != null) 'formaPagamentoId': o.formaId,
      if ((o.observacoes ?? '').trim().isNotEmpty) 'observacoes': o.observacoes!.trim(),
      'itens': o.itens.map((i) => i.toJson()).toList(),
    };

/// Divergência devolvida pelo servidor quando retém um pedido
/// (`tipo`: preco | sem_preco | estoque | credito).
class Divergencia {
  const Divergencia({required this.tipo, this.produtoId, this.nome, this.enviado, this.atual});
  final String tipo;
  final String? produtoId, nome;
  final double? enviado, atual;

  factory Divergencia.fromJson(Map<String, dynamic> j) => Divergencia(
        tipo: '${j['tipo']}',
        produtoId: j['produtoId'] as String?,
        nome: j['nome'] as String?,
        enviado: (j['enviado'] as num?)?.toDouble(),
        atual: (j['atual'] as num?)?.toDouble(),
      );

  Map<String, Object?> toJson() =>
      {'tipo': tipo, 'produtoId': produtoId, 'nome': nome, 'enviado': enviado, 'atual': atual};

  /// Rótulo curto do motivo.
  String get titulo => switch (tipo) {
        'preco' => 'Preço mudou',
        'sem_preco' => 'Produto sem preço',
        'estoque' => 'Sem estoque suficiente',
        'credito' => 'Limite de crédito',
        _ => 'Divergência',
      };

  /// Frase completa com os valores "enviado → atual".
  String get descricao {
    final n = nome ?? 'Produto';
    return switch (tipo) {
      'preco' => '$n: o preço mudou de ${moeda(enviado ?? 0)} para ${moeda(atual ?? 0)}.',
      'sem_preco' => '$n: não tem mais preço nesta tabela.',
      'estoque' => '$n: você pediu ${quantidade(enviado ?? 0)} e há ${quantidade(atual ?? 0)} em estoque.',
      'credito' =>
        'Limite de crédito: o pedido é de ${moeda(enviado ?? 0)} e o disponível é ${moeda(atual ?? 0)}.',
      _ => n,
    };
  }
}

List<Divergencia> divergenciasDe(Object? resposta) {
  if (resposta is! Map) return const [];
  final l = resposta['divergencias'];
  if (l is! List) return const [];
  return l.map((e) => Divergencia.fromJson(Map<String, dynamic>.from(e as Map))).toList();
}

/// Linha de `pedidos_locais`. Estados em [EstadoPedido].
class PedidoLocal {
  const PedidoLocal({
    required this.id,
    required this.vendedorId,
    required this.clienteId,
    this.tabelaId,
    this.formaId,
    required this.total,
    required this.estado,
    required this.corpo,
    this.resposta,
    this.motivo,
    this.codigoErro,
    this.servidorNumero,
    this.tentativas = 0,
    required this.criadoEm,
    required this.atualizadoEm,
    this.enviadoEm,
  });

  /// UUID do aparelho = `idDispositivo` do corpo.
  final String id, vendedorId, clienteId, estado;
  final String? tabelaId, formaId, motivo, codigoErro;
  final double total;
  final Map<String, dynamic> corpo;
  final Map<String, dynamic>? resposta;
  final int? servidorNumero;
  final int tentativas;
  final DateTime criadoEm, atualizadoEm;
  final DateTime? enviadoEm;

  List<ItemEnvio> get itens =>
      ((corpo['itens'] as List?) ?? const []).map((e) => ItemEnvio.fromJson(Map<String, dynamic>.from(e as Map))).toList();
  String? get observacoes => corpo['observacoes'] as String?;

  /// Divergências da resposta do servidor (retido).
  List<Divergencia> get divergencias => divergenciasDe(resposta);

  /// Id do pedido no servidor (para confirmar/cancelar o retido).
  String? get servidorId => resposta?['id'] as String?;

  /// Total que vale agora: o do servidor quando ele respondeu, senão o do aparelho.
  double get totalServidor => resposta?['total'] == null ? total : _d(resposta!['total']);

  Map<String, Object?> toRow() => {
        'id': id,
        'vendedor_id': vendedorId,
        'cliente_id': clienteId,
        'tabela_id': tabelaId,
        'forma_id': formaId,
        'total': total,
        'estado': estado,
        'corpo_json': jsonEncode(corpo),
        'resposta_json': resposta == null ? null : jsonEncode(resposta),
        'motivo': motivo,
        'codigo_erro': codigoErro,
        'servidor_numero': servidorNumero,
        'tentativas': tentativas,
        'criado_em': criadoEm.toUtc().toIso8601String(),
        'atualizado_em': atualizadoEm.toUtc().toIso8601String(),
        'enviado_em': enviadoEm?.toUtc().toIso8601String(),
      };

  factory PedidoLocal.fromRow(Map<String, Object?> r) => PedidoLocal(
        id: r['id'] as String,
        vendedorId: r['vendedor_id'] as String,
        clienteId: r['cliente_id'] as String,
        tabelaId: r['tabela_id'] as String?,
        formaId: r['forma_id'] as String?,
        total: _d(r['total']),
        estado: r['estado'] as String,
        corpo: Map<String, dynamic>.from(jsonDecode(r['corpo_json'] as String) as Map),
        resposta: r['resposta_json'] == null ? null : Map<String, dynamic>.from(jsonDecode(r['resposta_json'] as String) as Map),
        motivo: r['motivo'] as String?,
        codigoErro: r['codigo_erro'] as String?,
        servidorNumero: (r['servidor_numero'] as num?)?.toInt(),
        tentativas: (r['tentativas'] as num?)?.toInt() ?? 0,
        criadoEm: DateTime.parse(r['criado_em'] as String),
        atualizadoEm: DateTime.parse(r['atualizado_em'] as String),
        enviadoEm: r['enviado_em'] == null ? null : DateTime.parse(r['enviado_em'] as String),
      );
}

/// Linha de `orcamentos_locais`. Estados em [EstadoOrcamento].
class OrcamentoLocal {
  const OrcamentoLocal({
    required this.id,
    required this.vendedorId,
    required this.clienteId,
    this.tabelaId,
    this.formaId,
    required this.total,
    required this.estado,
    required this.corpo,
    this.resposta,
    this.motivo,
    this.tentativas = 0,
    required this.criadoEm,
    required this.atualizadoEm,
    this.sincronizadoEm,
  });

  /// UUID do aparelho = id do orçamento no servidor (`PUT /vendas/orcamentos/:id`).
  final String id, vendedorId, clienteId, estado;
  final String? tabelaId, formaId, motivo;
  final double total;
  final Map<String, dynamic> corpo;
  final Map<String, dynamic>? resposta;
  final int tentativas;
  final DateTime criadoEm, atualizadoEm;
  final DateTime? sincronizadoEm;

  List<ItemEnvio> get itens =>
      ((corpo['itens'] as List?) ?? const []).map((e) => ItemEnvio.fromJson(Map<String, dynamic>.from(e as Map))).toList();
  String? get observacoes => corpo['observacoes'] as String?;

  Map<String, Object?> toRow() => {
        'id': id,
        'vendedor_id': vendedorId,
        'cliente_id': clienteId,
        'tabela_id': tabelaId,
        'forma_id': formaId,
        'total': total,
        'estado': estado,
        'corpo_json': jsonEncode(corpo),
        'resposta_json': resposta == null ? null : jsonEncode(resposta),
        'motivo': motivo,
        'tentativas': tentativas,
        'criado_em': criadoEm.toUtc().toIso8601String(),
        'atualizado_em': atualizadoEm.toUtc().toIso8601String(),
        'sincronizado_em': sincronizadoEm?.toUtc().toIso8601String(),
      };

  factory OrcamentoLocal.fromRow(Map<String, Object?> r) => OrcamentoLocal(
        id: r['id'] as String,
        vendedorId: r['vendedor_id'] as String,
        clienteId: r['cliente_id'] as String,
        tabelaId: r['tabela_id'] as String?,
        formaId: r['forma_id'] as String?,
        total: _d(r['total']),
        estado: r['estado'] as String,
        corpo: Map<String, dynamic>.from(jsonDecode(r['corpo_json'] as String) as Map),
        resposta: r['resposta_json'] == null ? null : Map<String, dynamic>.from(jsonDecode(r['resposta_json'] as String) as Map),
        motivo: r['motivo'] as String?,
        tentativas: (r['tentativas'] as num?)?.toInt() ?? 0,
        criadoEm: DateTime.parse(r['criado_em'] as String),
        atualizadoEm: DateTime.parse(r['atualizado_em'] as String),
        sincronizadoEm: r['sincronizado_em'] == null ? null : DateTime.parse(r['sincronizado_em'] as String),
      );
}
