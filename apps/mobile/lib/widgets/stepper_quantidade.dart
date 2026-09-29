import 'package:flutter/material.dart';

import 'quantidade_editavel.dart';

/// Stepper de quantidade com respeito à qtd mínima do produto e ao estoque.
/// O número do meio é editável (toque abre o teclado).
/// No "-" abaixo do mínimo: chama onMudar(0) (remoção) se permitirRemover,
/// senão o botão desabilita.
class StepperQuantidade extends StatelessWidget {
  const StepperQuantidade({
    super.key,
    required this.quantidade,
    required this.onMudar,
    this.minimo = 1,
    this.maximo,
    this.permitirRemover = false,
    this.compacto = false,
  });

  final double quantidade;
  final double minimo;
  final double? maximo;
  final bool permitirRemover;
  final bool compacto;
  final ValueChanged<double> onMudar;

  @override
  Widget build(BuildContext context) {
    // Ícones escuros: amarelo (primary) em traço fino sobre branco não tem contraste.
    const cor = Color(0xFF1A1A1A);
    final min = minimo < 1 ? 1.0 : minimo;
    final podeMenos = quantidade > min || permitirRemover;
    final podeMais = maximo == null || quantidade < maximo!;
    final tam = compacto ? 32.0 : 40.0;

    Widget botao(IconData icone, bool habilitado, VoidCallback acao) => SizedBox(
          width: tam,
          height: tam,
          child: IconButton(
            padding: EdgeInsets.zero,
            iconSize: compacto ? 18 : 22,
            onPressed: habilitado ? acao : null,
            icon: Icon(icone, color: habilitado ? cor : Colors.grey.shade400),
          ),
        );

    return Container(
      decoration: BoxDecoration(
        border: Border.all(color: Colors.grey.shade300),
        borderRadius: BorderRadius.circular(12),
        color: Colors.white,
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          botao(
            quantidade <= min && permitirRemover ? Icons.delete_outline : Icons.remove,
            podeMenos,
            () => onMudar(quantidade - 1 < min ? 0 : quantidade - 1),
          ),
          QuantidadeEditavel(
            quantidade: quantidade,
            minimo: min,
            maximo: maximo,
            permitirRemover: permitirRemover,
            largura: compacto ? 40 : 48,
            corFoco: const Color(0xFFFFF3B0),
            style: TextStyle(fontSize: compacto ? 14 : 16, fontWeight: FontWeight.w700, color: cor),
            onConfirmar: onMudar,
          ),
          botao(Icons.add, podeMais, () => onMudar(quantidade + 1)),
        ],
      ),
    );
  }
}
