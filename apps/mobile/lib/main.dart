import 'package:flutter/material.dart';

import 'core/api_client.dart';
import 'core/tenant_theme.dart';
import 'features/splash/splash_screen.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await ApiClient.instance.carregarSessao();
  runApp(const FluxoCommerceApp());
}

/// Casca white label: o mesmo código vira "CAHU Delivery" (ou qualquer outra
/// distribuidora) pelo flavor de build + tema remoto carregado no splash.
class FluxoCommerceApp extends StatelessWidget {
  const FluxoCommerceApp({super.key});

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: TenantTheme.instance,
      builder: (context, _) => MaterialApp(
        title: TenantTheme.instance.appNome,
        debugShowCheckedModeBanner: false,
        theme: TenantTheme.instance.buildTheme(),
        home: const SplashScreen(),
      ),
    );
  }
}
