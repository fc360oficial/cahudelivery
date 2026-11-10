import 'dart:io' show Platform;

import 'package:flutter/material.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

import 'app.dart';
import 'app_servicos.dart';
import 'core/token_store.dart';
import 'data/banco_local.dart';
import 'services/conectividade.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await initializeDateFormatting('pt_BR');

  // Android: sqflite nativo. Windows/Linux: sqflite_common_ffi (mesmo código SQL).
  final desktop = Platform.isWindows || Platform.isLinux;
  final DatabaseFactory fabrica;
  final String pasta;
  if (desktop) {
    sqfliteFfiInit();
    fabrica = databaseFactoryFfi;
    pasta = (await getApplicationSupportDirectory()).path;
  } else {
    fabrica = databaseFactory;
    pasta = await getDatabasesPath();
  }
  final banco = await BancoLocal.abrir(fabrica, p.join(pasta, 'fluxo_vendas.db'));

  final servicos = AppServicos.criar(
    banco: banco,
    tokens: SecureTokenStore(),
    conectividade: ConnectivityPlusFonte(),
  );
  runApp(FluxoVendasApp(servicos: servicos));
}
