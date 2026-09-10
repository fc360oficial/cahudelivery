import 'package:flutter/material.dart';

import '../../core/api_client.dart';

/// Primeiro acesso: o cliente entrou com a senha inicial (123456) e precisa
/// criar a dele antes de usar o app. Não dá pra voltar sem concluir.
class NovaSenhaScreen extends StatefulWidget {
  const NovaSenhaScreen({super.key, required this.aoConcluir});
  final VoidCallback aoConcluir;

  @override
  State<NovaSenhaScreen> createState() => _NovaSenhaScreenState();
}

class _NovaSenhaScreenState extends State<NovaSenhaScreen> {
  final _form = GlobalKey<FormState>();
  final _nova = TextEditingController();
  final _confirma = TextEditingController();
  bool _enviando = false;
  String? _erro;

  @override
  void dispose() {
    _nova.dispose();
    _confirma.dispose();
    super.dispose();
  }

  Future<void> _salvar() async {
    if (!_form.currentState!.validate()) return;
    setState(() {
      _enviando = true;
      _erro = null;
    });
    try {
      await ApiClient.instance.post('/auth/senha', {
        'senhaAtual': '123456',
        'novaSenha': _nova.text,
      });
      await ApiClient.instance.marcarSenhaProvisoria(false);
      if (!mounted) return;
      widget.aoConcluir();
    } on ApiException catch (e) {
      setState(() => _erro = e.message);
    } catch (_) {
      setState(() => _erro = 'Sem conexão — tente novamente');
    } finally {
      if (mounted) setState(() => _enviando = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: false,
      child: Scaffold(
        appBar: AppBar(title: const Text('Crie sua nova senha'), automaticallyImplyLeading: false),
        body: Form(
          key: _form,
          child: ListView(
            padding: const EdgeInsets.all(24),
            children: [
              const Text(
                'Você entrou com a senha inicial. Por segurança, crie agora a sua senha para os próximos acessos.',
              ),
              const SizedBox(height: 20),
              TextFormField(
                controller: _nova,
                obscureText: true,
                decoration: const InputDecoration(labelText: 'Nova senha (mín. 6 caracteres)'),
                validator: (v) {
                  if ((v ?? '').length < 6) return 'Mínimo de 6 caracteres';
                  if (v == '123456') return 'Escolha uma senha diferente da inicial';
                  return null;
                },
              ),
              const SizedBox(height: 14),
              TextFormField(
                controller: _confirma,
                obscureText: true,
                decoration: const InputDecoration(labelText: 'Confirme a nova senha'),
                validator: (v) => v == _nova.text ? null : 'As senhas não conferem',
                onFieldSubmitted: (_) => _salvar(),
              ),
              if (_erro != null) ...[
                const SizedBox(height: 14),
                Text(_erro!, style: const TextStyle(color: Colors.red)),
              ],
              const SizedBox(height: 22),
              FilledButton(
                onPressed: _enviando ? null : _salvar,
                child: _enviando
                    ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2.5))
                    : const Text('Salvar e continuar'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
