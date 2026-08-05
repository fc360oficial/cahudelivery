import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../core/api_client.dart';
import '../../core/formatadores.dart';
import '../../widgets/estados.dart';

/// "Indique e ganhe" (GET /v1/indicacoes) — cliente indica outro mercado
/// parceiro e ganha R$100 de saldo quando o indicado fatura o 1º pedido.
class IndicacoesScreen extends StatefulWidget {
  const IndicacoesScreen({super.key});

  @override
  State<IndicacoesScreen> createState() => _IndicacoesScreenState();
}

class _IndicacoesScreenState extends State<IndicacoesScreen> {
  String? _codigo;
  String? _link;
  List<Map<String, dynamic>>? _indicacoes;
  String? _erro;

  @override
  void initState() {
    super.initState();
    _carregar();
  }

  Future<void> _carregar() async {
    setState(() {
      _codigo = null;
      _link = null;
      _indicacoes = null;
      _erro = null;
    });
    try {
      final r = await ApiClient.instance.get('/indicacoes') as Map<String, dynamic>;
      if (mounted) {
        setState(() {
          _codigo = r['codigo'] as String?;
          _link = r['link'] as String?;
          _indicacoes = List<Map<String, dynamic>>.from(r['indicacoes'] as List? ?? const []);
        });
      }
    } on ApiException catch (e) {
      if (mounted) setState(() => _erro = e.message);
    } catch (_) {
      if (mounted) setState(() => _erro = 'Sem conexão — verifique sua internet');
    }
  }

  Future<void> _copiarLink() async {
    if (_link == null) return;
    await Clipboard.setData(ClipboardData(text: _link!));
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Link copiado!'), behavior: SnackBarBehavior.floating));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Indique e ganhe')),
      body: _corpo(),
    );
  }

  Widget _corpo() {
    if (_erro != null) {
      return EstadoErro(mensagem: _erro, onTentarNovamente: _carregar);
    }
    if (_codigo == null) {
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
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Indique um mercado parceiro',
                      style: TextStyle(fontSize: 13, color: Colors.grey.shade600)),
                  const SizedBox(height: 4),
                  const Text('Ganhe R\$100 de saldo quando ele fizer o primeiro pedido',
                      style: TextStyle(fontSize: 15, fontWeight: FontWeight.w800)),
                  const SizedBox(height: 16),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                    decoration: BoxDecoration(
                      color: Colors.grey.shade100,
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Row(
                      children: [
                        Expanded(
                          child: Text(_codigo!,
                              style: const TextStyle(
                                  fontSize: 20, fontWeight: FontWeight.w800, letterSpacing: 2)),
                        ),
                        TextButton.icon(
                          onPressed: _copiarLink,
                          icon: const Icon(Icons.copy, size: 18),
                          label: const Text('Copiar link'),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),
          if (_indicacoes!.isEmpty)
            const Padding(
              padding: EdgeInsets.only(top: 24),
              child: EstadoVazio(
                icone: Icons.card_giftcard_outlined,
                titulo: 'Nenhuma indicação ainda',
                mensagem: 'Indique um mercado parceiro e ganhe R\$100 quando ele fizer o primeiro pedido.',
              ),
            )
          else
            ..._indicacoes!.map((i) {
              final creditado = i['status'] == 'creditado';
              return Card(
                child: ListTile(
                  leading: Icon(
                    creditado ? Icons.check_circle : Icons.hourglass_top_outlined,
                    color: creditado ? Colors.green.shade700 : Colors.orange.shade700,
                  ),
                  title: Text(i['nome'] ?? ''),
                  subtitle: Text(creditado
                      ? 'R\$100 creditados em ${dataHora(i['creditado_em'])}'
                      : 'Aguardando primeiro pedido'),
                ),
              );
            }),
        ],
      ),
    );
  }
}
