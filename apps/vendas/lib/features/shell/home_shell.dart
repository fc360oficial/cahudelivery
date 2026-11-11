import 'package:flutter/material.dart';

import '../../app_servicos.dart';
import '../../data/situacao_pedido.dart';
import '../clientes/clientes_page.dart';
import '../../widgets/marca.dart';
import '../inicio/inicio_page.dart';
import '../mais/mais_page.dart';
import '../pedidos/pedidos_page.dart';

/// Abas da barra inferior.
enum AbaVendas { inicio, clientes, pedidos, mais }

class HomeShell extends StatefulWidget {
  const HomeShell({super.key, this.abaInicial = AbaVendas.inicio});
  final AbaVendas abaInicial;

  /// Troca de aba a partir de qualquer tela filha: `HomeShell.of(context).irPara(AbaVendas.clientes)`.
  static HomeShellState of(BuildContext context) => context.findAncestorStateOfType<HomeShellState>()!;

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
      AbaVendas.mais: const MaisPage(),
    };
    return Scaffold(
      appBar: AppBar(
        titleSpacing: 16,
        title: const MarcaFluxoVendas(altura: 30),
      ),
      body: IndexedStack(index: _aba.index, children: abas.values.toList()),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _aba.index,
        onDestinationSelected: (i) => irPara(AbaVendas.values[i]),
        destinations: const [
          NavigationDestination(icon: Icon(Icons.home_outlined), selectedIcon: Icon(Icons.home_rounded), label: 'Início'),
          NavigationDestination(icon: Icon(Icons.storefront_outlined), selectedIcon: Icon(Icons.storefront_rounded), label: 'Clientes'),
          NavigationDestination(icon: Icon(Icons.receipt_long_outlined), selectedIcon: Icon(Icons.receipt_long_rounded), label: 'Pedidos'),
          NavigationDestination(icon: Icon(Icons.menu_rounded), selectedIcon: Icon(Icons.menu_rounded), label: 'Mais'),
        ],
      ),
    );
  }
}
