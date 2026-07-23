import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../widgets/estados.dart';
import '../../widgets/produto_card.dart';

/// Lista de produtos com scroll infinito (GET /v1/produtos).
/// Serve busca (campo no topo), categoria (chips de subcategoria) e promoções.
class ProdutosScreen extends StatefulWidget {
  const ProdutosScreen({
    super.key,
    required this.titulo,
    this.categoriaId,
    this.subcategorias = const [],
    this.buscaInicial,
    this.somentePromocao = false,
    this.produtosFixos,
  });

  final String titulo;
  final String? categoriaId;
  final List<Map<String, dynamic>> subcategorias;
  final String? buscaInicial;
  final bool somentePromocao;
  final List<Map<String, dynamic>>? produtosFixos;

  @override
  State<ProdutosScreen> createState() => _ProdutosScreenState();
}

class _ProdutosScreenState extends State<ProdutosScreen> {
  static const _limite = 20;

  final _scroll = ScrollController();
  late final _busca = TextEditingController(text: widget.buscaInicial ?? '');

  final List<Map<String, dynamic>> _produtos = [];
  String? _subcategoriaId;
  int _pagina = 1;
  bool _carregando = false;
  bool _fim = false;
  String? _erro;

  bool get _modoBusca => widget.buscaInicial != null;

  @override
  void initState() {
    super.initState();
    _scroll.addListener(() {
      if (_scroll.position.pixels > _scroll.position.maxScrollExtent - 400) {
        _carregarMais();
      }
    });
    _recarregar();
  }

  @override
  void dispose() {
    _scroll.dispose();
    _busca.dispose();
    super.dispose();
  }

  Future<void> _recarregar() async {
    setState(() {
      _produtos.clear();
      _pagina = 1;
      _fim = false;
      _erro = null;
    });
    await _carregarMais();
  }

  Future<void> _carregarMais() async {
    if (_carregando || _fim) return;
    if (widget.produtosFixos != null) {
      setState(() {
        _produtos
          ..clear()
          ..addAll(widget.produtosFixos!);
        _fim = true;
      });
      return;
    }
    setState(() => _carregando = true);
    try {
      final q = <String, String>{
        'pagina': '$_pagina',
        'limite': '$_limite',
        if (_subcategoriaId != null)
          'categoria': _subcategoriaId!
        else if (widget.categoriaId != null)
          'categoria': widget.categoriaId!,
        if (_busca.text.trim().isNotEmpty) 'busca': _busca.text.trim(),
        if (widget.somentePromocao) 'promocao': 'true',
      };
      final query = q.entries
          .map((e) => '${e.key}=${Uri.encodeQueryComponent(e.value)}')
          .join('&');
      final r = await ApiClient.instance.get('/produtos?$query') as Map<String, dynamic>;
      final novos = List<Map<String, dynamic>>.from(r['dados'] as List? ?? const []);
      if (!mounted) return;
      setState(() {
        _produtos.addAll(novos);
        _pagina++;
        if (novos.length < _limite) _fim = true;
      });
    } on ApiException catch (e) {
      if (mounted) setState(() => _erro = e.message);
    } catch (_) {
      if (mounted) setState(() => _erro = 'Sem conexão — verifique sua internet');
    } finally {
      if (mounted) setState(() => _carregando = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: _modoBusca
            ? TextField(
                controller: _busca,
                autofocus: widget.buscaInicial!.isEmpty,
                textInputAction: TextInputAction.search,
                onSubmitted: (_) => _recarregar(),
                style: TextStyle(color: Theme.of(context).colorScheme.onPrimary, fontSize: 16),
                cursorColor: Theme.of(context).colorScheme.onPrimary,
                decoration: InputDecoration(
                  hintText: 'Buscar produtos...',
                  hintStyle: TextStyle(
                      color: Theme.of(context).colorScheme.onPrimary.withValues(alpha: 0.7)),
                  filled: false,
                  border: InputBorder.none,
                  enabledBorder: InputBorder.none,
                ),
              )
            : Text(widget.titulo),
        actions: _modoBusca
            ? [IconButton(icon: const Icon(Icons.search), onPressed: _recarregar)]
            : null,
        bottom: widget.subcategorias.isEmpty
            ? null
            : PreferredSize(
                preferredSize: const Size.fromHeight(52),
                child: SizedBox(
                  height: 52,
                  child: ListView(
                    scrollDirection: Axis.horizontal,
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                    children: [
                      _chip('Tudo', _subcategoriaId == null, () {
                        setState(() => _subcategoriaId = null);
                        _recarregar();
                      }),
                      for (final s in widget.subcategorias)
                        _chip(s['nome'] ?? '', _subcategoriaId == s['id'], () {
                          setState(() => _subcategoriaId = s['id'] as String);
                          _recarregar();
                        }),
                    ],
                  ),
                ),
              ),
      ),
      body: _corpo(),
    );
  }

  Widget _chip(String label, bool ativo, VoidCallback onTap) => Padding(
        padding: const EdgeInsets.only(right: 8),
        child: ChoiceChip(
          label: Text(label),
          selected: ativo,
          onSelected: (_) => onTap(),
          labelStyle: TextStyle(
              color: ativo
                  ? Theme.of(context).colorScheme.primary
                  : Theme.of(context).colorScheme.onPrimary,
              fontWeight: FontWeight.w600),
          backgroundColor: Theme.of(context).colorScheme.onPrimary.withValues(alpha: 0.15),
          selectedColor: Colors.white,
          side: BorderSide.none,
          showCheckmark: false,
        ),
      );

  Widget _corpo() {
    if (_erro != null && _produtos.isEmpty) {
      return EstadoErro(mensagem: _erro, onTentarNovamente: _recarregar);
    }
    if (_carregando && _produtos.isEmpty) {
      return GridView.count(
        physics: const NeverScrollableScrollPhysics(),
        padding: const EdgeInsets.all(16),
        crossAxisCount: 2,
        mainAxisSpacing: 12,
        crossAxisSpacing: 12,
        childAspectRatio: 0.68,
        children: List.generate(6, (_) => const Esqueleto(radius: 16)),
      );
    }
    if (_produtos.isEmpty) {
      return EstadoVazio(
        icone: Icons.search_off_rounded,
        titulo: 'Nenhum produto encontrado',
        mensagem: _modoBusca
            ? 'Tente outra palavra ou confira a ortografia.'
            : 'Ainda não há produtos aqui.',
      );
    }
    return RefreshIndicator(
      onRefresh: _recarregar,
      child: GridView.builder(
        controller: _scroll,
        padding: const EdgeInsets.all(16),
        gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
          maxCrossAxisExtent: 220,
          mainAxisSpacing: 12,
          crossAxisSpacing: 12,
          childAspectRatio: 0.68,
        ),
        itemCount: _produtos.length + (_fim ? 0 : 1),
        itemBuilder: (_, i) {
          if (i >= _produtos.length) {
            return const Center(
                child: Padding(
                    padding: EdgeInsets.all(16),
                    child: SizedBox(
                        width: 26, height: 26,
                        child: CircularProgressIndicator(strokeWidth: 2.5))));
          }
          return ProdutoCard(produto: _produtos[i]);
        },
      ),
    );
  }
}
