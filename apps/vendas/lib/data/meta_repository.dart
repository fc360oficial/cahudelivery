import 'dart:convert';

import 'package:sqflite/sqflite.dart';

import 'banco_local.dart';
import 'modelos.dart';

/// Chaves da tabela `meta` (vendedor, distribuidora, última sincronização, resumo).
class MetaRepository {
  MetaRepository(this._banco);
  final BancoLocal _banco;
  Database get _db => _banco.db;

  static const chaveLogo = 'logo_cliente_url';

  /// URL da logo da distribuidora (nula = não cadastrada ou ainda não baixada).
  Future<String?> logoCliente() => ler(chaveLogo);

  Future<String?> ler(String chave) async {
    final r = await _db.query('meta', where: 'chave = ?', whereArgs: [chave]);
    return r.isEmpty ? null : r.first['valor'] as String?;
  }

  Future<void> gravar(String chave, String? valor) async {
    if (valor == null) {
      await _db.delete('meta', where: 'chave = ?', whereArgs: [chave]);
    } else {
      await _db.insert('meta', {'chave': chave, 'valor': valor}, conflictAlgorithm: ConflictAlgorithm.replace);
    }
  }

  Future<VendedorInfo?> vendedor() async {
    final id = await ler('vendedor_id');
    final nome = await ler('vendedor_nome');
    if (id == null || nome == null) return null;
    return VendedorInfo(id: id, nome: nome, erpVendedorId: await ler('erp_vendedor_id'));
  }

  Future<String?> distribuidora() => ler('distribuidora');

  /// Hora (do aparelho) em que a última carga foi gravada com sucesso.
  Future<DateTime?> ultimaSincronizacao() async {
    final v = await ler('ultima_sincronizacao');
    return v == null ? null : DateTime.tryParse(v);
  }

  /// Último resumo baixado (cache para o Início funcionar offline).
  Future<ResumoVendedor?> resumo() async {
    final v = await ler('resumo');
    if (v == null) return null;
    return ResumoVendedor.fromJson(jsonDecode(v) as Map<String, dynamic>);
  }
}
