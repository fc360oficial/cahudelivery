import 'package:flutter/material.dart';

import '../../app_servicos.dart';
import '../../core/mensagens.dart';
import '../../core/tema.dart';
import '../../widgets/marca.dart';

/// Entrada do vendedor. Mostra a mensagem do encerramento forçado (bloqueado/expirado), se houver.
class LoginPage extends StatefulWidget {
  const LoginPage({super.key});

  @override
  State<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends State<LoginPage> {
  final _login = TextEditingController();
  final _senha = TextEditingController();
  final _form = GlobalKey<FormState>();
  bool _ver = false;
  bool _entrando = false;
  String? _erro;
  bool _mensagemLida = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (!_mensagemLida) {
      _mensagemLida = true;
      final s = Servicos.of(context).sessao;
      _erro = s.mensagem;
      s.limparMensagem();
    }
  }

  @override
  void dispose() {
    _login.dispose();
    _senha.dispose();
    super.dispose();
  }

  Future<void> _entrar() async {
    if (!_form.currentState!.validate()) return;
    setState(() {
      _entrando = true;
      _erro = null;
    });
    try {
      await Servicos.of(context).sessao.entrar(_login.text, _senha.text);
    } catch (e) {
      if (!mounted) return;
      setState(() => _erro = mensagemDeErro(e));
    } finally {
      if (mounted) setState(() => _entrando = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Cores.marinho,
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const Center(child: MarcaFluxoVendas(altura: 56)),
                  const SizedBox(height: 8),
                  const Text('Seu pedido na rua, sem complicação.',
                      textAlign: TextAlign.center, style: TextStyle(color: Colors.white70, fontSize: 15)),
                  const SizedBox(height: 32),
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(20),
                      child: Form(
                        key: _form,
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            Text('Entrar', style: Theme.of(context).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w800)),
                            const SizedBox(height: 16),
                            TextFormField(
                              controller: _login,
                              enabled: !_entrando,
                              autofillHints: const [AutofillHints.username],
                              textInputAction: TextInputAction.next,
                              autocorrect: false,
                              decoration: const InputDecoration(labelText: 'Login', prefixIcon: Icon(Icons.person_outline)),
                              validator: (v) => (v == null || v.trim().isEmpty) ? 'Informe o login' : null,
                            ),
                            const SizedBox(height: 12),
                            TextFormField(
                              controller: _senha,
                              enabled: !_entrando,
                              obscureText: !_ver,
                              autofillHints: const [AutofillHints.password],
                              textInputAction: TextInputAction.done,
                              onFieldSubmitted: (_) => _entrar(),
                              decoration: InputDecoration(
                                labelText: 'Senha',
                                prefixIcon: const Icon(Icons.lock_outline),
                                suffixIcon: IconButton(
                                  tooltip: _ver ? 'Ocultar senha' : 'Mostrar senha',
                                  icon: Icon(_ver ? Icons.visibility_off_outlined : Icons.visibility_outlined),
                                  onPressed: () => setState(() => _ver = !_ver),
                                ),
                              ),
                              validator: (v) => (v == null || v.isEmpty) ? 'Informe a senha' : null,
                            ),
                            if (_erro != null) ...[
                              const SizedBox(height: 12),
                              Container(
                                padding: const EdgeInsets.all(12),
                                decoration: BoxDecoration(
                                  color: Cores.erro.withValues(alpha: 0.08),
                                  borderRadius: BorderRadius.circular(12),
                                ),
                                child: Row(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    const Icon(Icons.error_outline, color: Cores.erro, size: 20),
                                    const SizedBox(width: 8),
                                    Expanded(child: Text(_erro!, key: const Key('login-erro'), style: const TextStyle(color: Cores.erro))),
                                  ],
                                ),
                              ),
                            ],
                            const SizedBox(height: 20),
                            FilledButton(
                              onPressed: _entrando ? null : _entrar,
                              child: _entrando
                                  ? const SizedBox(height: 22, width: 22, child: CircularProgressIndicator(strokeWidth: 2.5, color: Colors.white))
                                  : const Text('Entrar'),
                            ),
                          ],
                        ),
                      ),
                    ),
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
