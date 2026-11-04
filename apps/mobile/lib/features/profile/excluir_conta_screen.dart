import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../widgets/campo_senha.dart';

/// Exclusão da conta pelo próprio cliente (exigência da Play e da App Store).
/// Devolve true quando a conta foi excluída.
class ExcluirContaScreen extends StatefulWidget {
  const ExcluirContaScreen({super.key, required this.documento});
  final String documento;

  @override
  State<ExcluirContaScreen> createState() => _ExcluirContaScreenState();
}

class _ExcluirContaScreenState extends State<ExcluirContaScreen> {
  final _form = GlobalKey<FormState>();
  final _senha = TextEditingController();
  bool _enviando = false;
  String? _erro;

  @override
  void dispose() {
    _senha.dispose();
    super.dispose();
  }

  Future<void> _excluir() async {
    if (!_form.currentState!.validate()) return;
    final confirmar = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Excluir sua conta?'),
        content: const Text('Essa ação não pode ser desfeita.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: Colors.red.shade600),
            onPressed: () => Navigator.of(ctx).pop(true),
            child: const Text('Excluir conta'),
          ),
        ],
      ),
    );
    if (confirmar != true) return;
    setState(() {
      _enviando = true;
      _erro = null;
    });
    try {
      await ApiClient.instance.post('/auth/excluir-conta', {
        'identificador': widget.documento,
        'senha': _senha.text,
      });
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
      appBar: AppBar(title: const Text('Excluir minha conta')),
      body: SafeArea(
        child: Form(
          key: _form,
          child: ListView(
            padding: const EdgeInsets.fromLTRB(24, 24, 24, 32),
            children: [
              const Text(
                'Ao excluir a conta, você perde o acesso ao app. Seus dados de contato, endereços, favoritos e carrinho são apagados.',
              ),
              const SizedBox(height: 12),
              const Text(
                'Notas fiscais e o histórico de compras são mantidos pelo prazo exigido em lei.',
              ),
              const SizedBox(height: 12),
              const Text(
                'Não é possível excluir com pedido em andamento ou com crédito na carteira.',
              ),
              const SizedBox(height: 20),
              CampoSenha(
                controller: _senha,
                labelText: 'Confirme sua senha',
                validator: (v) =>
                    (v ?? '').isEmpty ? 'Informe sua senha' : null,
                onFieldSubmitted: (_) => _excluir(),
              ),
              if (_erro != null) ...[
                const SizedBox(height: 14),
                Text(_erro!, style: const TextStyle(color: Colors.red)),
              ],
              const SizedBox(height: 22),
              FilledButton(
                style: FilledButton.styleFrom(
                  backgroundColor: Colors.red.shade600,
                ),
                onPressed: _enviando ? null : _excluir,
                child: _enviando
                    ? const SizedBox(
                        width: 22,
                        height: 22,
                        child: CircularProgressIndicator(strokeWidth: 2.5),
                      )
                    : const Text('Excluir minha conta'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
