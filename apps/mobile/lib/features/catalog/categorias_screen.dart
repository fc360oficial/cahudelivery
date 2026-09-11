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
                  errorBuilder: (_, e, s) => Container(color: cor.withValues(alpha: 0.08)))
            else
              Container(color: cor.withValues(alpha: 0.08)),
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
