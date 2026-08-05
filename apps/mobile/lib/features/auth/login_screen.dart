import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../core/config.dart';
import '../../core/tenant_theme.dart';
import '../shell/home_shell.dart';
import 'cadastro_screen.dart';

/// Login do cliente da distribuidora (e-mail ou CNPJ/CPF + senha).
class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key, this.retornarAoLogar = false});
  final bool retornarAoLogar;

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
      if (widget.retornarAoLogar) {
        Navigator.of(context).pop(true);
      } else {
        Navigator.of(context).pushReplacement(
          MaterialPageRoute(builder: (_) => const HomeShell()),
        );
      }
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
                  // Logo do flavor; sem asset, cai no nome do app em texto.
                  Image.asset(
                    AppBuildConfig.logoAsset,
                    height: 160,
                    errorBuilder: (_, e, s) => Text(
                      t.appNome,
                      textAlign: TextAlign.center,
                      style: TextStyle(
                          fontSize: 30, fontWeight: FontWeight.bold, color: t.corPrimaria),
                    ),
                  ),
                  const SizedBox(height: 10),
                  Text(
                    t.appNome,
                    textAlign: TextAlign.center,
                    style: TextStyle(
                        fontSize: 17, fontWeight: FontWeight.w700, color: t.corPrimaria),
                  ),
                  const SizedBox(height: 30),
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
                    onPressed: () async {
                      final ok = await Navigator.of(context).push<bool>(
                        MaterialPageRoute(
                            builder: (_) => CadastroScreen(
                                retornarAoLogar: widget.retornarAoLogar)),
                      );
                      if (ok == true && context.mounted) {
                        Navigator.of(context).pop(true);
                      }
                    },
                    child: const Text('Criar minha conta'),
                  ),
                  TextButton(
                    // Recuperação por e-mail entra quando a API tiver o fluxo
                    onPressed: () => showDialog<void>(
                      context: context,
                      builder: (ctx) => AlertDialog(
                        title: const Text('Esqueci minha senha'),
                        content: const Text(
                            'Fale com a distribuidora para redefinir sua senha de acesso.'),
                        actions: [
                          FilledButton(
                              onPressed: () => Navigator.of(ctx).pop(),
                              child: const Text('Entendi')),
                        ],
                      ),
                    ),
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
