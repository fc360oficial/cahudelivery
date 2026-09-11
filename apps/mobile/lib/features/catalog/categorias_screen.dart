import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../widgets/estados.dart';
import 'produtos_screen.dart';

/// Aba Categorias: grade das categorias raiz (GET /v1/categorias).
/// As subcategorias viram chips dentro da lista de produtos.
class CategoriasScreen extends StatefulWidget {
  const CategoriasScreen({super.key});

  @override
  State<CategoriasScreen> createState() => _CategoriasScreenState();
}

class _CategoriasScreenState extends State<CategoriasScreen> {
  List<Map<String, dynamic>>? _todas;
  String? _erro;

  @override
  void initState() {
    super.initState();
    _carregar();
  }

  Future<void> _carregar() async {
    setState(() {
      _todas = null;
      _erro = null;
    });
    try {
      final r = await ApiClient.instance.get('/categorias') as List;
      if (mounted) setState(() => _todas = List<Map<String, dynamic>>.from(r));
    } on ApiException catch (e) {
      if (mounted) setState(() => _erro = e.message);
    } catch (_) {
      if (mounted) setState(() => _erro = 'Sem conexão — verifique sua internet');
    }
  }

  @override
  Widget build(BuildContext context) {
    final raizes = _todas?.where((c) => c['pai_id'] == null).toList();
    return Scaffold(
      appBar: AppBar(title: const Text('Categorias')),
      body: _erro != null
          ? EstadoErro(mensagem: _erro, onTentarNovamente: _carregar)
          : _todas == null
              ? GridView.count(
                  physics: const NeverScrollableScrollPhysics(),
                  padding: const EdgeInsets.all(16),
                  crossAxisCount: 2,
                  mainAxisSpacing: 12,
                  crossAxisSpacing: 12,
                  childAspectRatio: 1.4,
                  children: List.generate(6, (_) => const Esqueleto(radius: 16)),
                )
              : raizes!.isEmpty
                  ? const EstadoVazio(
                      icone: Icons.grid_view_outlined,
                      titulo: 'Nenhuma categoria',
                      mensagem: 'O catálogo ainda está sendo montado.')
                  : RefreshIndicator(
                      onRefresh: _carregar,
                      child: GridView.builder(
                        padding: const EdgeInsets.all(16),
                        gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
                          maxCrossAxisExtent: 220,
                          mainAxisSpacing: 12,
                          crossAxisSpacing: 12,
                          childAspectRatio: 1.4,
                        ),
                        itemCount: raizes.length,
                        itemBuilder: (_, i) {
                          final c = raizes[i];
                          final filhas = _todas!
                              .where((s) => s['pai_id'] == c['id'])
                              .toList();
                          return _CategoriaCard(
                            categoria: c,
                            onTap: () => Navigator.of(context).push(
                              MaterialPageRoute(
                                builder: (_) => ProdutosScreen(
                                  categoriaId: c['id'] as String,
                                  titulo: c['nome'] ?? 'Categoria',
                                  subcategorias: filhas,
                                ),
                              ),
                            ),
                          );
                        },
                      ),
                    ),
    );
  }
}

class _CategoriaCard extends StatelessWidget {
  const _CategoriaCard({required this.categoria, required this.onTap});
  final Map<String, dynamic> categoria;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final cor = Theme.of(context).colorScheme.primary;
    final imagem = categoria['imagem_url'] as String?;
    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Stack(
          fit: StackFit.expand,
          children: [
            if (imagem != null)
              Image.network(imagem, fit: BoxFit.cover,
                  errorBuilder: (_, e, s) => _SemImagem(cor: cor, nome: categoria['nome'] ?? ''))
            else
              _SemImagem(cor: cor, nome: categoria['nome'] ?? ''),
            if (imagem != null)
              Container(
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    begin: Alignment.topCenter,
                    end: Alignment.bottomCenter,
                    colors: [Colors.transparent, Colors.black.withValues(alpha: 0.55)],
                  ),
                ),
              ),
            Positioned(
              left: 12,
              right: 12,
              bottom: 10,
              child: Text(
                categoria['nome'] ?? '',
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  color: imagem != null ? Colors.white : Colors.black87,
                  fontSize: 15,
                  fontWeight: FontWeight.w700,
                  shadows: imagem != null
                      ? [const Shadow(color: Colors.black45, blurRadius: 6)]
                      : null,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Quadrado da categoria sem foto: fundo na cor da marca + ícone escolhido pelo nome.
class _SemImagem extends StatelessWidget {
  const _SemImagem({required this.cor, required this.nome});
  final Color cor;
  final String nome;

  static IconData _icone(String nome) {
    final n = nome.toLowerCase();
    if (n.contains('pet')) return Icons.pets;
    if (n.contains('calçado') || n.contains('calcado')) return Icons.checkroom;
    if (n.contains('alco')) return Icons.wine_bar;
    if (n.contains('bebida')) return Icons.local_drink;
    if (n.contains('café') || n.contains('cafe') || n.contains('achoc')) return Icons.coffee;
    if (n.contains('iogurte') || n.contains('láct') || n.contains('lact')) return Icons.icecream;
    if (n.contains('frio') || n.contains('margarina')) return Icons.ac_unit;
    if (n.contains('leite')) return Icons.water_drop;
    if (n.contains('matina') || n.contains('cereal')) return Icons.breakfast_dining;
    if (n.contains('padaria') || n.contains('confeit')) return Icons.bakery_dining;
    if (n.contains('biscoit') || n.contains('snack')) return Icons.cookie;
    if (n.contains('doce') || n.contains('chocolate')) return Icons.cake;
    if (n.contains('molho') || n.contains('enlatado')) return Icons.soup_kitchen;
    if (n.contains('mercearia')) return Icons.shopping_basket;
    if (n.contains('lavanderia')) return Icons.local_laundry_service;
    if (n.contains('limpeza')) return Icons.cleaning_services;
    if (n.contains('higiene')) return Icons.soap;
    if (n.contains('cabelo')) return Icons.content_cut;
    if (n.contains('papel') || n.contains('descart')) return Icons.receipt_long;
    if (n.contains('utilidade') || n.contains('pilha')) return Icons.battery_charging_full;
    return Icons.category;
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      color: cor.withValues(alpha: 0.22),
      alignment: Alignment.topRight,
      padding: const EdgeInsets.all(12),
      child: Icon(_icone(nome), size: 40, color: Colors.black.withValues(alpha: 0.45)),
    );
  }
}
