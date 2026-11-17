import 'package:flutter/material.dart';

import '../core/tema.dart';

/// Abas da barra inferior.
enum AbaEntregas { inicio, paradas, feitas, mais }

/// Barra inferior: Início, Paradas, Feitas e Mais. O item ativo fica azul com um traço curto embaixo
/// (o mesmo desenho do Fluxo Vendas).
class BarraNavegacao extends StatelessWidget {
  const BarraNavegacao({super.key, required this.atual, required this.aoTocar});
  final AbaEntregas? atual;
  final ValueChanged<AbaEntregas> aoTocar;

  static const _itens = <(AbaEntregas, IconData, IconData, String)>[
    (AbaEntregas.inicio, Icons.home_outlined, Icons.home_rounded, 'Início'),
    (AbaEntregas.paradas, Icons.location_on_outlined, Icons.location_on_rounded, 'Paradas'),
    (AbaEntregas.feitas, Icons.check_circle_outline_rounded, Icons.check_circle_rounded, 'Feitas'),
    (AbaEntregas.mais, Icons.more_horiz_rounded, Icons.more_horiz_rounded, 'Mais'),
  ];

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        color: Colors.white,
        boxShadow: [BoxShadow(color: Color(0x1A0B1F4B), blurRadius: 14, offset: Offset(0, -3))],
      ),
      child: SafeArea(
        top: false,
        child: SizedBox(
          height: 64,
          child: Row(
            children: [
              for (final (aba, icone, iconeAtivo, rotulo) in _itens)
                Expanded(
                  child: Semantics(
                    button: true,
                    selected: aba == atual,
                    label: rotulo,
                    child: InkWell(
                      onTap: () => aoTocar(aba),
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Icon(aba == atual ? iconeAtivo : icone, size: 26, color: aba == atual ? Cores.azul : Cores.textoSuave),
                          const SizedBox(height: 2),
                          Text(
                            rotulo,
                            maxLines: 1,
                            style: TextStyle(
                              fontSize: 12,
                              fontWeight: aba == atual ? FontWeight.w800 : FontWeight.w500,
                              color: aba == atual ? Cores.azul : Cores.textoSuave,
                            ),
                          ),
                          const SizedBox(height: 3),
                          Container(
                            width: 22,
                            height: 3,
                            decoration: BoxDecoration(color: aba == atual ? Cores.azul : Colors.transparent, borderRadius: BorderRadius.circular(2)),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}
