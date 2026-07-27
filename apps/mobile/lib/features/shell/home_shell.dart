import 'package:flutter/material.dart';

import '../../core/carrinho_store.dart';
import '../../core/favoritos_store.dart';
import '../cart/carrinho_screen.dart';
import '../catalog/categorias_screen.dart';
import '../home/home_screen.dart';
import '../orders/pedidos_screen.dart';
import '../profile/perfil_screen.dart';

/// Casca autenticada do app: bottom nav com as 5 abas do fluxo aprovado
/// (Início · Categorias · Carrinho · Pedidos · Perfil). IndexedStack preserva
/// o estado de cada aba (posição de scroll, filtros).
class HomeShell extends StatefulWidget {
  const HomeShell({super.key});

  @override
  State<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends State<HomeShell> {
  int _aba = 0;

  @override
  void initState() {
    super.initState();
    CarrinhoStore.instance.carregar();
    FavoritosStore.instance.carregar();
  }

  void irParaAba(int i) => setState(() => _aba = i);

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: IndexedStack(
        index: _aba,
        children: [
          HomeScreen(onVerCarrinho: () => irParaAba(2)),
          const CategoriasScreen(),
          CarrinhoScreen(onVerProdutos: () => irParaAba(0)),
          const PedidosScreen(),
          const PerfilScreen(),
        ],
      ),
      bottomNavigationBar: ListenableBuilder(
        listenable: CarrinhoStore.instance,
        builder: (context, _) {
          final qtd = CarrinhoStore.instance.totalItens;
          return NavigationBar(
            selectedIndex: _aba,
            onDestinationSelected: irParaAba,
            destinations: [
              const NavigationDestination(
                  icon: Icon(Icons.storefront_outlined),
                  selectedIcon: Icon(Icons.storefront),
                  label: 'Início'),
              const NavigationDestination(
                  icon: Icon(Icons.grid_view_outlined),
                  selectedIcon: Icon(Icons.grid_view_rounded),
                  label: 'Categorias'),
              NavigationDestination(
                  icon: Badge(
                    isLabelVisible: qtd > 0,
                    label: Text('$qtd'),
                    child: const Icon(Icons.shopping_cart_outlined),
                  ),
                  selectedIcon: Badge(
                    isLabelVisible: qtd > 0,
                    label: Text('$qtd'),
                    child: const Icon(Icons.shopping_cart),
                  ),
                  label: 'Carrinho'),
              const NavigationDestination(
                  icon: Icon(Icons.receipt_long_outlined),
                  selectedIcon: Icon(Icons.receipt_long),
                  label: 'Pedidos'),
              const NavigationDestination(
                  icon: Icon(Icons.person_outline),
                  selectedIcon: Icon(Icons.person),
                  label: 'Perfil'),
            ],
          );
        },
      ),
    );
  }
}
