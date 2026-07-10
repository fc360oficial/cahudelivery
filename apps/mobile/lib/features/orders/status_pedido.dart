import 'package:flutter/material.dart';

/// Mapa visual dos status do pedido (mesma máquina de estados da API).
class StatusPedido {
  const StatusPedido._(this.rotulo, this.cor, this.icone);
  final String rotulo;
  final Color cor;
  final IconData icone;

  static StatusPedido de(String? status) => switch (status) {
        'RECEBIDO' => StatusPedido._('Recebido', Colors.blueGrey, Icons.inbox_outlined),
        'ENVIADO_ERP' => StatusPedido._('Em processamento', Colors.blue, Icons.sync),
        'FATURADO' => StatusPedido._('Faturado', Colors.indigo, Icons.request_quote_outlined),
        'EM_SEPARACAO' =>
          StatusPedido._('Em separação', Colors.orange, Icons.inventory_outlined),
        'SAIU_ENTREGA' =>
          StatusPedido._('Saiu para entrega', Colors.teal, Icons.local_shipping_outlined),
        'ENTREGUE' => StatusPedido._('Entregue', Colors.green, Icons.check_circle_outline),
        'CANCELADO' => StatusPedido._('Cancelado', Colors.red, Icons.cancel_outlined),
        _ => StatusPedido._(status ?? '—', Colors.grey, Icons.help_outline),
      };
}

class ChipStatus extends StatelessWidget {
  const ChipStatus({super.key, required this.status});
  final String? status;

  @override
  Widget build(BuildContext context) {
    final s = StatusPedido.de(status);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: s.cor.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(s.icone, size: 14, color: s.cor),
          const SizedBox(width: 5),
          Text(s.rotulo,
              style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: s.cor)),
        ],
      ),
    );
  }
}
