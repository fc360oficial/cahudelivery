import 'package:flutter/material.dart';

import '../core/tema.dart';

/// Marca Fluxo Vendas: o símbolo "S" amarelo + "Fluxo" (marinho) sobre "Vendas" (azul) com o
/// traço amarelo embaixo. [corFluxo] vira branco quando a marca fica sobre fundo escuro.
class MarcaFluxoVendas extends StatelessWidget {
  const MarcaFluxoVendas({
    super.key,
    this.altura = 44,
    this.corFluxo = Cores.marinho,
    this.corVendas = Cores.azul,
  });

  /// Altura do símbolo; o nome acompanha.
  final double altura;
  final Color corFluxo, corVendas;

  @override
  Widget build(BuildContext context) {
    final fonte = altura * 0.62;
    // A marca é imagem de logotipo: não cresce com a fonte grande do sistema.
    return FittedBox(
      fit: BoxFit.scaleDown,
      child: MediaQuery.withNoTextScaling(
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Image.asset(
              'assets/brand/fluxo-simbolo.png',
              height: altura,
              semanticLabel: 'Fluxo',
            ),
            SizedBox(width: altura * 0.22),
            Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Fluxo',
                  style: TextStyle(
                    fontSize: fonte,
                    height: 1.0,
                    fontWeight: FontWeight.w800,
                    color: corFluxo,
                    letterSpacing: -0.4,
                  ),
                ),
                Text(
                  'Vendas',
                  style: TextStyle(
                    fontSize: fonte,
                    height: 1.0,
                    fontWeight: FontWeight.w800,
                    color: corVendas,
                    letterSpacing: -0.4,
                  ),
                ),
                Container(
                  margin: EdgeInsets.only(top: altura * 0.05),
                  height: altura * 0.07,
                  width: fonte * 3.1,
                  decoration: BoxDecoration(
                    color: Cores.amarelo,
                    borderRadius: BorderRadius.circular(4),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
