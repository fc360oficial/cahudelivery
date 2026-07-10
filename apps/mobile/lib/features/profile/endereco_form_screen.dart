import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

import '../../core/api_client.dart';

/// Cadastro/edição de endereço de entrega (POST/PUT /v1/perfil/enderecos).
/// Usado pelo checkout e pela aba Perfil. CEP preenche o resto via ViaCEP.
class EnderecoFormScreen extends StatefulWidget {
  const EnderecoFormScreen({super.key, this.endereco});

  /// null = novo endereço; preenchido = edição.
  final Map<String, dynamic>? endereco;

  @override
  State<EnderecoFormScreen> createState() => _EnderecoFormScreenState();
}

class _EnderecoFormScreenState extends State<EnderecoFormScreen> {
  final _form = GlobalKey<FormState>();
  late final _apelido = TextEditingController(text: widget.endereco?['apelido'] ?? '');
  late final _cep = TextEditingController(text: widget.endereco?['cep'] ?? '');
  late final _logradouro = TextEditingController(text: widget.endereco?['logradouro'] ?? '');
  late final _numero = TextEditingController(text: widget.endereco?['numero'] ?? '');
  late final _complemento = TextEditingController(text: widget.endereco?['complemento'] ?? '');
  late final _bairro = TextEditingController(text: widget.endereco?['bairro'] ?? '');
  late final _cidade = TextEditingController(text: widget.endereco?['cidade'] ?? '');
  late final _uf = TextEditingController(text: widget.endereco?['uf'] ?? '');
  late bool _padrao = widget.endereco?['padrao'] == true;
  bool _salvando = false;
  bool _buscandoCep = false;

  @override
  void dispose() {
    for (final c in [_apelido, _cep, _logradouro, _numero, _complemento, _bairro, _cidade, _uf]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _buscarCep() async {
    final cep = _cep.text.replaceAll(RegExp(r'\D'), '');
    if (cep.length != 8) return;
    setState(() => _buscandoCep = true);
    try {
      final r = await http
          .get(Uri.parse('https://viacep.com.br/ws/$cep/json/'))
          .timeout(const Duration(seconds: 6));
      final d = jsonDecode(r.body) as Map<String, dynamic>;
      if (d['erro'] != true && mounted) {
        _logradouro.text = d['logradouro'] ?? _logradouro.text;
        _bairro.text = d['bairro'] ?? _bairro.text;
        _cidade.text = d['localidade'] ?? _cidade.text;
        _uf.text = d['uf'] ?? _uf.text;
      }
    } catch (_) {
      // ViaCEP fora do ar não bloqueia o cadastro manual
    } finally {
      if (mounted) setState(() => _buscandoCep = false);
    }
  }

  Future<void> _salvar() async {
    if (!_form.currentState!.validate()) return;
    setState(() => _salvando = true);
    final corpo = {
      'apelido': _apelido.text.trim().isEmpty ? null : _apelido.text.trim(),
      'cep': _cep.text.trim(),
      'logradouro': _logradouro.text.trim(),
      'numero': _numero.text.trim(),
      'complemento': _complemento.text.trim().isEmpty ? null : _complemento.text.trim(),
      'bairro': _bairro.text.trim(),
      'cidade': _cidade.text.trim(),
      'uf': _uf.text.trim().toUpperCase(),
      'padrao': _padrao,
    };
    try {
      final salvo = widget.endereco == null
          ? await ApiClient.instance.post('/perfil/enderecos', corpo)
          : await ApiClient.instance
              .put('/perfil/enderecos/${widget.endereco!['id']}', corpo);
      if (mounted) Navigator.of(context).pop(salvo as Map<String, dynamic>);
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
      if (mounted) setState(() => _salvando = false);
    }
  }

  String? _obrigatorio(String? v) =>
      (v == null || v.trim().isEmpty) ? 'Campo obrigatório' : null;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
          title: Text(widget.endereco == null ? 'Novo endereço' : 'Editar endereço')),
      body: Form(
        key: _form,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            TextFormField(
              controller: _cep,
              decoration: InputDecoration(
                labelText: 'CEP',
                suffixIcon: _buscandoCep
                    ? const Padding(
                        padding: EdgeInsets.all(12),
                        child: SizedBox(
                            width: 20, height: 20,
                            child: CircularProgressIndicator(strokeWidth: 2)))
                    : null,
              ),
              keyboardType: TextInputType.number,
              maxLength: 9,
              validator: (v) =>
                  (v ?? '').replaceAll(RegExp(r'\D'), '').length == 8 ? null : 'CEP inválido',
              onChanged: (v) {
                if (v.replaceAll(RegExp(r'\D'), '').length == 8) _buscarCep();
              },
            ),
            const SizedBox(height: 4),
            TextFormField(
                controller: _logradouro,
                decoration: const InputDecoration(labelText: 'Rua / Avenida'),
                validator: _obrigatorio),
            const SizedBox(height: 14),
            Row(
              children: [
                Expanded(
                  child: TextFormField(
                      controller: _numero,
                      decoration: const InputDecoration(labelText: 'Número'),
                      validator: _obrigatorio),
                ),
                const SizedBox(width: 12),
                Expanded(
                  flex: 2,
                  child: TextFormField(
                      controller: _complemento,
                      decoration:
                          const InputDecoration(labelText: 'Complemento (opcional)')),
                ),
              ],
            ),
            const SizedBox(height: 14),
            TextFormField(
                controller: _bairro,
                decoration: const InputDecoration(labelText: 'Bairro'),
                validator: _obrigatorio),
            const SizedBox(height: 14),
            Row(
              children: [
                Expanded(
                  flex: 3,
                  child: TextFormField(
                      controller: _cidade,
                      decoration: const InputDecoration(labelText: 'Cidade'),
                      validator: _obrigatorio),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: TextFormField(
                    controller: _uf,
                    decoration: const InputDecoration(labelText: 'UF'),
                    maxLength: 2,
                    textCapitalization: TextCapitalization.characters,
                    validator: (v) =>
                        (v ?? '').trim().length == 2 ? null : 'UF',
                  ),
                ),
              ],
            ),
            const SizedBox(height: 4),
            TextFormField(
                controller: _apelido,
                decoration: const InputDecoration(
                    labelText: 'Apelido (opcional)', hintText: 'Ex.: Loja centro')),
            const SizedBox(height: 8),
            SwitchListTile(
              value: _padrao,
              onChanged: (v) => setState(() => _padrao = v),
              title: const Text('Endereço padrão'),
              contentPadding: EdgeInsets.zero,
            ),
            const SizedBox(height: 12),
            FilledButton(
              onPressed: _salvando ? null : _salvar,
              child: _salvando
                  ? const SizedBox(
                      width: 22, height: 22,
                      child: CircularProgressIndicator(strokeWidth: 2.5, color: Colors.white))
                  : const Text('Salvar endereço'),
            ),
          ],
        ),
      ),
    );
  }
}
