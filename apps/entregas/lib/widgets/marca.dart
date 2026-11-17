import 'package:flutter/material.dart';

import '../core/tema.dart';

/// Marca Fluxo Entregas: o símbolo amarelo + "Fluxo" (marinho) sobre "Entregas" (azul) com o traço amarelo
/// embaixo, igual à do Fluxo Vendas. [corFluxo] vira branco sobre fundo escuro.
class MarcaFluxoEntregas extends StatelessWidget {
  const MarcaFluxoEntregas({super.key, this.altura = 44, this.corFluxo = Cores.marinho, this.corEntregas = Cores.azul});

  final double altura;
  final Color corFluxo, corEntregas;

  @override
  Widget build(BuildContext context) {
    final fonte = altura * 0.62;
    final estilo = TextStyle(fontSize: fonte, height: 1.0, fontWeight: FontWeight.w800, letterSpacing: -0.4);
    return FittedBox(
      fit: BoxFit.scaleDown,
      child: MediaQuery.withNoTextScaling(
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Image.asset('assets/brand/fluxo-simbolo.png', height: altura, semanticLabel: 'Fluxo'),
            SizedBox(width: altura * 0.22),
            Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Fluxo', style: estilo.copyWith(color: corFluxo)),
                Text('Entregas', style: estilo.copyWith(color: corEntregas)),
                Container(
                  margin: EdgeInsets.only(top: altura * 0.05),
                  height: altura * 0.07,
                  width: fonte * 3.9,
                  decoration: BoxDecoration(color: Cores.amarelo, borderRadius: BorderRadius.circular(4)),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
