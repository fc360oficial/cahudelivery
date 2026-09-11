import 'package:flutter/material.dart';
import '../../widgets/campo_senha.dart';

import '../../core/api_client.dart';
import '../shell/home_shell.dart';

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

  // Escape: se a flag local ficou "provisória" mas a senha já foi trocada
  // (app morto entre o POST e o marcarSenhaProvisoria), 123456 não vale mais
  // e a tela travaria pra sempre. Sair limpa a flag e volta ao modo visitante.
  Future<void> _sair() async {
    await ApiClient.instance.sair();
    if (!mounted) return;
    Navigator.of(context).pushAndRemoveUntil(
      MaterialPageRoute(builder: (_) => const HomeShell()),
      (_) => false,
    );
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: false,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('Crie sua nova senha'),
          automaticallyImplyLeading: false,
        ),
        body: SafeArea(
          child: Form(
            key: _form,
            child: ListView(
              padding: const EdgeInsets.fromLTRB(24, 24, 24, 32),
              children: [
                const Text(
                  'Você entrou com a senha inicial. Por segurança, crie agora a sua senha para os próximos acessos.',
                ),
                const SizedBox(height: 20),
                CampoSenha(
                  controller: _nova,
                  labelText: 'Nova senha (mín. 6 caracteres)',
                  textInputAction: TextInputAction.next,
                  validator: (v) {
                    if ((v ?? '').length < 6) return 'Mínimo de 6 caracteres';
                    if (v == '123456')
                      return 'Escolha uma senha diferente da inicial';
                    return null;
                  },
                ),
                const SizedBox(height: 14),
                CampoSenha(
                  controller: _confirma,
                  labelText: 'Confirme a nova senha',
                  validator: (v) =>
                      v == _nova.text ? null : 'As senhas não conferem',
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
                      ? const SizedBox(
                          width: 22,
                          height: 22,
                          child: CircularProgressIndicator(strokeWidth: 2.5),
                        )
                      : const Text('Salvar e continuar'),
                ),
                const SizedBox(height: 24),
                Text(
                  'Se você já criou sua senha antes, saia e entre de novo com ela.',
                  textAlign: TextAlign.center,
                  style: Theme.of(
                    context,
                  ).textTheme.bodySmall?.copyWith(color: Colors.grey),
                ),
                TextButton(
                  onPressed: _enviando ? null : _sair,
                  child: const Text('Sair da conta'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
