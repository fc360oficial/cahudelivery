import 'package:flutter/material.dart';
import '../../widgets/campo_senha.dart';

import '../../core/api_client.dart';

/// Primeiro acesso e "esqueci minha senha": a distribuidora gera um código na
/// retaguarda e o cliente cria a senha com ele. Devolve true quando entrou.
class PrimeiroAcessoScreen extends StatefulWidget {
  const PrimeiroAcessoScreen({super.key, this.documento = ''});
  final String documento;

  @override
  State<PrimeiroAcessoScreen> createState() => _PrimeiroAcessoScreenState();
}

class _PrimeiroAcessoScreenState extends State<PrimeiroAcessoScreen> {
  final _form = GlobalKey<FormState>();
  late final _documento = TextEditingController(text: widget.documento);
  final _codigo = TextEditingController();
  final _nova = TextEditingController();
  final _confirma = TextEditingController();
  bool _enviando = false;
  String? _erro;

  @override
  void dispose() {
    _documento.dispose();
    _codigo.dispose();
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
      final r =
          await ApiClient.instance.post('/auth/primeiro-acesso', {
                'identificador': _documento.text.replaceAll(RegExp(r'\D'), ''),
                'codigo': _codigo.text,
                'novaSenha': _nova.text,
              })
              as Map<String, dynamic>;
      await ApiClient.instance.salvarTokens(
        r['accessToken'],
        r['refreshToken'],
      );
      if (!mounted) return;
      Navigator.of(context).pop(true);
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
    return Scaffold(
      appBar: AppBar(title: const Text('Criar senha')),
      body: SafeArea(
        child: Form(
          key: _form,
          child: ListView(
            padding: const EdgeInsets.fromLTRB(24, 24, 24, 32),
            children: [
              const Text(
                'Peça o código de acesso à distribuidora. Com ele você cria sua senha e já entra no app.',
              ),
              const SizedBox(height: 20),
              TextFormField(
                controller: _documento,
                decoration: const InputDecoration(labelText: 'CNPJ ou CPF'),
                keyboardType: TextInputType.number,
                textInputAction: TextInputAction.next,
                validator: (v) => (v ?? '').replaceAll(RegExp(r'\D'), '').isEmpty
                    ? 'Informe o CNPJ ou CPF'
                    : null,
              ),
              const SizedBox(height: 14),
              TextFormField(
                controller: _codigo,
                decoration: const InputDecoration(
                  labelText: 'Código de acesso',
                  hintText: 'ABCD-EFGH',
                ),
                textCapitalization: TextCapitalization.characters,
                autocorrect: false,
                textInputAction: TextInputAction.next,
                validator: (v) =>
                    (v ?? '').trim().isEmpty ? 'Informe o código' : null,
              ),
              const SizedBox(height: 14),
              CampoSenha(
                controller: _nova,
                labelText: 'Nova senha (mín. 6 caracteres)',
                textInputAction: TextInputAction.next,
                validator: (v) =>
                    (v ?? '').length < 6 ? 'Mínimo de 6 caracteres' : null,
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
                    : const Text('Criar senha e entrar'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
