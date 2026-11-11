import 'dart:async';

import 'package:flutter/material.dart';

import '../../app_servicos.dart';
import '../../core/tema.dart';
import '../../data/modelos.dart';
import '../../widgets/comuns.dart';
import '../pedido/etapa_catalogo.dart';
import '../pedido/iniciar_pedido.dart';

/// Catálogo avulso (Início > Catálogo): só consulta. Foto, nome, estoque e o preço da tabela
/// escolhida no alto (a última usada fica lembrada). "Novo pedido" abre o fluxo normal.
class CatalogoPage extends StatefulWidget {
  const CatalogoPage({super.key});

  @override
  State<CatalogoPage> createState() => _CatalogoPageState();
}

class _CatalogoPageState extends State<CatalogoPage> {
  static const _pagina = 30;
  static const chaveTabela = 'catalogo_tabela';
  final _busca = TextEditingController();
  final _rolagem = ScrollController();
  Timer? _espera;
  List<TabelaComFormas> _tabelas = const [];
  List<Categoria> _categorias = const [];
  String? _tabelaId;
  String? _categoria;
  final List<ProdutoComPreco> _lista = [];
  bool _iniciando = true;
  bool _carregando = false;
  bool _temMais = true;
  String? _erro;
  int _geracao = 0;
  bool _iniciou = false;

  AppServicos get _s => Servicos.of(context);

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (!_iniciou) {
      _iniciou = true;
      _rolagem.addListener(_aoRolar);
      _iniciar();
    }
  }

  @override
  void dispose() {
    _espera?.cancel();
    _busca.dispose();
    _rolagem.dispose();
    super.dispose();
  }

  Future<void> _iniciar() async {
    final s = _s;
    try {
      final tabelas = await s.tabelas.listar();
      final categorias = await s.produtos.categorias();
      final lembrada = await s.meta.ler(chaveTabela);
      final id = tabelas.any((t) => t.tabela.id == lembrada) ? lembrada : (tabelas.isEmpty ? null : tabelas.first.tabela.id);
      if (!mounted) return;
      setState(() {
        _tabelas = tabelas;
        _categorias = categorias;
        _tabelaId = id;
        _iniciando = false;
      });
      await _carregar(reiniciar: true);
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _iniciando = false;
        _erro = 'Não foi possível ler o catálogo deste aparelho.';
      });
    }
  }

  void _aoRolar() {
    if (_rolagem.hasClients && _rolagem.position.pixels > _rolagem.position.maxScrollExtent - 400 && _temMais && !_carregando) {
      _carregar(reiniciar: false);
    }
  }

  Future<void> _carregar({required bool reiniciar}) async {
    final minha = ++_geracao;
    setState(() {
      _carregando = true;
      if (reiniciar) _erro = null;
    });
    try {
      final r = await _s.produtos.buscar(
        termo: _busca.text,
        categoriaId: _categoria,
        tabelaId: _tabelaId,
        limite: _pagina,
        deslocamento: reiniciar ? 0 : _lista.length,
      );
      if (!mounted || minha != _geracao) return;
      setState(() {
        if (reiniciar) _lista.clear();
        _lista.addAll(r);
        _temMais = r.length == _pagina;
        _carregando = false;
      });
    } catch (_) {
      if (!mounted || minha != _geracao) return;
      setState(() {
        _erro = 'Não foi possível ler o catálogo deste aparelho.';
        _carregando = false;
      });
    }
  }

  Future<void> _trocarTabela(String? id) async {
    if (id == null || id == _tabelaId) return;
    setState(() => _tabelaId = id);
    await _s.meta.gravar(chaveTabela, id);
    await _carregar(reiniciar: true);
  }

  void _escolherCategoria(String? id) {
    if (_categoria == id) return;
    setState(() => _categoria = id);
    _carregar(reiniciar: true);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Catálogo'),
        actions: [
          TextButton(
            key: const Key('catalogo-novo-pedido'),
            onPressed: () => iniciarNovoPedido(context),
            style: TextButton.styleFrom(foregroundColor: Cores.amarelo, minimumSize: const Size(48, 48)),
            child: const Text('Novo pedido', style: TextStyle(fontWeight: FontWeight.w800)),
          ),
          const SizedBox(width: 8),
        ],
      ),
      body: _iniciando ? const Center(child: CircularProgressIndicator()) : _conteudo(),
    );
  }

  Widget _conteudo() {
    if (_tabelas.isEmpty && _erro == null) {
      return const EstadoVazio(
        key: Key('catalogo-sem-tabelas'),
        icone: Icons.inventory_2_outlined,
        titulo: 'Catálogo vazio',
        texto: 'Sincronize o aplicativo para baixar as tabelas e os produtos.',
      );
    }
    return Column(
      children: [
        Container(
          color: Colors.white,
          padding: const EdgeInsets.fromLTRB(16, 10, 16, 0),
          child: Column(
            children: [
              DropdownButtonFormField<String>(
                key: const Key('seletor-tabela'),
                initialValue: _tabelaId,
                isExpanded: true,
                decoration: const InputDecoration(labelText: 'Tabela de preço', prefixIcon: Icon(Icons.sell_outlined)),
                items: [
                  for (final t in _tabelas)
                    DropdownMenuItem(value: t.tabela.id, child: Text(t.tabela.nome, maxLines: 1, overflow: TextOverflow.ellipsis)),
                ],
                onChanged: _trocarTabela,
              ),
              const SizedBox(height: 8),
              CampoBusca(
                chave: const Key('busca-catalogo'),
                controlador: _busca,
                dica: 'Buscar produto, código ou EAN',
                aoMudar: (_) {
                  _espera?.cancel();
                  _espera = Timer(const Duration(milliseconds: 250), () => _carregar(reiniciar: true));
                },
              ),
              SizedBox(
                height: 56,
                child: ListView(
                  scrollDirection: Axis.horizontal,
                  children: [
                    ChipFiltro(rotulo: 'Todos', ativo: _categoria == null, aoTocar: () => _escolherCategoria(null)),
                    for (final c in _categorias) ChipFiltro(rotulo: c.nome, ativo: _categoria == c.id, aoTocar: () => _escolherCategoria(c.id)),
                  ],
                ),
              ),
            ],
          ),
        ),
        const Divider(height: 1),
        Expanded(child: _lista_()),
      ],
    );
  }

  Widget _lista_() {
    if (_erro != null) return EstadoErro(mensagem: _erro!, aoTentarDeNovo: () => _carregar(reiniciar: true));
    if (_lista.isEmpty) {
      if (_carregando) return const Center(child: CircularProgressIndicator());
      final filtrando = _busca.text.trim().isNotEmpty || _categoria != null;
      return EstadoVazio(
        key: const Key('catalogo-vazio'),
        icone: filtrando ? Icons.search_off_rounded : Icons.inventory_2_outlined,
        titulo: filtrando ? 'Nenhum produto encontrado' : 'Catálogo vazio',
        texto: filtrando ? 'Tente outro nome, código ou categoria.' : 'Sincronize o aplicativo para baixar os produtos.',
      );
    }
    return ListView.separated(
      controller: _rolagem,
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
      itemCount: _lista.length + (_temMais ? 1 : 0),
      separatorBuilder: (_, _) => const SizedBox(height: 8),
      itemBuilder: (_, i) {
        if (i >= _lista.length) {
          return const Padding(padding: EdgeInsets.all(16), child: Center(child: CircularProgressIndicator(strokeWidth: 2.5)));
        }
        return CartaoProduto(item: _lista[i]);
      },
    );
  }
}
