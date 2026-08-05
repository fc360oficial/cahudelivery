import 'package:flutter/material.dart';

import '../../core/config.dart';
import '../../core/tenant_theme.dart';
import 'cadastro_screen.dart';
import 'login_screen.dart';

/// Gate do checkout para visitante: autentica e devolve `true` ao carrinho.
class EntrarOuCriarScreen extends StatelessWidget {
  const EntrarOuCriarScreen({super.key});

  Future<void> _abrir(BuildContext context, Widget tela) async {
    final ok = await Navigator.of(context)
        .push<bool>(MaterialPageRoute(builder: (_) => tela));
    if (ok == true && context.mounted) Navigator.of(context).pop(true);
  }

  @override
  Widget build(BuildContext context) {
    final t = TenantTheme.instance;
    return Scaffold(
      appBar: AppBar(title: const Text('Quase lá!')),
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Image.asset(AppBuildConfig.logoAsset, height: 130,
                      errorBuilder: (_, e, s) => Text(t.appNome,
                          textAlign: TextAlign.center,
                          style: const TextStyle(
                              fontSize: 26, fontWeight: FontWeight.w800))),
                  const SizedBox(height: 20),
                  const Text('Para finalizar seu pedido, entre na sua conta ou crie uma agora.',
                      textAlign: TextAlign.center,
                      style: TextStyle(fontSize: 15, height: 1.45)),
                  const SizedBox(height: 28),
                  FilledButton(
                    onPressed: () =>
                        _abrir(context, const LoginScreen(retornarAoLogar: true)),
                    child: const Text('Já tenho conta'),
                  ),
                  const SizedBox(height: 10),
                  OutlinedButton(
                    onPressed: () =>
                        _abrir(context, const CadastroScreen(retornarAoLogar: true)),
                    style: OutlinedButton.styleFrom(
                      minimumSize: const Size.fromHeight(52),
                      shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(14)),
                    ),
                    child: const Text('Criar minha conta'),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
