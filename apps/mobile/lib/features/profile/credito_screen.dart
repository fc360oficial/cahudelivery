import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../widgets/estados.dart';

/// Crédito pra boleto a prazo (GET/POST /v1/credito). Sem cálculo automático de
/// limite — fila manual até a Fase 4 (integração Dlinks) trazer dado real.
class CreditoScreen extends StatefulWidget {
  const CreditoScreen({super.key});

  @override
  State<CreditoScreen> createState() => _CreditoScreenState();
}

class _CreditoScreenState extends State<CreditoScreen> {
  bool? _pendente;
  bool _enviando = false;
  String? _erro;

  @override
  void initState() {
    super.initState();
    _carregar();
  }

  Future<void> _carregar() async {
    setState(() {
      _pendente = null;
      _erro = null;
    });
    try {
      final r = await ApiClient.instance.get('/credito') as Map<String, dynamic>;
      if (mounted) setState(() => _pendente = r['pendente'] as bool);
    } on ApiException catch (e) {
      if (mounted) setState(() => _erro = e.message);
    } catch (_) {
      if (mounted) setState(() => _erro = 'Sem conexão — verifique sua internet');
    }
  }

  Future<void> _solicitar() async {
    setState(() => _enviando = true);
    try {
      await ApiClient.instance.post('/credito/solicitar');
      if (mounted) setState(() => _pendente = true);
    } on ApiException catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(const SnackBar(content: Text('Sem conexão — verifique sua internet')));
      }
    } finally {
      if (mounted) setState(() => _enviando = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Crédito')),
      body: _corpo(),
    );
  }

  Widget _corpo() {
    if (_erro != null) {
      return EstadoErro(mensagem: _erro, onTentarNovamente: _carregar);
    }
    if (_pendente == null) {
      return const Center(child: CircularProgressIndicator());
    }
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.speed_outlined, size: 72, color: Colors.grey.shade400),
            const SizedBox(height: 20),
            Text(
              _pendente!
                  ? 'Sua solicitação está em análise'
                  : 'Crédito para boleto a prazo indisponível',
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 10),
            Text(
              _pendente!
                  ? 'A distribuidora vai avaliar seu cadastro em breve.'
                  : 'No momento não conseguimos conceder crédito para esta conta. Solicite uma nova análise para reavaliarmos seu acesso.',
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 14, color: Colors.grey.shade600, height: 1.4),
            ),
            if (!_pendente!) ...[
              const SizedBox(height: 24),
              FilledButton(
                onPressed: _enviando ? null : _solicitar,
                child: _enviando
                    ? const SizedBox(
                        width: 18, height: 18,
                        child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                    : const Text('Solicitar análise de crédito'),
              ),
            ],
          ],
        ),
      ),
    );
  }
}