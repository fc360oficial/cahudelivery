import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../core/config.dart';
import '../../core/tenant_theme.dart';
import '../onboarding/cep_screen.dart';
import '../shell/home_shell.dart';

/// Splash: carrega o tema remoto do tenant e decide a rota inicial.
class SplashScreen extends StatefulWidget {
  const SplashScreen({super.key});

  @override
  State<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends State<SplashScreen> {
  @override
  void initState() {
    super.initState();
    _boot();
  }

  Future<void> _boot() async {
    await TenantTheme.instance.carregar();
    final prefs = await SharedPreferences.getInstance();
    final cepVisto = prefs.getBool('cepVisto') ?? false;
    await Future.delayed(const Duration(milliseconds: 600));
    if (!mounted) return;
    Navigator.of(context).pushReplacement(
      MaterialPageRoute(builder: (_) => cepVisto ? const HomeShell() : const CepScreen()),
    );
  }

  @override
  Widget build(BuildContext context) {
    final t = TenantTheme.instance;
    return Scaffold(
      backgroundColor: t.corPrimaria,
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (t.logoUrl != null)
              Image.network(t.logoUrl!, width: 140, errorBuilder: (_, e, s) => _logoLocal(t))
            else
              _logoLocal(t),
            const SizedBox(height: 24),
            SizedBox(
              width: 28,
              height: 28,
              child: CircularProgressIndicator(color: t.corSobrePrimaria, strokeWidth: 2.5),
            ),
          ],
        ),
      ),
    );
  }

  /// Logo do flavor (o fundo do splash é a cor do tenant; logo sem fundo branco).
  Widget _logoLocal(TenantTheme t) => Image.asset(
        AppBuildConfig.logoAsset,
        width: 200,
        errorBuilder: (_, e, s) => _nome(t),
      );

  Widget _nome(TenantTheme t) => Text(
        t.appNome,
        style: TextStyle(color: t.corSobrePrimaria, fontSize: 32, fontWeight: FontWeight.bold),
      );
}
