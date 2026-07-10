import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../core/formatadores.dart' as fmt;

/// Edição dos dados cadastrais permitidos (PUT /v1/perfil).
/// Documento, razão social e e-mail são somente leitura — mudam via distribuidora.
class PerfilDadosScreen extends StatefulWidget {
  const PerfilDadosScreen({super.key, required this.perfil});
  final Map<String, dynamic> perfil;

  @override
  State<PerfilDadosScreen> createState() => _PerfilDadosScreenState();
}

class _PerfilDadosScreenState extends State<PerfilDadosScreen> {
  late final _nomeFantasia =
      TextEditingController(text: widget.perfil['nome_fantasia'] ?? '');
  late final _telefone = TextEditingController(text: widget.perfil['telefone'] ?? '');
  bool _salvando = false;

  @override
  void dispose() {
    _nomeFantasia.dispose();
    _telefone.dispose();
    super.dispose();
  }

  Future<void> _salvar() async {
    setState(() => _salvando = true);
    try {
      await ApiClient.instance.put('/perfil', {
        'nomeFantasia': _nomeFantasia.text.trim(),
        'telefone': _telefone.text.trim(),
      });
      if (mounted) Navigator.of(context).pop(true);
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

  @override
  Widget build(BuildContext context) {
    final p = widget.perfil;
    return Scaffold(
      appBar: AppBar(title: const Text('Dados cadastrais')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          TextFormField(
            initialValue: '${p['tipo']} ${fmt.documento(p['documento'] as String?)}',
            enabled: false,
            decoration: const InputDecoration(labelText: 'Documento'),
          ),
          const SizedBox(height: 14),
          if (p['razao_social'] != null) ...[
            TextFormField(
              initialValue: p['razao_social'],
              enabled: false,
              decoration: const InputDecoration(labelText: 'Razão social'),
            ),
            const SizedBox(height: 14),
          ],
          TextFormField(
            initialValue: p['email'],
            enabled: false,
            decoration: const InputDecoration(labelText: 'E-mail'),
          ),
          const SizedBox(height: 14),
          TextField(
            controller: _nomeFantasia,
            decoration: const InputDecoration(labelText: 'Nome fantasia'),
          ),
          const SizedBox(height: 14),
          TextField(
            controller: _telefone,
            keyboardType: TextInputType.phone,
            decoration: const InputDecoration(labelText: 'Telefone / WhatsApp'),
          ),
          const SizedBox(height: 8),
          Text(
            'Para alterar documento, razão social ou e-mail, fale com a distribuidora.',
            style: TextStyle(fontSize: 12.5, color: Colors.grey.shade600),
          ),
          const SizedBox(height: 20),
          FilledButton(
            onPressed: _salvando ? null : _salvar,
            child: _salvando
                ? const SizedBox(
                    width: 22, height: 22,
                    child:
                        CircularProgressIndicator(strokeWidth: 2.5, color: Colors.white))
                : const Text('Salvar'),
          ),
        ],
      ),
    );
  }
}
