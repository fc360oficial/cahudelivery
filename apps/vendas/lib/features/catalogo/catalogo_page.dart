import 'dart:async';

import 'package:flutter/material.dart';

import '../../app_servicos.dart';
import '../../core/tema.dart';
import '../../data/modelos.dart';
import '../../widgets/barra_navegacao.dart';
import '../../widgets/comuns.dart';
import '../pedido/etapa_catalogo.dart';
import '../pedido/iniciar_pedido.dart';

/// Catálogo avulso (Início > Catálogo): só consulta. Foto, nome, embalagem e estoque de todos os
/// produtos. Não tem tabela nem preço: preço só existe dentro de um pedido. "Novo pedido" abre o fluxo normal.
class CatalogoPage extends StatefulWidget {
  const CatalogoPage({super.key});

  @override
  State<CatalogoPage> createState() => _CatalogoPageState();
}

class _CatalogoPageState extends State<CatalogoPage> {
  static const _pagina = 30;
  final _busca = TextEditingController();
  final _rolagem = ScrollController();
  Timer? _espera;
  List<Categoria> _categorias = const [];
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
      final categorias = await s.produtos.categorias();
      if (!mounted) return;
      setState(() {
        _categorias = categorias;
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
    if (_rolagem.hasClients &&
        _rolagem.position.pixels > _rolagem.position.maxScrollExtent - 400 &&
        _temMais &&
        !_carregando) {
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
            style: TextButton.styleFrom(
              foregroundColor: Cores.amarelo,
              minimumSize: const Size(48, 48),
            ),
            child: const Text(
              'Novo pedido',
              style: TextStyle(fontWeight: FontWeight.w800),
            ),
          ),
          const SizedBox(width: 8),
        ],
      ),
      bottomNavigationBar: const BarraNavegacaoEmpilhada(
        atual: AbaVendas.inicio,
      ),
      body: _iniciando
          ? const Center(child: CircularProgressIndicator())
          : _conteudo(),
    );
  }

  Widget _conteudo() {
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
          child: Column(
            children: [
              CampoBusca(
                chave: const Key('busca-catalogo'),
                controlador: _busca,
                dica: 'Buscar produto...',
                aoMudar: (_) {
                  _espera?.cancel();
                  _espera = Timer(
                    const Duration(milliseconds: 250),
                    () => _carregar(reiniciar: true),
                  );
                },
              ),
              SizedBox(
                height: 56,
                child: ListView(
                  scrollDirection: Axis.horizontal,
                  children: [
                    ChipFiltro(
                      rotulo: 'Todos',
                      ativo: _categoria == null,
                      aoTocar: () => _escolherCategoria(null),
                    ),
                    for (final c in _categorias)
                      ChipFiltro(
                        rotulo: c.nome,
                        ativo: _categoria == c.id,
                        aoTocar: () => _escolherCategoria(c.id),
                      ),
                  ],
                ),
              ),
            ],
          ),
        ),
        Expanded(child: _lista_()),
      ],
    );
  }

  Widget _lista_() {
    if (_erro != null) {
      return EstadoErro(
        mensagem: _erro!,
        aoTentarDeNovo: () => _carregar(reiniciar: true),
      );
    }
    if (_lista.isEmpty) {
      if (_carregando) return const Center(child: CircularProgressIndicator());
      final filtrando = _busca.text.trim().isNotEmpty || _categoria != null;
      return EstadoVazio(
        key: const Key('catalogo-vazio'),
        icone: filtrando
            ? Icons.search_off_rounded
            : Icons.inventory_2_outlined,
        titulo: filtrando ? 'Nenhum produto encontrado' : 'Catálogo vazio',
        texto: filtrando
            ? 'Tente outro nome, código ou categoria.'
            : 'Sincronize o aplicativo para baixar os produtos.',
      );
    }
    return GradeProdutos(
      controlador: _rolagem,
      itens: _lista,
      temMais: _temMais,
      mostrarPreco: false,
    );
  }
}
