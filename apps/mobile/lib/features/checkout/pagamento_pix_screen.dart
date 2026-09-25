import 'dart:async';

import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../widgets/bloco_pix.dart';
import '../orders/pedido_detalhe_screen.dart';

/// Depois do "Confirmar pedido" com PIX online: mostra o QR e consulta o pedido
/// a cada 5 s até sair de AGUARDANDO_PAGAMENTO.
class PagamentoPixScreen extends StatefulWidget {
  const PagamentoPixScreen({super.key, required this.pedido});
  final Map<String, dynamic> pedido; // resposta do POST /pedidos (com 'pagamento')

  @override
  State<PagamentoPixScreen> createState() => _PagamentoPixScreenState();
}

class _PagamentoPixScreenState extends State<PagamentoPixScreen> {
  late Map<String, dynamic> _pedido = widget.pedido;
  Timer? _poll;

  @override
  void initState() {
    super.initState();
    _poll = Timer.periodic(const Duration(seconds: 5), (_) => _consultar());
  }

  Future<void> _consultar() async {
    try {
      final r = await ApiClient.instance.get('/pedidos/${_pedido['id']}') as Map<String, dynamic>;
      if (!mounted) return;
      setState(() => _pedido = r);
      if (r['status'] != 'AGUARDANDO_PAGAMENTO') {
        _poll?.cancel();
        final pago = r['status'] != 'CANCELADO';
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
            content: Text(pago ? 'Pagamento confirmado! Pedido enviado.' : 'PIX expirado, pedido cancelado.')));
        Navigator.of(context).pushReplacement(MaterialPageRoute(
            builder: (_) => PedidoDetalheScreen(pedidoId: r['id'] as String)));
      }
    } catch (_) {
      // Sem rede: mantém QR e contador; a próxima rodada tenta de novo.
    }
  }

  @override
  void dispose() {
    _poll?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final pagamento = (_pedido['pagamento'] as Map<String, dynamic>?) ?? {};
    return Scaffold(
      appBar: AppBar(title: Text('Pedido nº ${_pedido['numero']}')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          BlocoPix(pagamento: pagamento),
          const SizedBox(height: 16),
          TextButton(
            onPressed: () => Navigator.of(context).pushReplacement(MaterialPageRoute(
                builder: (_) => PedidoDetalheScreen(pedidoId: _pedido['id'] as String))),
            child: const Text('Pagar depois (ver pedido)'),
          ),
        ],
      ),
    );
  }
}
