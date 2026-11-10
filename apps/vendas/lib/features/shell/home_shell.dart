import 'package:flutter/material.dart';

import '../../widgets/em_construcao.dart';
import '../../widgets/marca.dart';
import '../inicio/inicio_page.dart';
import '../mais/mais_page.dart';

/// Abas da barra inferior. As telas das próximas tarefas entram trocando o
/// `EmConstrucaoPage` correspondente em [_abas].
enum AbaVendas { inicio, clientes, pedidos, mais }

class HomeShell extends StatefulWidget {
  const HomeShell({super.key, this.abaInicial = AbaVendas.inicio});
  final AbaVendas abaInicial;

  /// Troca de aba a partir de qualquer tela filha: `HomeShell.of(context).irPara(AbaVendas.clientes)`.
  static HomeShellState of(BuildContext context) => context.findAncestorStateOfType<HomeShellState>()!;

  @override
  State<HomeShell> createState() => HomeShellState();
}

class HomeShellState extends State<HomeShell> {
  late AbaVendas _aba = widget.abaInicial;

  void irPara(AbaVendas aba) => setState(() => _aba = aba);

  @override
  Widget build(BuildContext context) {
    final abas = <AbaVendas, Widget>{
      AbaVendas.inicio: const InicioPage(),
      AbaVendas.clientes: const EmConstrucaoPage(titulo: 'Clientes', comAppBar: false),
      AbaVendas.pedidos: const EmConstrucaoPage(titulo: 'Pedidos', comAppBar: false),
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
