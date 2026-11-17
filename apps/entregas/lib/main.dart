import 'package:flutter/material.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:path/path.dart' as p;
import 'package:sqflite/sqflite.dart';

import 'app.dart';
import 'app_servicos.dart';
import 'core/token_store.dart';
import 'data/banco_local.dart';
import 'services/conectividade.dart';
import 'services/fotos.dart';
import 'services/localizacao_service.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await initializeDateFormatting('pt_BR');
  final banco = await BancoLocal.abrir(databaseFactory, p.join(await getDatabasesPath(), 'fluxo_entregas.db'));
  final servicos = AppServicos.criar(
    banco: banco,
    tokens: SecureTokenStore(),
    conectividade: ConnectivityPlusFonte(),
    plataforma: PlataformaGeolocator(),
    fotos: Fotos(),
  );
  runApp(FluxoEntregasApp(servicos: servicos));
}
