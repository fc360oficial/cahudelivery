import 'dart:convert';
import 'package:sqflite/sqflite.dart' show ConflictAlgorithm;

import 'banco_local.dart';
import 'meta_repository.dart';

/// Pedido em andamento, como fica gravado em `rascunho_pedido.json`.
/// Só ids e quantidades: nomes, estoque e preço são relidos do espelho ao restaurar.
class Rascunho {
  const Rascunho({
    required this.clienteId,
    this.tabelaId,
    this.formaId,
    this.itens = const [],
    this.observacoes = '',
    this.orcamentoId,
  });
  final String clienteId;
  final String? tabelaId, formaId, orcamentoId;
  final List<({String produtoId, double quantidade})> itens;
  final String observacoes;

  String toJson() => jsonEncode({
        'clienteId': clienteId,
        'tabelaId': tabelaId,
        'formaId': formaId,
        'observacoes': observacoes,
        'orcamentoId': orcamentoId,
        'itens': [for (final i in itens) {'produtoId': i.produtoId, 'quantidade': i.quantidade}],
      });

  factory Rascunho.fromJson(String s) {
    final j = jsonDecode(s) as Map<String, dynamic>;
    return Rascunho(
      clienteId: j['clienteId'] as String,
      tabelaId: j['tabelaId'] as String?,
      formaId: j['formaId'] as String?,
      observacoes: (j['observacoes'] as String?) ?? '',
      orcamentoId: j['orcamentoId'] as String?,
      itens: [
        for (final i in (j['itens'] as List? ?? const []))
          (produtoId: (i as Map)['produtoId'] as String, quantidade: (i['quantidade'] as num).toDouble()),
      ],
    );
  }
}

/// Um rascunho por vendedor, no banco local (sobrevive a fechar/matar o app).
class RascunhoRepository {
  RascunhoRepository(this._banco, this._meta);
  final BancoLocal _banco;
  final MetaRepository _meta;

  Future<Rascunho?> ler() async {
    final v = await _meta.ler('vendedor_id');
    if (v == null) return null;
    final r = await _banco.db.query('rascunho_pedido', where: 'vendedor_id = ?', whereArgs: [v]);
    if (r.isEmpty) return null;
    try {
      return Rascunho.fromJson(r.first['json'] as String);
    } catch (_) {
      return null; // rascunho corrompido: o vendedor começa outro
    }
  }

  Future<void> gravar(Rascunho r, DateTime agora) async {
    final v = await _meta.ler('vendedor_id');
    if (v == null) return;
    await _banco.db.insert(
        'rascunho_pedido', {'vendedor_id': v, 'json': r.toJson(), 'atualizado_em': agora.toUtc().toIso8601String()},
        conflictAlgorithm: ConflictAlgorithm.replace);
  }

  Future<void> apagar() async {
    final v = await _meta.ler('vendedor_id');
    if (v == null) return;
    await _banco.db.delete('rascunho_pedido', where: 'vendedor_id = ?', whereArgs: [v]);
  }
}
