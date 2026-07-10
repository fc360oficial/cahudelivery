import 'package:flutter/material.dart';

import '../../core/tenant_theme.dart';
import '../auth/login_screen.dart';

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
    await Future.delayed(const Duration(milliseconds: 600));
    if (!mounted) return;
    // Fase 2 (telas): se logado -> HomeShell; senão -> Login
    Navigator.of(context).pushReplacement(
      MaterialPageRoute(builder: (_) => const LoginScreen()),
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
              Image.network(t.logoUrl!, width: 140, errorBuilder: (_, e, s) => _nome(t))
            else
              _nome(t),
            const SizedBox(height: 24),
            const SizedBox(
              width: 28,
              height: 28,
              child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2.5),
            ),
          ],
        ),
      ),
    );
  }

  Widget _nome(TenantTheme t) => Text(
        t.appNome,
        style: const TextStyle(color: Colors.white, fontSize: 32, fontWeight: FontWeight.bold),
      );
}
