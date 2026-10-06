import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../core/api_client.dart';
import '../../core/formatadores.dart';
import '../orders/pedido_detalhe_screen.dart';

/// Depois do "Confirmar pedido" com cartão online: formulário do cartão e
/// POST /pedidos/{id}/pagar-cartao. Recusa não cancela o pedido — o cliente
/// pode corrigir os dados ou tentar outro cartão dentro da janela (30 min);
/// se sair sem pagar, o worker expira e o pedido é cancelado sozinho.
class PagamentoCartaoScreen extends StatefulWidget {
  const PagamentoCartaoScreen({super.key, required this.pedido});
  final Map<String, dynamic> pedido; // resposta do POST /pedidos (com 'pagamento')

  @override
  State<PagamentoCartaoScreen> createState() => _PagamentoCartaoScreenState();
}

class _PagamentoCartaoScreenState extends State<PagamentoCartaoScreen> {
  final _form = GlobalKey<FormState>();
  final _numero = TextEditingController();
  final _nome = TextEditingController();
  final _validade = TextEditingController();
  final _cvv = TextEditingController();
  bool _pagando = false;
  String? _recusa;

  @override
  void dispose() {
    _numero.dispose();
    _nome.dispose();
    _validade.dispose();
    _cvv.dispose();
    super.dispose();
  }

  Future<void> _pagar() async {
    if (!_form.currentState!.validate()) return;
    setState(() {
      _pagando = true;
      _recusa = null;
    });
    final partes = _validade.text.split('/');
    try {
      final r = await ApiClient.instance.post(
        '/pedidos/${widget.pedido['id']}/pagar-cartao',
        {
          'numero': _numero.text.replaceAll(RegExp(r'\D'), ''),
          'nome': _nome.text.trim(),
          'validadeMes': int.parse(partes[0]),
          'validadeAno': 2000 + int.parse(partes[1]),
          'cvv': _cvv.text.trim(),
        },
      ) as Map<String, dynamic>;
      if (!mounted) return;
      if (r['status'] == 'pago') {
        ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Pagamento aprovado! Pedido enviado.')));
        Navigator.of(context).pushReplacement(MaterialPageRoute(
            builder: (_) => PedidoDetalheScreen(pedidoId: widget.pedido['id'] as String)));
        return;
      }
      // recusado: mantém o formulário pro cliente corrigir ou trocar de cartão
      setState(() => _recusa = '${r['mensagem'] ?? 'Pagamento recusado. Tente outro cartão.'}');
    } on ApiException catch (e) {
      if (mounted) setState(() => _recusa = e.message);
    } catch (_) {
      if (mounted) setState(() => _recusa = 'Sem conexão — verifique sua internet e tente de novo');
    } finally {
      if (mounted) setState(() => _pagando = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final pagamento = (widget.pedido['pagamento'] as Map<String, dynamic>?) ?? {};
    final valor = asDouble(pagamento['valor']);
    return Scaffold(
      appBar: AppBar(title: Text('Pedido nº ${widget.pedido['numero']}')),
      body: Form(
        key: _form,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Row(
                  children: [
                    Icon(Icons.credit_card, color: Theme.of(context).colorScheme.primary, size: 30),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text('Pagamento com cartão de crédito',
                              style: TextStyle(fontWeight: FontWeight.w700, fontSize: 14.5)),
                          const SizedBox(height: 2),
                          Text('Total a pagar: ${moeda(valor)}',
                              style: TextStyle(
                                  fontSize: 16,
                                  fontWeight: FontWeight.w800,
                                  color: Theme.of(context).colorScheme.primary)),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 16),
            TextFormField(
              controller: _numero,
              keyboardType: TextInputType.number,
              inputFormatters: [
                FilteringTextInputFormatter.digitsOnly,
                LengthLimitingTextInputFormatter(19),
                _FormatadorNumeroCartao(),
              ],
              decoration: const InputDecoration(
                labelText: 'Número do cartão',
                hintText: '0000 0000 0000 0000',
                prefixIcon: Icon(Icons.credit_card),
              ),
              validator: (v) {
                final digitos = (v ?? '').replaceAll(RegExp(r'\D'), '');
                if (digitos.length < 13 || !_luhnOk(digitos)) return 'Confira o número do cartão';
                return null;
              },
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: _nome,
              textCapitalization: TextCapitalization.characters,
              decoration: const InputDecoration(
                labelText: 'Nome impresso no cartão',
                prefixIcon: Icon(Icons.person_outline),
              ),
              validator: (v) =>
                  (v ?? '').trim().length < 2 ? 'Informe o nome como está no cartão' : null,
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: TextFormField(
                    controller: _validade,
                    keyboardType: TextInputType.number,
                    inputFormatters: [
                      FilteringTextInputFormatter.digitsOnly,
                      LengthLimitingTextInputFormatter(4),
                      _FormatadorValidade(),
                    ],
                    decoration: const InputDecoration(
                      labelText: 'Validade',
                      hintText: 'MM/AA',
                      prefixIcon: Icon(Icons.calendar_month_outlined),
                    ),
                    validator: _validarValidade,
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: TextFormField(
                    controller: _cvv,
                    keyboardType: TextInputType.number,
                    obscureText: true,
                    inputFormatters: [
                      FilteringTextInputFormatter.digitsOnly,
                      LengthLimitingTextInputFormatter(4),
                    ],
                    decoration: const InputDecoration(
                      labelText: 'CVV',
                      hintText: '123',
                      prefixIcon: Icon(Icons.lock_outline),
                    ),
                    validator: (v) =>
                        ((v ?? '').length < 3) ? 'Código de 3 ou 4 dígitos' : null,
                  ),
                ),
              ],
            ),
            if (_recusa != null) ...[
              const SizedBox(height: 14),
              Container(
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: Colors.red.shade50,
                  borderRadius: BorderRadius.circular(14),
                ),
                child: Row(
                  children: [
                    Icon(Icons.error_outline, color: Colors.red.shade700, size: 20),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(_recusa!,
                          style: TextStyle(
                              fontSize: 13, color: Colors.red.shade900, height: 1.4)),
                    ),
                  ],
                ),
              ),
            ],
            const SizedBox(height: 16),
            Container(
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: Colors.blue.shade50,
                borderRadius: BorderRadius.circular(14),
              ),
              child: Row(
                children: [
                  Icon(Icons.shield_outlined, color: Colors.blue.shade700, size: 20),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      'Pagamento processado pela Rede (Itaú). Os dados do cartão não ficam '
                      'salvos no app nem na distribuidora.',
                      style: TextStyle(fontSize: 12.5, color: Colors.blue.shade900, height: 1.4),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 8),
            TextButton(
              onPressed: _pagando
                  ? null
                  : () => Navigator.of(context).pushReplacement(MaterialPageRoute(
                      builder: (_) =>
                          PedidoDetalheScreen(pedidoId: widget.pedido['id'] as String))),
              child: const Text('Pagar depois (ver pedido)'),
            ),
          ],
        ),
      ),
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: FilledButton(
            onPressed: _pagando ? null : _pagar,
            style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(52)),
            child: _pagando
                ? const SizedBox(
                    width: 22, height: 22,
                    child: CircularProgressIndicator(strokeWidth: 2.5, color: Colors.white))
                : Text('Pagar ${moeda(valor)}'),
          ),
        ),
      ),
    );
  }

  String? _validarValidade(String? v) {
    final partes = (v ?? '').split('/');
    if (partes.length != 2) return 'Use MM/AA';
    final mes = int.tryParse(partes[0]) ?? 0;
    final ano = int.tryParse(partes[1]) ?? -1;
    if (mes < 1 || mes > 12 || ano < 0) return 'Use MM/AA';
    final agora = DateTime.now();
    final fim = DateTime(2000 + ano, mes + 1, 0);
    if (fim.isBefore(DateTime(agora.year, agora.month, 1))) return 'Cartão vencido';
    return null;
  }
}

/// Dígito verificador (Luhn): pega erro de digitação antes de ir ao provedor.
bool _luhnOk(String digitos) {
  var soma = 0;
  var dobra = false;
  for (var i = digitos.length - 1; i >= 0; i--) {
    var d = int.parse(digitos[i]);
    if (dobra) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    soma += d;
    dobra = !dobra;
  }
  return soma % 10 == 0;
}

/// "0000 0000 0000 0000" enquanto digita (grupos de 4).
class _FormatadorNumeroCartao extends TextInputFormatter {
  @override
  TextEditingValue formatEditUpdate(TextEditingValue oldValue, TextEditingValue newValue) {
    final digitos = newValue.text.replaceAll(RegExp(r'\D'), '');
    final b = StringBuffer();
    for (var i = 0; i < digitos.length; i++) {
      if (i > 0 && i % 4 == 0) b.write(' ');
      b.write(digitos[i]);
    }
    final texto = b.toString();
    return TextEditingValue(text: texto, selection: TextSelection.collapsed(offset: texto.length));
  }
}

/// "MM/AA" enquanto digita.
class _FormatadorValidade extends TextInputFormatter {
  @override
  TextEditingValue formatEditUpdate(TextEditingValue oldValue, TextEditingValue newValue) {
    final digitos = newValue.text.replaceAll(RegExp(r'\D'), '');
    final texto = digitos.length <= 2 ? digitos : '${digitos.substring(0, 2)}/${digitos.substring(2)}';
    return TextEditingValue(text: texto, selection: TextSelection.collapsed(offset: texto.length));
  }
}