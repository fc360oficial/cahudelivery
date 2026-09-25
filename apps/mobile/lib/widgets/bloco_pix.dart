import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:qr_flutter/qr_flutter.dart';

import '../core/formatadores.dart';

/// QR + copia-e-cola + contador. Usado na tela pós-checkout e no detalhe do pedido.
/// [pagamento] é o objeto `pagamento` que a API devolve em /pedidos.
class BlocoPix extends StatefulWidget {
  const BlocoPix({super.key, required this.pagamento});
  final Map<String, dynamic> pagamento;

  @override
  State<BlocoPix> createState() => _BlocoPixState();
}

class _BlocoPixState extends State<BlocoPix> {
  Timer? _timer;
  Duration _restante = Duration.zero;

  DateTime? get _expiraEm {
    final v = widget.pagamento['expiraEm'];
    return v == null ? null : DateTime.tryParse('$v')?.toLocal();
  }

  @override
  void initState() {
    super.initState();
    _atualizar();
    if ('${widget.pagamento['status']}' == 'pendente') {
      _timer = Timer.periodic(const Duration(seconds: 1), (_) => _atualizar());
    }
  }

  void _atualizar() {
    final e = _expiraEm;
    if (e == null) return;
    final r = e.difference(DateTime.now());
    final zerou = r.isNegative;
    if (mounted) setState(() => _restante = zerou ? Duration.zero : r);
    if (zerou) {
      _timer?.cancel();
      _timer = null;
    }
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  Future<void> _copiar(String codigo) async {
    await Clipboard.setData(ClipboardData(text: codigo));
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Código PIX copiado!')));
  }

  @override
  Widget build(BuildContext context) {
    final p = widget.pagamento;
    final status = '${p['status']}';
    final codigo = p['copiaCola'] as String?;
    final cor = Theme.of(context).colorScheme.primary;

    if (status == 'pago') {
      return _cartao(Icons.check_circle, Colors.green.shade600, 'PIX pago',
          p['pagoEm'] != null ? 'Confirmado em ${dataHora(p['pagoEm'])}' : 'Pagamento confirmado');
    }
    if (status == 'expirado') {
      return _cartao(Icons.timer_off, Colors.red.shade600, 'PIX expirado',
          'O prazo de pagamento acabou e o pedido foi cancelado.');
    }
    if (status == 'cancelado') {
      return _cartao(Icons.cancel, Colors.red.shade600, 'PIX cancelado',
          'A cobrança foi cancelada e o pedido não seguiu.');
    }
    if (status == 'falhou') {
      return _cartao(Icons.error_outline, Colors.red.shade600, 'Falha no PIX',
          'Não foi possível gerar a cobrança. Refaça o pedido.');
    }
    if (status == 'pendente' && codigo == null) {
      return _cartao(Icons.hourglass_top, cor, 'Gerando código PIX…', 'Isso leva só alguns segundos.');
    }
    if (status != 'pendente' || codigo == null) {
      // Status que não reconhecemos: nunca afirmar "expirado" sem saber — só sinaliza que não dá
      // pra mostrar o pagamento agora, sem inventar um motivo.
      return _cartao(Icons.error_outline, Colors.red.shade600, 'Pagamento indisponível',
          'Não foi possível carregar a situação do pagamento. Atualize a tela do pedido.');
    }
    final mm = _restante.inMinutes.remainder(60).toString().padLeft(2, '0');
    final ss = _restante.inSeconds.remainder(60).toString().padLeft(2, '0');
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            Text('Pague ${moeda(p['valor'])} com PIX',
                style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
            if (_expiraEm != null) ...[
              const SizedBox(height: 4),
              Text(_restante == Duration.zero ? 'Prazo encerrado' : 'Expira em $mm:$ss',
                  style: TextStyle(color: cor, fontWeight: FontWeight.w700)),
            ],
            const SizedBox(height: 12),
            QrImageView(data: codigo, size: 220, backgroundColor: Colors.white),
            const SizedBox(height: 12),
            FilledButton.icon(
              onPressed: () => _copiar(codigo),
              icon: const Icon(Icons.copy),
              label: const Text('Copiar código PIX'),
            ),
            const SizedBox(height: 8),
            Text('Abra o app do seu banco, escolha PIX copia e cola e cole o código. '
                'Assim que pagar, o pedido segue automaticamente.',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 13, color: Colors.grey.shade700, height: 1.4)),
          ],
        ),
      ),
    );
  }

  Widget _cartao(IconData icone, Color cor, String titulo, String texto) {
    return Card(
      child: ListTile(
        leading: Icon(icone, color: cor, size: 32),
        title: Text(titulo, style: const TextStyle(fontWeight: FontWeight.w800)),
        subtitle: Text(texto),
      ),
    );
  }
}
