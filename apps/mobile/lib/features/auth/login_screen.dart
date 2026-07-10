import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../core/tenant_theme.dart';

/// Login do cliente da distribuidora (e-mail ou CNPJ/CPF + senha).
class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _identificador = TextEditingController();
  final _senha = TextEditingController();
  bool _carregando = false;
  String? _erro;

  Future<void> _entrar() async {
    setState(() {
      _carregando = true;
      _erro = null;
    });
    try {
      final r = await ApiClient.instance.post('/auth/login', {
        'identificador': _identificador.text.trim(),
        'senha': _senha.text,
      }) as Map<String, dynamic>;
      await ApiClient.instance.salvarTokens(r['accessToken'], r['refreshToken']);
      if (!mounted) return;
      // Fase 2 (telas): navegar para HomeShell
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Bem-vindo! (status: ${r['status']})')),
      );
    } on ApiException catch (e) {
      setState(() => _erro = e.message);
    } catch (_) {
      setState(() => _erro = 'Sem conexão — tente novamente');
    } finally {
      if (mounted) setState(() => _carregando = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = TenantTheme.instance;
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(
                    t.appNome,
                    textAlign: TextAlign.center,
                    style: TextStyle(fontSize: 30, fontWeight: FontWeight.bold, color: t.corPrimaria),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    t.distribuidora,
                    textAlign: TextAlign.center,
                    style: TextStyle(fontSize: 15, color: Colors.grey.shade600),
                  ),
                  const SizedBox(height: 36),
                  TextField(
                    controller: _identificador,
                    decoration: const InputDecoration(labelText: 'E-mail ou CNPJ/CPF'),
                    keyboardType: TextInputType.emailAddress,
                  ),
                  const SizedBox(height: 14),
                  TextField(
                    controller: _senha,
                    decoration: const InputDecoration(labelText: 'Senha'),
                    obscureText: true,
                    onSubmitted: (_) => _entrar(),
                  ),
                  if (_erro != null) ...[
                    const SizedBox(height: 14),
                    Text(_erro!, style: const TextStyle(color: Colors.red)),
                  ],
                  const SizedBox(height: 22),
                  FilledButton(
                    onPressed: _carregando ? null : _entrar,
                    child: _carregando
                        ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2.5))
                        : const Text('Entrar'),
                  ),
                  const SizedBox(height: 14),
                  TextButton(
                    onPressed: () {}, // Fase 2: tela de cadastro
                    child: const Text('Criar minha conta'),
                  ),
                  TextButton(
                    onPressed: () {}, // Fase 2: recuperar senha
                    child: const Text('Esqueci minha senha'),
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
