import 'package:flutter/material.dart';
import 'package:flutter_native_splash/flutter_native_splash.dart';

import 'core/api_client.dart';
import 'core/tenant_theme.dart';
import 'features/shell/home_shell.dart';

Future<void> main() async {
  final binding = WidgetsFlutterBinding.ensureInitialized();
  // Segura a splash nativa (amarela com o logo) na tela até o app estar
  // pronto — splash única, sem o pulo de tamanho de uma segunda splash.
  FlutterNativeSplash.preserve(widgetsBinding: binding);
  await ApiClient.instance.carregarSessao();
  // Tema remoto do tenant; sem rede segue com o fallback embutido do flavor.
  await TenantTheme.instance
      .carregar()
      .timeout(const Duration(seconds: 6), onTimeout: () {});
  runApp(const FluxoCommerceApp(inicio: HomeShell()));
  FlutterNativeSplash.remove();
}

/// Casca white label: o mesmo código vira "CAHU Delivery" (ou qualquer outra
/// distribuidora) pelo flavor de build + tema remoto carregado no boot.
class FluxoCommerceApp extends StatelessWidget {
  const FluxoCommerceApp({super.key, required this.inicio});
  final Widget inicio;

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: TenantTheme.instance,
      builder: (context, _) => MaterialApp(
        title: TenantTheme.instance.appNome,
        debugShowCheckedModeBanner: false,
        theme: TenantTheme.instance.buildTheme(),
        home: inicio,
      ),
    );
  }
}
