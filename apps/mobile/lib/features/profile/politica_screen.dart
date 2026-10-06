import 'package:flutter/material.dart';

import '../../core/tenant_theme.dart';

/// Texto de política do tenant (privacidade, cancelamento/reembolso), vindo
/// das configurações da retaguarda. Exigência de loja de aplicativo (LGPD) e
/// do pagamento online (CDC art. 49 — direito de arrependimento): o cliente
/// precisa achar as regras dentro do próprio app.
class PoliticaScreen extends StatelessWidget {
  const PoliticaScreen({super.key, required this.titulo, required this.chave});
  final String titulo;
  final String chave; // 'politica_privacidade' | 'politica_cancelamento'

  /// Texto da config quando preenchido; nulo esconde a entrada no Perfil.
  static String? texto(String chave) {
    final v = TenantTheme.instance.configuracoes[chave];
    return v is String && v.trim().isNotEmpty ? v : null;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(titulo)),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          SelectableText(
            texto(chave) ?? '',
            style: const TextStyle(fontSize: 14, height: 1.55),
          ),
        ],
      ),
    );
  }
}
