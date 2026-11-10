import 'package:flutter/material.dart';

import '../core/tema.dart';

/// Símbolo "S" da família Fluxo + nome "FluxoVendas" escrito em texto.
class MarcaFluxoVendas extends StatelessWidget {
  const MarcaFluxoVendas({super.key, this.altura = 36, this.mostrarNome = true, this.corNome = Colors.white});
  final double altura;
  final bool mostrarNome;
  final Color corNome;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Image.asset('assets/brand/fluxo-simbolo.png', height: altura, semanticLabel: 'Fluxo'),
        if (mostrarNome) ...[
          SizedBox(width: altura * 0.3),
          Text.rich(
            TextSpan(children: [
              TextSpan(text: 'Fluxo', style: TextStyle(color: corNome, fontWeight: FontWeight.w800)),
              const TextSpan(text: 'Vendas', style: TextStyle(color: Cores.amarelo, fontWeight: FontWeight.w800)),
            ]),
            style: TextStyle(fontSize: altura * 0.62, letterSpacing: -0.3),
          ),
        ],
      ],
    );
  }
}
