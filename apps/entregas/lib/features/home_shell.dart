import 'package:flutter/material.dart';

import '../widgets/barra_navegacao.dart';
import 'feitas_page.dart';
import 'inicio_page.dart';
import 'mais_page.dart';
import 'paradas_page.dart';

export '../widgets/barra_navegacao.dart' show AbaEntregas;

/// Casca com a barra de baixo (Início, Paradas, Feitas, Mais).
class HomeShell extends StatefulWidget {
  const HomeShell({super.key});

  /// A casca na tela, para telas empilhadas pedirem uma aba.
  static HomeShellState? get ativo => HomeShellState._ativo;

  @override
  State<HomeShell> createState() => HomeShellState();
}

class HomeShellState extends State<HomeShell> {
  static HomeShellState? _ativo;
  AbaEntregas _aba = AbaEntregas.inicio;

  @override
  void initState() {
    super.initState();
    _ativo = this;
  }

  @override
  void dispose() {
    if (identical(_ativo, this)) _ativo = null;
    super.dispose();
  }

  void irPara(AbaEntregas aba) => setState(() => _aba = aba);

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: _aba == AbaEntregas.inicio,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) irPara(AbaEntregas.inicio);
      },
      child: Scaffold(
        body: IndexedStack(index: _aba.index, children: const [InicioPage(), ParadasPage(), FeitasPage(), MaisPage()]),
        bottomNavigationBar: BarraNavegacao(atual: _aba, aoTocar: irPara),
      ),
    );
  }
}

/// A mesma barra nas telas empilhadas (parada, comprovante...): tocar numa aba fecha as telas e abre a aba.
class BarraNavegacaoEmpilhada extends StatelessWidget {
  const BarraNavegacaoEmpilhada({super.key, this.atual = AbaEntregas.paradas});
  final AbaEntregas atual;

  @override
  Widget build(BuildContext context) => BarraNavegacao(
        atual: atual,
        aoTocar: (aba) {
          final shell = HomeShell.ativo;
          Navigator.of(context).popUntil((r) => r.isFirst);
          shell?.irPara(aba);
        },
      );
}
