import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../core/formatadores.dart';
import '../../widgets/estados.dart';

/// Inbox de notificações do cliente (GET /v1/notificacoes).
class NotificacoesScreen extends StatefulWidget {
  const NotificacoesScreen({super.key});

  @override
  State<NotificacoesScreen> createState() => _NotificacoesScreenState();
}

class _NotificacoesScreenState extends State<NotificacoesScreen> {
  List<Map<String, dynamic>>? _notificacoes;
  String? _erro;

  @override
  void initState() {
    super.initState();
    _carregar();
  }

  Future<void> _carregar() async {
    setState(() {
      _notificacoes = null;
      _erro = null;
    });
    try {
      final r = await ApiClient.instance.get('/notificacoes') as List;
      if (mounted) setState(() => _notificacoes = List<Map<String, dynamic>>.from(r));
    } on ApiException catch (e) {
      if (mounted) setState(() => _erro = e.message);
    } catch (_) {
      if (mounted) setState(() => _erro = 'Sem conexão — verifique sua internet');
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Notificações')),
      body: _erro != null
          ? EstadoErro(mensagem: _erro, onTentarNovamente: _carregar)
          : _notificacoes == null
              ? ListView(
                  physics: const NeverScrollableScrollPhysics(),
                  padding: const EdgeInsets.all(16),
                  children: List.generate(
                      4,
                      (_) => const Padding(
                          padding: EdgeInsets.only(bottom: 12),
                          child: Esqueleto(height: 76, radius: 16))),
                )
              : _notificacoes!.isEmpty
                  ? const EstadoVazio(
                      icone: Icons.notifications_none,
                      titulo: 'Nenhuma notificação',
                      mensagem: 'Avisos e novidades da distribuidora aparecem aqui.')
                  : RefreshIndicator(
                      onRefresh: _carregar,
                      child: ListView.separated(
                        padding: const EdgeInsets.all(16),
                        itemCount: _notificacoes!.length,
                        separatorBuilder: (_, i) => const SizedBox(height: 10),
                        itemBuilder: (_, i) {
                          final n = _notificacoes![i];
                          final naoLida = n['lida_em'] == null;
                          return Card(
                            child: ListTile(
                              contentPadding: const EdgeInsets.symmetric(
                                  horizontal: 16, vertical: 6),
                              leading: Icon(
                                naoLida
                                    ? Icons.notifications_active
                                    : Icons.notifications_none,
                                color: naoLida
                                    ? Theme.of(context).colorScheme.primary
                                    : Colors.grey.shade400,
                              ),
                              title: Text(n['titulo'] ?? '',
                                  style: TextStyle(
                                      fontSize: 14,
                                      fontWeight: naoLida
                                          ? FontWeight.w800
                                          : FontWeight.w600)),
                              subtitle: Padding(
                                padding: const EdgeInsets.only(top: 2),
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(n['corpo'] ?? '',
                                        style: const TextStyle(
                                            fontSize: 13, height: 1.35)),
                                    const SizedBox(height: 4),
                                    Text(dataHora(n['enviada_em']),
                                        style: TextStyle(
                                            fontSize: 11.5,
                                            color: Colors.grey.shade500)),
                                  ],
                                ),
                              ),
                            ),
                          );
                        },
                      ),
                    ),
    );
  }
}
