import 'dart:async';

import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../core/config.dart';
import '../../core/tenant_theme.dart';
import '../../widgets/estados.dart';
import '../../widgets/produto_card.dart';
import '../../widgets/vitrine_patrocinada.dart';
import '../auth/entrar_ou_criar_screen.dart';
import '../catalog/produto_screen.dart';
import '../catalog/produtos_screen.dart';
import '../profile/enderecos_screen.dart';

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
  String? _endereco; // linha "Entregar em ..." do topo
  final _bannerCtrl = PageController();
  int _banner = 0;
  Timer? _autoplay;

  @override
  void initState() {
    super.initState();
    _carregar();
    _carregarEndereco();
    // Recarrega quando o login muda em qualquer lugar do app (ex.: checkout).
    ApiClient.instance.addListener(_carregarEndereco);
  }

  /// Logado: endereço padrão do cadastro. Visitante: nenhum endereço a mostrar.
  Future<void> _carregarEndereco() async {
    String? txt;
    if (ApiClient.instance.logado) {
      try {
        final r = await ApiClient.instance.get('/perfil/enderecos') as List;
        if (r.isNotEmpty) {
          final lista = List<Map<String, dynamic>>.from(r);
          final e = lista.firstWhere((x) => x['padrao'] == true, orElse: () => lista.first);
          txt = '${e['logradouro']}, ${e['numero']} — ${e['bairro']}, ${e['cidade']}/${e['uf']}';
        }
      } catch (_) {
        // sem rede: mantém sem endereço
      }
    }
    if (mounted) setState(() => _endereco = txt);
  }

  Future<void> _editarEndereco() async {
    if (ApiClient.instance.logado) {
      await Navigator.of(context)
          .push(MaterialPageRoute(builder: (_) => const EnderecosScreen()));
    } else {
      await Navigator.of(context)
          .push(MaterialPageRoute(builder: (_) => const EntrarOuCriarScreen()));
    }
    _carregarEndereco();
  }

  @override
  void dispose() {
    ApiClient.instance.removeListener(_carregarEndereco);
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
        // Logo do tenant na Home; sem asset, cai no nome do app em texto.
        title: Image.asset(
          AppBuildConfig.logoAsset,
          height: 38,
          errorBuilder: (_, e, s) =>
              Text(t.appNome, style: const TextStyle(fontWeight: FontWeight.w800)),
        ),
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(96),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 6),
                child: _linhaEndereco(context),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
                child: _CampoBusca(onSubmeter: (termo) {
                  if (termo.trim().isEmpty) return;
                  Navigator.of(context).push(MaterialPageRoute(
                      builder: (_) =>
                          ProdutosScreen(buscaInicial: termo.trim(), titulo: 'Busca')));
                }),
              ),
            ],
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
                      // Prateleiras por categoria abaixo das vitrines de conversão
                      // (promoção/mais vendidos primeiro) — navegação por descoberta,
                      // pro comprador "passear" pelo catálogo como numa loja física.
                      for (final item in (_home!['prateleiras'] as List? ?? const []))
                        (item as Map<String, dynamic>)['tipo'] == 'patrocinador'
                            ? VitrinePatrocinada(patrocinador: item)
                            : _vitrine(
                                item['nome'] as String,
                                item['produtos'] as List? ?? const [],
                                verTodos: () => Navigator.of(context).push(MaterialPageRoute(
                                    builder: (_) => ProdutosScreen(
                                        categoriaId: item['categoriaId'] as String,
                                        titulo: item['nome'] as String))),
                              ),
                      if ((_home!['promocoes'] as List? ?? []).isEmpty &&
                          (_home!['maisVendidos'] as List? ?? []).isEmpty &&
                          (_home!['prateleiras'] as List? ?? []).isEmpty)
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

  /// "Entregar em ..." tocável no topo (padrão de app de delivery).
  Widget _linhaEndereco(BuildContext context) {
    final cor = Theme.of(context).colorScheme.onPrimary;
    return InkWell(
      onTap: _editarEndereco,
      borderRadius: BorderRadius.circular(10),
      child: Row(
        children: [
          Icon(Icons.location_on_outlined, size: 18, color: cor),
          const SizedBox(width: 6),
          Flexible(
            child: Text.rich(
              TextSpan(
                children: [
                  TextSpan(
                      text: 'Entregar em  ',
                      style: TextStyle(
                          fontSize: 12.5, color: cor.withValues(alpha: 0.75))),
                  TextSpan(
                      text: _endereco ?? 'Informar endereço de entrega',
                      style: TextStyle(
                          fontSize: 13, fontWeight: FontWeight.w700, color: cor)),
                ],
              ),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
          Icon(Icons.keyboard_arrow_down, size: 18, color: cor),
        ],
      ),
    );
  }

  Widget _banners() {
    final banners = (_home!['banners'] as List?) ?? const [];
    if (banners.isEmpty) return const SizedBox.shrink();
    return Column(
      children: [
        const SizedBox(height: 12),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          // Proporção 3.5:1 (ex.: arte 1400x400) — banner baixo e largo.
          // BoxFit.cover: preenche a caixa inteira sem sobrar tarja cinza,
          // cortando as bordas quando a arte não bate exatamente nessa
          // proporção — mantenha o conteúdo importante longe das bordas.
          child: AspectRatio(
            aspectRatio: 3.5,
            child: PageView.builder(
              controller: _bannerCtrl,
              itemCount: banners.length,
              onPageChanged: (i) => setState(() => _banner = i),
              itemBuilder: (_, i) {
                final b = banners[i] as Map<String, dynamic>;
                return ClipRRect(
                  borderRadius: BorderRadius.circular(16),
                  child: InkWell(
                    onTap: () => _abrirBanner(b),
                    child: Container(
                      color: Colors.grey.shade200,
                      child: Image.network(
                        b['imagem_url'] ?? '',
                        fit: BoxFit.cover,
                        width: double.infinity,
                        height: double.infinity,
                        errorBuilder: (_, e, s) => Container(
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
