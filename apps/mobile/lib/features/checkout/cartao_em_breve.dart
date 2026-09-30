import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

/// Card "Cartão de crédito — em breve" do checkout (Fase 1, decidida em
/// 30/09/2026): enquanto o cartão online (Rede) não existe, o cartão aparece
/// travado, sem prometer prazo nem regra de liberação, e manda quem quer
/// pagar no cartão comprar direto na distribuidora. Some quando a retaguarda
/// religa 'cartao' em formas_pagamento ou desliga 'cartao_em_breve'.
///
/// Fase 2 (quando o cartão online entrar): o mesmo card vira "Em análise" e
/// libera após 2 pedidos pagos no PIX — não misturar com esta fase.

/// Só mostra quando a retaguarda ligou o aviso E o cartão está fora das
/// formas aceitas. Sem config de formas o app exibe todas (inclui cartão),
/// então também não mostra.
bool mostrarCartaoEmBreve(Map<String, dynamic> cfg) {
  if (cfg['cartao_em_breve'] != true) return false;
  final formas = (cfg['formas_pagamento'] as List?)?.map((e) => '$e').toSet();
  if (formas == null) return false;
  return !formas.contains('cartao');
}

/// wa.me com DDI 55, a partir do número como a retaguarda salvou
/// ("(81) 98646-0098", "+55 81 ..."). Nulo quando não há número.
String? linkWhatsApp(String? numero) {
  final digitos = (numero ?? '').replaceAll(RegExp(r'\D'), '');
  if (digitos.isEmpty) return null;
  final completo = digitos.startsWith('55') && digitos.length > 11 ? digitos : '55$digitos';
  return 'https://wa.me/$completo';
}

const _texto = 'Ainda não disponível no app. Para pagar no cartão, compre direto na distribuidora.';

class CartaoEmBreveCard extends StatelessWidget {
  const CartaoEmBreveCard({super.key, required this.whatsapp, required this.horario});

  /// Número do WhatsApp da distribuidora (config 'contato_whatsapp'); sem ele
  /// o card só explica, sem botão de contato.
  final String? whatsapp;

  /// Texto pronto do horário de atendimento, se houver.
  final String? horario;

  @override
  Widget build(BuildContext context) {
    final cinza = Colors.grey.shade600;
    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(color: Colors.grey.shade200),
      ),
      child: InkWell(
        onTap: () => _abrirAviso(context),
        borderRadius: BorderRadius.circular(16),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 14, 16, 14),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(Icons.credit_card, color: cinza, size: 30),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Text('Cartão de crédito',
                            style: TextStyle(
                                fontWeight: FontWeight.w700, fontSize: 15, color: cinza)),
                        const SizedBox(width: 8),
                        const _SeloEmBreve(),
                      ],
                    ),
                    const SizedBox(height: 4),
                    Text(_texto,
                        style: TextStyle(fontSize: 12.5, height: 1.4, color: Colors.grey.shade800)),
                    if (linkWhatsApp(whatsapp) != null) ...[
                      const SizedBox(height: 6),
                      const Text('Falar com a distribuidora',
                          style: TextStyle(
                              fontSize: 13,
                              fontWeight: FontWeight.w700,
                              decoration: TextDecoration.underline)),
                    ],
                  ],
                ),
              ),
              const SizedBox(width: 8),
              Icon(Icons.lock_outline, color: cinza, size: 20),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _abrirAviso(BuildContext context) {
    final link = linkWhatsApp(whatsapp);
    return showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(22))),
      builder: (ctx) => SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(20, 0, 20, 28),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  width: 48,
                  height: 48,
                  decoration: BoxDecoration(
                    color: Theme.of(ctx).colorScheme.primary.withValues(alpha: 0.25),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: const Icon(Icons.lock_outline, size: 26),
                ),
                const SizedBox(width: 12),
                const Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Cartão de crédito',
                        style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
                    _SeloEmBreve(),
                  ],
                ),
              ],
            ),
            const SizedBox(height: 16),
            const Text(_texto, style: TextStyle(fontSize: 15, height: 1.5)),
            if (horario != null && horario!.trim().isNotEmpty) ...[
              const SizedBox(height: 10),
              Text(horario!, style: TextStyle(fontSize: 13, color: Colors.grey.shade700)),
            ],
            const SizedBox(height: 18),
            if (link != null) ...[
              FilledButton.icon(
                onPressed: () => launchUrl(Uri.parse(link), mode: LaunchMode.externalApplication),
                style: FilledButton.styleFrom(
                    backgroundColor: const Color(0xFF1A1A1A), foregroundColor: Colors.white),
                icon: const Icon(Icons.chat_outlined),
                label: const Text('Chamar no WhatsApp'),
              ),
              const SizedBox(height: 10),
            ],
            OutlinedButton(
              onPressed: () => Navigator.of(ctx).pop(),
              style: OutlinedButton.styleFrom(
                minimumSize: const Size.fromHeight(48),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
              ),
              child: const Text('Pagar com PIX'),
            ),
          ],
        ),
      ),
    );
  }
}

class _SeloEmBreve extends StatelessWidget {
  const _SeloEmBreve();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.primary.withValues(alpha: 0.3),
        borderRadius: BorderRadius.circular(999),
      ),
      child: const Text('EM BREVE',
          style: TextStyle(fontSize: 10.5, fontWeight: FontWeight.w800, letterSpacing: 0.4)),
    );
  }
}
