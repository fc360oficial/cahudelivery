import 'package:flutter/material.dart';

import '../../app_servicos.dart';
import '../../data/situacao_pedido.dart';
import '../clientes/clientes_page.dart';
import '../../widgets/barra_navegacao.dart';
import '../inicio/inicio_page.dart';
import '../mais/mais_page.dart';
import '../metas/metas_page.dart';
import '../pedidos/pedidos_page.dart';

export '../../widgets/barra_navegacao.dart' show AbaVendas;

class HomeShell extends StatefulWidget {
  const HomeShell({super.key, this.abaInicial = AbaVendas.inicio});
  final AbaVendas abaInicial;

  /// Troca de aba a partir de qualquer tela filha: `HomeShell.of(context).irPara(AbaVendas.clientes)`.
  static HomeShellState of(BuildContext context) =>
      context.findAncestorStateOfType<HomeShellState>()!;

  /// A casca que está na tela, para telas EMPILHADAS (que ficam fora dela na árvore) pedirem
  /// uma aba: `HomeShell.ativo?.irPara(AbaVendas.pedidos)`.
  static HomeShellState? get ativo => HomeShellState._ativo;

  @override
  State<HomeShell> createState() => HomeShellState();
}

class HomeShellState extends State<HomeShell> {
  static HomeShellState? _ativo;
  late AbaVendas _aba = widget.abaInicial;

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

  /// Troca de aba. Para Pedidos, [filtro] escolhe o chip (Retidos, Na fila...).
  void irPara(AbaVendas aba, {FiltroPedido? filtro}) {
    if (filtro != null) Servicos.of(context).pedidos.filtro.value = filtro;
    setState(() => _aba = aba);
  }

  @override
  Widget build(BuildContext context) {
    final abas = <AbaVendas, Widget>{
      AbaVendas.inicio: const InicioPage(),
      AbaVendas.clientes: const ClientesPage(),
      AbaVendas.pedidos: const PedidosPage(),
      AbaVendas.metas: const MetasPage(),
      AbaVendas.mais: const MaisPage(),
    };
    // Cada aba desenha o próprio topo (Início com a marca, as outras com barra azul e seta de voltar).
    // Voltar do aparelho numa aba que não é o Início leva ao Início, em vez de fechar o app.
    return PopScope(
      canPop: _aba == AbaVendas.inicio,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) irPara(AbaVendas.inicio);
      },
      child: Scaffold(
        body: IndexedStack(index: _aba.index, children: abas.values.toList()),
        bottomNavigationBar: BarraNavegacao(atual: _aba, aoTocar: irPara),
      ),
    );
  }
}
