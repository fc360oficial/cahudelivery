import 'package:flutter/material.dart';

import '../core/tema.dart';
import '../features/shell/home_shell.dart';

/// Abas da barra inferior.
enum AbaVendas { inicio, clientes, pedidos, metas, mais }

/// Barra inferior: Início, Clientes, Pedidos, Metas e Mais. O item ativo fica azul com um
/// traço azul curto embaixo.
class BarraNavegacao extends StatelessWidget {
  const BarraNavegacao({super.key, required this.atual, required this.aoTocar});
  final AbaVendas? atual;
  final ValueChanged<AbaVendas> aoTocar;

  static const _itens = <(AbaVendas, IconData, IconData, String)>[
    (AbaVendas.inicio, Icons.home_outlined, Icons.home_rounded, 'Início'),
    (
      AbaVendas.clientes,
      Icons.groups_outlined,
      Icons.groups_rounded,
      'Clientes',
    ),
    (
      AbaVendas.pedidos,
      Icons.assignment_outlined,
      Icons.assignment_rounded,
      'Pedidos',
    ),
    (AbaVendas.metas, Icons.flag_outlined, Icons.flag_rounded, 'Metas'),
    (
      AbaVendas.mais,
      Icons.more_horiz_rounded,
      Icons.more_horiz_rounded,
      'Mais',
    ),
  ];

  @override
  Widget build(BuildContext context) {
    return Container(
      key: const Key('barra-navegacao'),
      decoration: const BoxDecoration(
        color: Colors.white,
        boxShadow: [
          BoxShadow(
            color: Color(0x1A0B1F4B),
            blurRadius: 14,
            offset: Offset(0, -3),
          ),
        ],
      ),
      child: SafeArea(
        top: false,
        child: SizedBox(
          height: 64,
          child: Row(
            children: [
              for (final (aba, icone, iconeAtivo, rotulo) in _itens)
                Expanded(
                  child: _Item(
                    icone: aba == atual ? iconeAtivo : icone,
                    rotulo: rotulo,
                    ativo: aba == atual,
                    aoTocar: () => aoTocar(aba),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _Item extends StatelessWidget {
  const _Item({
    required this.icone,
    required this.rotulo,
    required this.ativo,
    required this.aoTocar,
  });
  final IconData icone;
  final String rotulo;
  final bool ativo;
  final VoidCallback aoTocar;

  @override
  Widget build(BuildContext context) {
    final cor = ativo ? Cores.azul : Cores.textoSuave;
    return Semantics(
      button: true,
      selected: ativo,
      label: rotulo,
      child: InkWell(
        onTap: aoTocar,
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(icone, size: 26, color: cor),
            const SizedBox(height: 2),
            Text(
              rotulo,
              maxLines: 1,
              style: TextStyle(
                fontSize: 12,
                fontWeight: ativo ? FontWeight.w800 : FontWeight.w500,
                color: cor,
              ),
            ),
            const SizedBox(height: 3),
            Container(
              width: 22,
              height: 3,
              decoration: BoxDecoration(
                color: ativo ? Cores.azul : Colors.transparent,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// A mesma barra para telas empilhadas (detalhe do cliente, novo pedido, pedido...): tocar numa aba
/// fecha as telas empilhadas e abre a aba na casca.
class BarraNavegacaoEmpilhada extends StatelessWidget {
  const BarraNavegacaoEmpilhada({super.key, required this.atual});
  final AbaVendas atual;

  @override
  Widget build(BuildContext context) {
    return BarraNavegacao(
      atual: atual,
      aoTocar: (aba) {
        final shell = HomeShell.ativo;
        Navigator.of(context).popUntil((r) => r.isFirst);
        shell?.irPara(aba);
      },
    );
  }
}
