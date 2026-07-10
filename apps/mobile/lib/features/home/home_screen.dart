import 'dart:async';

import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../core/tenant_theme.dart';
import '../../widgets/estados.dart';
import '../../widgets/produto_card.dart';
import '../catalog/produto_screen.dart';
import '../catalog/produtos_screen.dart';

/// Aba Início: busca fixa no topo, carrossel de banners e vitrines
/// "Promoções" e "Mais vendidos" (GET /v1/home).
class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key, this.onVerCarrinho});
  final VoidCallback? onVerCarrinho;

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  Map<String, dynamic>? _home;
  String? _erro;
  final _bannerCtrl = PageController();
  int _banner = 0;
  Timer? _autoplay;

  @override
  void initState() {
    super.initState();
    _carregar();
  }

  @override
  void dispose() {
    _autoplay?.cancel();
    _bannerCtrl.dispose();
    super.dispose();
  }

  Future<void> _carregar() async {
    setState(() {
      _home = null;
      _erro = null;
    });
    try {
      final r = await ApiClient.instance.get('/home') as Map<String, dynamic>;
      if (!mounted) return;
      setState(() => _home = r);
      _iniciarAutoplay();
    } on ApiException catch (e) {
      if (mounted) setState(() => _erro = e.message);
    } catch (_) {
      if (mounted) setState(() => _erro = 'Sem conexão — verifique sua internet');
    }
  }

  void _iniciarAutoplay() {
    _autoplay?.cancel();
    final banners = (_home?['banners'] as List?) ?? const [];
    if (banners.length < 2) return;
    _autoplay = Timer.periodic(const Duration(seconds: 5), (_) {
      if (!_bannerCtrl.hasClients) return;
      final prox = (_banner + 1) % banners.length;
      _bannerCtrl.animateToPage(prox,
          duration: const Duration(milliseconds: 350), curve: Curves.easeOut);
    });
  }

  void _abrirBanner(Map<String, dynamic> b) {
    final tipo = b['destino_tipo'];
    final id = b['destino_id'] as String?;
    if (tipo == 'produto' && id != null) {
      Navigator.of(context).push(
          MaterialPageRoute(builder: (_) => ProdutoScreen(produtoId: id)));
    } else if (tipo == 'categoria' && id != null) {
      Navigator.of(context).push(MaterialPageRoute(
          builder: (_) => ProdutosScreen(categoriaId: id, titulo: b['titulo'] ?? 'Categoria')));
    } else if (tipo == 'promocao') {
      Navigator.of(context).push(MaterialPageRoute(
          builder: (_) => const ProdutosScreen(somentePromocao: true, titulo: 'Promoções')));
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = TenantTheme.instance;
    return Scaffold(
      appBar: AppBar(
        title: Text(t.appNome, style: const TextStyle(fontWeight: FontWeight.w800)),
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(64),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 4, 16, 12),
            child: _CampoBusca(onSubmeter: (termo) {
              if (termo.trim().isEmpty) return;
              Navigator.of(context).push(MaterialPageRoute(
                  builder: (_) => ProdutosScreen(buscaInicial: termo.trim(), titulo: 'Busca')));
            }),
          ),
        ),
      ),
      body: _erro != null
          ? EstadoErro(mensagem: _erro, onTentarNovamente: _carregar)
          : _home == null
              ? const _HomeSkeleton()
              : RefreshIndicator(
                  onRefresh: _carregar,
                  child: ListView(
                    padding: const EdgeInsets.only(bottom: 24),
                    children: [
                      _banners(),
                      _vitrine(
                        'Promoções',
                        _home!['promocoes'] as List? ?? const [],
                        verTodos: () => Navigator.of(context).push(MaterialPageRoute(
                            builder: (_) => const ProdutosScreen(
                                somentePromocao: true, titulo: 'Promoções'))),
                      ),
                      _vitrine('Mais vendidos', _home!['maisVendidos'] as List? ?? const []),
                      if ((_home!['promocoes'] as List? ?? []).isEmpty &&
                          (_home!['maisVendidos'] as List? ?? []).isEmpty)
                        const Padding(
                          padding: EdgeInsets.only(top: 60),
                          child: EstadoVazio(
                            icone: Icons.storefront_outlined,
                            titulo: 'Catálogo em preparação',
                            mensagem: 'Os produtos aparecerão aqui em breve.',
                          ),
                        ),
                    ],
                  ),
                ),
    );
  }

  Widget _banners() {
    final banners = (_home!['banners'] as List?) ?? const [];
    if (banners.isEmpty) return const SizedBox.shrink();
    return Column(
      children: [
        const SizedBox(height: 12),
        SizedBox(
          height: 150,
          child: PageView.builder(
            controller: _bannerCtrl,
            itemCount: banners.length,
            onPageChanged: (i) => setState(() => _banner = i),
            itemBuilder: (_, i) {
              final b = banners[i] as Map<String, dynamic>;
              return Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(16),
                  child: InkWell(
                    onTap: () => _abrirBanner(b),
                    child: Image.network(
                      b['imagem_url'] ?? '',
                      fit: BoxFit.cover,
                      width: double.infinity,
                      errorBuilder: (_, e, s) => Container(
                        color: Colors.grey.shade200,
                        alignment: Alignment.center,
                        child: Text(b['titulo'] ?? '',
                            style: const TextStyle(fontWeight: FontWeight.w600)),
                      ),
                    ),
                  ),
                ),
              );
            },
          ),
        ),
        if (banners.length > 1) ...[
          const SizedBox(height: 8),
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: List.generate(banners.length, (i) {
              final ativo = i == _banner;
              return AnimatedContainer(
                duration: const Duration(milliseconds: 200),
                margin: const EdgeInsets.symmetric(horizontal: 3),
                width: ativo ? 18 : 7,
                height: 7,
                decoration: BoxDecoration(
                  color: ativo
                      ? TenantTheme.instance.corPrimaria
                      : Colors.grey.shade300,
                  borderRadius: BorderRadius.circular(4),
                ),
              );
            }),
          ),
        ],
      ],
    );
  }

  Widget _vitrine(String titulo, List produtos, {VoidCallback? verTodos}) {
    if (produtos.isEmpty) return const SizedBox.shrink();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 20, 16, 10),
          child: Row(
            children: [
              Expanded(
                child: Text(titulo,
                    style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
              ),
              if (verTodos != null)
                TextButton(onPressed: verTodos, child: const Text('Ver todas')),
            ],
          ),
        ),
        SizedBox(
          height: 254,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 16),
            itemCount: produtos.length,
            separatorBuilder: (_, i) => const SizedBox(width: 10),
            itemBuilder: (_, i) =>
                ProdutoCard(produto: produtos[i] as Map<String, dynamic>, largura: 150),
          ),
        ),
      ],
    );
  }
}

class _CampoBusca extends StatelessWidget {
  const _CampoBusca({required this.onSubmeter});
  final ValueChanged<String> onSubmeter;

  @override
  Widget build(BuildContext context) {
    return TextField(
      textInputAction: TextInputAction.search,
      onSubmitted: onSubmeter,
      decoration: InputDecoration(
        hintText: 'Buscar produtos...',
        prefixIcon: const Icon(Icons.search),
        isDense: true,
        contentPadding: const EdgeInsets.symmetric(vertical: 12),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide: BorderSide.none,
        ),
      ),
    );
  }
}

class _HomeSkeleton extends StatelessWidget {
  const _HomeSkeleton();

  @override
  Widget build(BuildContext context) {
    return ListView(
      physics: const NeverScrollableScrollPhysics(),
      padding: const EdgeInsets.all(16),
      children: [
        const Esqueleto(height: 150, radius: 16),
        const SizedBox(height: 28),
        const Esqueleto(width: 140, height: 20),
        const SizedBox(height: 12),
        SizedBox(
          height: 220,
          child: Row(
            children: List.generate(
              3,
              (i) => const Padding(
                padding: EdgeInsets.only(right: 10),
                child: Esqueleto(width: 150, height: 220, radius: 16),
              ),
            ),
          ),
        ),
      ],
    );
  }
}
