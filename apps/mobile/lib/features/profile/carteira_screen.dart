import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../core/formatadores.dart';
import '../../widgets/estados.dart';

/// Saldo da carteira (GET /v1/carteira) — alimentado manualmente pela
/// distribuidora (devolução, ajuste). Sem cálculo automático.
class CarteiraScreen extends StatefulWidget {
  const CarteiraScreen({super.key});

  @override
  State<CarteiraScreen> createState() => _CarteiraScreenState();
}

class _CarteiraScreenState extends State<CarteiraScreen> {
  double? _saldo;
  List<Map<String, dynamic>>? _movimentos;
  String? _erro;

  @override
  void initState() {
    super.initState();
    _carregar();
  }

  Future<void> _carregar() async {
    setState(() {
      _saldo = null;
      _movimentos = null;
      _erro = null;
    });
    try {
      final r = await ApiClient.instance.get('/carteira') as Map<String, dynamic>;
      if (mounted) {
        setState(() {
          _saldo = asDouble(r['saldo']);
          _movimentos = List<Map<String, dynamic>>.from(r['movimentos'] as List? ?? const []);
        });
      }
    } on ApiException catch (e) {
      if (mounted) setState(() => _erro = e.message);
    } catch (_) {
      if (mounted) setState(() => _erro = 'Sem conexão — verifique sua internet');
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Carteira')),
      body: _corpo(),
    );
  }

  Widget _corpo() {
    if (_erro != null) {
      return EstadoErro(mensagem: _erro, onTentarNovamente: _carregar);
    }
    if (_saldo == null) {
      return const Center(child: CircularProgressIndicator());
    }
    return RefreshIndicator(
      onRefresh: _carregar,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Row(
                children: [
                  Icon(Icons.account_balance_wallet_outlined,
                      color: Colors.green.shade700, size: 32),
                  const SizedBox(width: 14),
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('Saldo na carteira',
                          style: TextStyle(fontSize: 13, color: Colors.grey.shade600)),
                      Text(moeda(_saldo),
                          style: TextStyle(
                              fontSize: 22, fontWeight: FontWeight.w800, color: Colors.green.shade700)),
                    ],
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),
          if (_movimentos!.isEmpty)
            const Padding(
              padding: EdgeInsets.only(top: 24),
              child: EstadoVazio(
                icone: Icons.receipt_long_outlined,
                titulo: 'Sem movimentações',
                mensagem: 'Suas movimentações aparecerão aqui.',
              ),
            )
          else
            ..._movimentos!.map((m) {
              final valor = asDouble(m['valor']);
              final positivo = valor >= 0;
              return Card(
                child: ListTile(
                  leading: Icon(
                    positivo ? Icons.add_circle_outline : Icons.remove_circle_outline,
                    color: positivo ? Colors.green.shade700 : Colors.red.shade600,
                  ),
                  title: Text(m['motivo'] ?? ''),
                  subtitle: Text(dataHora(m['criado_em'])),
                  trailing: Text(
                    '${positivo ? '+' : ''}${moeda(valor)}',
                    style: TextStyle(
                        fontWeight: FontWeight.w800,
                        color: positivo ? Colors.green.shade700 : Colors.red.shade600),
                  ),
                ),
              );
            }),
        ],
      ),
    );
  }
}
