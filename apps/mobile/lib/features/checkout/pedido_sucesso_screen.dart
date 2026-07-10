import 'package:flutter/material.dart';

import '../orders/pedido_detalhe_screen.dart';

/// Confirmação do pedido: número, próximo passo e atalho para acompanhar.
class PedidoSucessoScreen extends StatelessWidget {
  const PedidoSucessoScreen({super.key, required this.pedido});
  final Map<String, dynamic> pedido;

  @override
  Widget build(BuildContext context) {
    final cor = Theme.of(context).colorScheme.primary;
    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            children: [
              const Spacer(),
              TweenAnimationBuilder<double>(
                tween: Tween(begin: 0, end: 1),
                duration: const Duration(milliseconds: 500),
                curve: Curves.elasticOut,
                builder: (_, v, child) => Transform.scale(scale: v, child: child),
                child: CircleAvatar(
                  radius: 44,
                  backgroundColor: Colors.green.shade50,
                  child: Icon(Icons.check_circle, size: 64, color: Colors.green.shade600),
                ),
              ),
              const SizedBox(height: 24),
              const Text('Pedido enviado!',
                  style: TextStyle(fontSize: 24, fontWeight: FontWeight.w800)),
              const SizedBox(height: 8),
              Text('Pedido nº ${pedido['numero']}',
                  style: TextStyle(
                      fontSize: 17, fontWeight: FontWeight.w700, color: cor)),
              const SizedBox(height: 12),
              Text(
                'A distribuidora vai confirmar e faturar seu pedido. '
                'Você recebe a cobrança e acompanha cada etapa na aba Pedidos.',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 14, height: 1.5, color: Colors.grey.shade700),
              ),
              const Spacer(),
              FilledButton(
                onPressed: () => Navigator.of(context).pushReplacement(MaterialPageRoute(
                    builder: (_) =>
                        PedidoDetalheScreen(pedidoId: pedido['id'] as String))),
                child: const Text('Acompanhar pedido'),
              ),
              const SizedBox(height: 10),
              TextButton(
                onPressed: () =>
                    Navigator.of(context).popUntil((rota) => rota.isFirst),
                child: const Text('Voltar ao início'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
