import 'package:sqflite/sqflite.dart';

import 'banco_local.dart';
import 'meta_repository.dart';
import 'pedido_local.dart';

/// Pedidos feitos neste aparelho (`pedidos_locais`), do vendedor logado.
/// Sem sessão (sem `vendedor_id` em `meta`) as consultas voltam vazias.
class PedidosLocaisRepository {
  PedidosLocaisRepository(this._banco, this._meta);
  final BancoLocal _banco;
  final MetaRepository _meta;
  Database get _db => _banco.db;

  Future<String?> _vendedor() => _meta.ler('vendedor_id');

  Future<String> vendedorObrigatorio() async {
    final v = await _vendedor();
    if (v == null) throw StateError('Sem vendedor logado.');
    return v;
  }

  Future<void> inserir(PedidoLocal p) => _db.insert('pedidos_locais', p.toRow());

  Future<PedidoLocal?> porId(String id) async {
    final r = await _db.query('pedidos_locais', where: 'id = ?', whereArgs: [id]);
    return r.isEmpty ? null : PedidoLocal.fromRow(r.first);
  }

  /// Pedidos do vendedor, filtrados por [estados] (todos se nulo). Padrão: mais novo primeiro;
  /// [maisAntigoPrimeiro] dá a ordem de criação (a da fila de envio).
  Future<List<PedidoLocal>> listar({Iterable<String>? estados, bool maisAntigoPrimeiro = false, int? limite}) async {
    final v = await _vendedor();
    if (v == null) return [];
    final es = estados?.toList();
    final where = ['vendedor_id = ?', if (es != null) 'estado IN (${List.filled(es.length, '?').join(',')})'];
    final r = await _db.query('pedidos_locais',
        where: where.join(' AND '),
        whereArgs: [v, ...?es],
        orderBy: maisAntigoPrimeiro ? 'criado_em ASC, id ASC' : 'criado_em DESC, id DESC',
        limit: limite);
    return r.map(PedidoLocal.fromRow).toList();
  }

  /// Fila de envio: `aguardando_envio` na ordem de criação.
  Future<List<PedidoLocal>> aguardandoEnvio() =>
      listar(estados: [EstadoPedido.aguardandoEnvio], maisAntigoPrimeiro: true);

  Future<int> contar(String estado) async {
    final v = await _vendedor();
    if (v == null) return 0;
    return Sqflite.firstIntValue(await _db
            .rawQuery('SELECT COUNT(*) FROM pedidos_locais WHERE vendedor_id = ? AND estado = ?', [v, estado])) ??
        0;
  }

  /// Atualiza colunas soltas (`estado`, `resposta_json`, `motivo`...). Sempre carimba `atualizado_em`.
  Future<void> atualizar(String id, Map<String, Object?> valores, DateTime agora) => _db.update(
      'pedidos_locais', {...valores, 'atualizado_em': agora.toUtc().toIso8601String()},
      where: 'id = ?', whereArgs: [id]);

  /// Pedidos que ficaram `enviando` porque o app foi fechado no meio do envio voltam para a fila.
  Future<void> recolocarInterrompidos(DateTime agora) => _db.update(
      'pedidos_locais', {'estado': EstadoPedido.aguardandoEnvio, 'atualizado_em': agora.toUtc().toIso8601String()},
      where: 'estado = ?', whereArgs: [EstadoPedido.enviando]);
}

/// Orçamentos feitos neste aparelho (`orcamentos_locais`), do vendedor logado.
class OrcamentosLocaisRepository {
  OrcamentosLocaisRepository(this._banco, this._meta);
  final BancoLocal _banco;
  final MetaRepository _meta;
  Database get _db => _banco.db;

  Future<String?> _vendedor() => _meta.ler('vendedor_id');

  Future<String> vendedorObrigatorio() async {
    final v = await _vendedor();
    if (v == null) throw StateError('Sem vendedor logado.');
    return v;
  }

  Future<void> inserir(OrcamentoLocal o) =>
      _db.insert('orcamentos_locais', o.toRow(), conflictAlgorithm: ConflictAlgorithm.replace);

  Future<OrcamentoLocal?> porId(String id) async {
    final r = await _db.query('orcamentos_locais', where: 'id = ?', whereArgs: [id]);
    return r.isEmpty ? null : OrcamentoLocal.fromRow(r.first);
  }

  Future<List<OrcamentoLocal>> listar({Iterable<String>? estados, bool maisAntigoPrimeiro = false, int? limite}) async {
    final v = await _vendedor();
    if (v == null) return [];
    final es = estados?.toList();
    final where = ['vendedor_id = ?', if (es != null) 'estado IN (${List.filled(es.length, '?').join(',')})'];
    final r = await _db.query('orcamentos_locais',
        where: where.join(' AND '),
        whereArgs: [v, ...?es],
        orderBy: maisAntigoPrimeiro ? 'criado_em ASC, id ASC' : 'criado_em DESC, id DESC',
        limit: limite);
    return r.map(OrcamentoLocal.fromRow).toList();
  }

  /// Fila de envio: `local` na ordem de criação.
  Future<List<OrcamentoLocal>> aguardandoEnvio() =>
      listar(estados: [EstadoOrcamento.local], maisAntigoPrimeiro: true);

  Future<int> contar(String estado) async {
    final v = await _vendedor();
    if (v == null) return 0;
    return Sqflite.firstIntValue(await _db.rawQuery(
            'SELECT COUNT(*) FROM orcamentos_locais WHERE vendedor_id = ? AND estado = ?', [v, estado])) ??
        0;
  }

  Future<void> atualizar(String id, Map<String, Object?> valores, DateTime agora) => _db.update(
      'orcamentos_locais', {...valores, 'atualizado_em': agora.toUtc().toIso8601String()},
      where: 'id = ?', whereArgs: [id]);
}
