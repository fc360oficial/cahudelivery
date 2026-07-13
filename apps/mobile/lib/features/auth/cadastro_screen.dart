import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../shell/home_shell.dart';

/// Cadastro do cliente da distribuidora (POST /v1/auth/registrar).
/// A resposta já traz os tokens — o cadastro auto-loga o cliente.
class CadastroScreen extends StatefulWidget {
  const CadastroScreen({super.key, this.retornarAoLogar = false});
  final bool retornarAoLogar;

  @override
  State<CadastroScreen> createState() => _CadastroScreenState();
}

class _CadastroScreenState extends State<CadastroScreen> {
  final _form = GlobalKey<FormState>();
  String _tipo = 'CNPJ';
  final _documento = TextEditingController();
  final _nomeFantasia = TextEditingController();
  final _razaoSocial = TextEditingController();
  final _email = TextEditingController();
  final _telefone = TextEditingController();
  final _senha = TextEditingController();
  bool _enviando = false;

  @override
  void dispose() {
    for (final c in [_documento, _nomeFantasia, _razaoSocial, _email, _telefone, _senha]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _cadastrar() async {
    if (!_form.currentState!.validate()) return;
    setState(() => _enviando = true);
    try {
      final r = await ApiClient.instance.post('/auth/registrar', {
        'tipo': _tipo,
        'documento': _documento.text.replaceAll(RegExp(r'\D'), ''),
        'nomeFantasia': _nomeFantasia.text.trim(),
        if (_razaoSocial.text.trim().isNotEmpty) 'razaoSocial': _razaoSocial.text.trim(),
        'email': _email.text.trim(),
        if (_telefone.text.trim().isNotEmpty) 'telefone': _telefone.text.trim(),
        'senha': _senha.text,
      }) as Map<String, dynamic>;
      await ApiClient.instance.salvarTokens(r['accessToken'], r['refreshToken']);
      if (!mounted) return;
      if (r['status'] != 'aprovado' && r['status'] != 'ativo') {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
            content: Text(
                'Cadastro em análise pela distribuidora — você já pode navegar e montar pedidos.')));
      }
      if (widget.retornarAoLogar) {
        Navigator.of(context).pop(true);
      } else {
        Navigator.of(context).pushAndRemoveUntil(
            MaterialPageRoute(builder: (_) => const HomeShell()), (_) => false);
      }
    } on ApiException catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(const SnackBar(content: Text('Sem conexão — tente novamente')));
      }
    } finally {
      if (mounted) setState(() => _enviando = false);
    }
  }

  String? _obrigatorio(String? v) =>
      (v == null || v.trim().isEmpty) ? 'Campo obrigatório' : null;

  @override
  Widget build(BuildContext context) {
    final ehCnpj = _tipo == 'CNPJ';
    return Scaffold(
      appBar: AppBar(title: const Text('Criar minha conta')),
      body: Form(
        key: _form,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            SegmentedButton<String>(
              segments: const [
                ButtonSegment(value: 'CNPJ', label: Text('Empresa (CNPJ)')),
                ButtonSegment(value: 'CPF', label: Text('Pessoa física (CPF)')),
              ],
              selected: {_tipo},
              onSelectionChanged: (s) => setState(() => _tipo = s.first),
            ),
            const SizedBox(height: 16),
            TextFormField(
              controller: _documento,
              keyboardType: TextInputType.number,
              decoration: InputDecoration(labelText: ehCnpj ? 'CNPJ' : 'CPF'),
              validator: (v) {
                final d = (v ?? '').replaceAll(RegExp(r'\D'), '');
                final esperado = ehCnpj ? 14 : 11;
                return d.length == esperado ? null : '${ehCnpj ? 'CNPJ' : 'CPF'} inválido';
              },
            ),
            const SizedBox(height: 14),
            TextFormField(
              controller: _nomeFantasia,
              decoration: InputDecoration(
                  labelText: ehCnpj ? 'Nome fantasia' : 'Nome do negócio'),
              validator: _obrigatorio,
            ),
            if (ehCnpj) ...[
              const SizedBox(height: 14),
              TextFormField(
                controller: _razaoSocial,
                decoration: const InputDecoration(labelText: 'Razão social (opcional)'),
              ),
            ],
            const SizedBox(height: 14),
            TextFormField(
              controller: _email,
              keyboardType: TextInputType.emailAddress,
              decoration: const InputDecoration(labelText: 'E-mail'),
              validator: (v) =>
                  (v ?? '').contains('@') && (v ?? '').contains('.') ? null : 'E-mail inválido',
            ),
            const SizedBox(height: 14),
            TextFormField(
              controller: _telefone,
              keyboardType: TextInputType.phone,
              decoration:
                  const InputDecoration(labelText: 'Telefone / WhatsApp (opcional)'),
            ),
            const SizedBox(height: 14),
            TextFormField(
              controller: _senha,
              obscureText: true,
              decoration: const InputDecoration(labelText: 'Senha (mín. 6 caracteres)'),
              validator: (v) => (v ?? '').length >= 6 ? null : 'Mínimo de 6 caracteres',
            ),
            const SizedBox(height: 22),
            FilledButton(
              onPressed: _enviando ? null : _cadastrar,
              child: _enviando
                  ? const SizedBox(
                      width: 22, height: 22,
                      child: CircularProgressIndicator(
                          strokeWidth: 2.5, color: Colors.white))
                  : const Text('Criar conta'),
            ),
          ],
        ),
      ),
    );
  }
}
