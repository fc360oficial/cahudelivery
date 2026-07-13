import 'package:flutter/material.dart';

import '../features/auth/cadastro_screen.dart';
import '../features/auth/login_screen.dart';

/// Estado "visitante" das abas que exigem conta (Pedidos, Perfil).
class ConviteLogin extends StatelessWidget {
  const ConviteLogin({
    super.key,
    required this.icone,
    required this.titulo,
    required this.onAutenticado,
  });

  final IconData icone;
  final String titulo;
  final VoidCallback onAutenticado;

  Future<void> _abrir(BuildContext context, Widget tela) async {
    final ok = await Navigator.of(context)
        .push<bool>(MaterialPageRoute(builder: (_) => tela));
    if (ok == true) onAutenticado();
  }

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 360),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Icon(icone, size: 64, color: Colors.grey.shade400),
              const SizedBox(height: 16),
              Text(titulo,
                  textAlign: TextAlign.center,
                  style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700)),
              const SizedBox(height: 20),
              FilledButton(
                onPressed: () =>
                    _abrir(context, const LoginScreen(retornarAoLogar: true)),
                child: const Text('Entrar'),
              ),
              TextButton(
                onPressed: () =>
                    _abrir(context, const CadastroScreen(retornarAoLogar: true)),
                child: const Text('Criar minha conta'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
