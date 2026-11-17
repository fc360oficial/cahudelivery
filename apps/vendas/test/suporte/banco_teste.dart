import 'dart:convert';
import 'dart:io';

import 'package:sqflite_common_ffi/sqflite_ffi.dart';

import 'package:fluxo_vendas/data/banco_local.dart';
import 'package:fluxo_vendas/data/modelos.dart';

/// Banco SQLite em memória (sqflite_common_ffi) para testes: o mesmo esquema do app.
Future<BancoLocal> bancoEmMemoria() async {
  sqfliteFfiInit();
  return BancoLocal.abrir(databaseFactoryFfi, inMemoryDatabasePath);
}

/// Fixtures salvas de respostas REAIS da API de teste (ver test/fixtures/LEIAME.md).
Map<String, dynamic> fixtureJson(String nome) =>
    jsonDecode(File('test/fixtures/$nome.json').readAsStringSync()) as Map<String, dynamic>;

CargaVendedor cargaDeFixture() => CargaVendedor.fromJson(fixtureJson('sync'));
