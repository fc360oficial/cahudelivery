import 'package:flutter/material.dart';

/// Stepper de quantidade com respeito à qtd mínima do produto e ao estoque.
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
    final cor = Theme.of(context).colorScheme.primary;
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
          AnimatedSwitcher(
            duration: const Duration(milliseconds: 200),
            transitionBuilder: (child, anim) => ScaleTransition(scale: anim, child: child),
            child: Text(
              quantidade % 1 == 0 ? quantidade.toInt().toString() : quantidade.toString(),
              key: ValueKey(quantidade),
              style: TextStyle(fontSize: compacto ? 14 : 16, fontWeight: FontWeight.w700),
            ),
          ),
          botao(Icons.add, podeMais, () => onMudar(quantidade + 1)),
        ],
      ),
    );
  }
}
