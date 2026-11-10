import 'dart:convert';

import 'package:sqflite/sqflite.dart';

import 'banco_local.dart';
import 'modelos.dart';

/// Grava a carga do servidor no espelho local. TUDO numa transação: ou a carga
/// nova entra inteira, ou o espelho antigo continua intacto. Nunca toca em
/// `pedidos_locais` / `orcamentos_locais`.
class CargaRepository {
  CargaRepository(this._banco);
  final BancoLocal _banco;

  /// Substitui o espelho. [agora] vira `ultima_sincronizacao`. [resumo] (se vier) é
  /// guardado na mesma transação.
  Future<void> substituir(
    CargaVendedor c, {
    required DateTime agora,
    ResumoVendedor? resumo,
    String? distribuidora,
  }) async {
    await _banco.db.transaction((txn) async {
      for (final t in BancoLocal.tabelasEspelho) {
        await txn.delete(t);
      }
      final b = txn.batch();
      for (final x in c.clientes) {
        b.insert('clientes', x.toRow());
      }
      for (final x in c.titulos) {
        b.insert('titulos', x.toRow());
      }
      for (final x in c.tabelas) {
        b.insert('tabelas', x.toRow());
      }
      for (final x in c.formas) {
        b.insert('formas', x.toRow());
      }
      for (final x in c.tabelaFormas) {
        b.insert('tabela_formas', {'tabela_id': x.tabelaId, 'forma_id': x.formaId},
            conflictAlgorithm: ConflictAlgorithm.ignore);
      }
      for (var i = 0; i < c.categorias.length; i++) {
        b.insert('categorias', {'id': c.categorias[i].id, 'nome': c.categorias[i].nome, 'ordem': i});
      }
      for (final x in c.produtos) {
        b.insert('produtos', x.toRow());
      }
      for (final x in c.precos) {
        b.insert('precos', {'produto_id': x.produtoId, 'tabela_id': x.tabelaId, 'preco': x.preco},
            conflictAlgorithm: ConflictAlgorithm.replace);
      }
      for (final x in c.historico) {
        b.insert('historico', x.toRow());
      }
      await b.commit(noResult: true);

      Future<void> meta(String k, String? v) => v == null
          ? txn.delete('meta', where: 'chave = ?', whereArgs: [k])
          : txn.insert('meta', {'chave': k, 'valor': v}, conflictAlgorithm: ConflictAlgorithm.replace);
      await meta('vendedor_id', c.vendedor.id);
      await meta('vendedor_nome', c.vendedor.nome);
      await meta('erp_vendedor_id', c.vendedor.erpVendedorId);
      if (distribuidora != null) await meta('distribuidora', distribuidora);
      await meta('carga_gerada_em', c.geradoEm.toUtc().toIso8601String());
      await meta('ultima_sincronizacao', agora.toUtc().toIso8601String());
      if (resumo != null) {
        await meta('resumo', jsonEncode(resumo.toJson()));
        await meta('resumo_em', agora.toUtc().toIso8601String());
      }
    });
  }

  /// Logout: apaga o espelho e o `meta` (vendedor, resumo, hora da sincronização).
  /// Pedidos e orçamentos locais ficam (têm `vendedor_id`) para não perder a fila.
  Future<void> limparEspelho() async {
    await _banco.db.transaction((txn) async {
      for (final t in [...BancoLocal.tabelasEspelho, 'meta']) {
        await txn.delete(t);
      }
    });
  }
}
