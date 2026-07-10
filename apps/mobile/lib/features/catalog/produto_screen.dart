import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../core/carrinho_store.dart';
import '../../core/formatadores.dart';
import '../../widgets/estados.dart';
import '../../widgets/stepper_quantidade.dart';

/// Detalhe do produto (GET /v1/produtos/:id): galeria, preço da tabela do
/// cliente, unidade de venda, qtd mínima e barra fixa "Adicionar ao carrinho".
class ProdutoScreen extends StatefulWidget {
  const ProdutoScreen({super.key, required this.produtoId});
  final String produtoId;

  @override
  State<ProdutoScreen> createState() => _ProdutoScreenState();
}

class _ProdutoScreenState extends State<ProdutoScreen> {
  Map<String, dynamic>? _p;
  String? _erro;
  double _quantidade = 1;
  int _foto = 0;
  bool _adicionando = false;

  @override
  void initState() {
    super.initState();
    _carregar();
  }

  Future<void> _carregar() async {
    setState(() {
      _p = null;
      _erro = null;
    });
    try {
      final r = await ApiClient.instance.get('/produtos/${widget.produtoId}')
          as Map<String, dynamic>;
      if (!mounted) return;
      final minima = asDouble(r['qtd_minima']);
      final noCarrinho = CarrinhoStore.instance.quantidadeDe(widget.produtoId);
      setState(() {
        _p = r;
        _quantidade = noCarrinho > 0 ? noCarrinho : (minima > 1 ? minima : 1);
      });
    } on ApiException catch (e) {
      if (mounted) setState(() => _erro = e.message);
    } catch (_) {
      if (mounted) setState(() => _erro = 'Sem conexão — verifique sua internet');
    }
  }

  Future<void> _adicionar() async {
    setState(() => _adicionando = true);
    try {
      await CarrinhoStore.instance.definirQuantidade(widget.produtoId, _quantidade);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: const Text('Adicionado ao carrinho'),
        behavior: SnackBarBehavior.floating,
        duration: const Duration(seconds: 2),
        action: SnackBarAction(
            label: 'Continuar comprando', onPressed: () => Navigator.of(context).pop()),
      ));
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(e.toString())));
      }
    } finally {
      if (mounted) setState(() => _adicionando = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_erro != null) {
      return Scaffold(
        appBar: AppBar(),
        body: EstadoErro(mensagem: _erro, onTentarNovamente: _carregar),
      );
    }
    if (_p == null) {
      return Scaffold(
        appBar: AppBar(),
        body: ListView(
          physics: const NeverScrollableScrollPhysics(),
          padding: const EdgeInsets.all(16),
          children: const [
            Esqueleto(height: 280, radius: 16),
            SizedBox(height: 20),
            Esqueleto(height: 22, width: 260),
            SizedBox(height: 10),
            Esqueleto(height: 16, width: 140),
            SizedBox(height: 24),
            Esqueleto(height: 30, width: 120),
          ],
        ),
      );
    }

    final p = _p!;
    final tema = Theme.of(context).colorScheme;
    final imagens = (p['imagens'] as List?) ?? const [];
    final emPromocao = p['preco_promocional'] != null;
    final estoque = asDouble(p['estoque']);
    final minima = asDouble(p['qtd_minima']);
    final semEstoque = estoque <= 0;
    final total = asDouble(p['preco']) * _quantidade;

    return Scaffold(
      appBar: AppBar(title: Text(p['nome'] ?? '', overflow: TextOverflow.ellipsis)),
      body: ListView(
        padding: const EdgeInsets.only(bottom: 24),
        children: [
          // Galeria
          SizedBox(
            height: 300,
            child: imagens.isEmpty
                ? Container(
                    color: Colors.grey.shade100,
                    child: Icon(Icons.inventory_2_outlined,
                        size: 80, color: Colors.grey.shade400),
                  )
                : PageView.builder(
                    itemCount: imagens.length,
                    onPageChanged: (i) => setState(() => _foto = i),
                    itemBuilder: (_, i) => Image.network(
                      imagens[i]['url'] ?? '',
                      fit: BoxFit.contain,
                      errorBuilder: (_, e, s) => Container(
                        color: Colors.grey.shade100,
                        child: Icon(Icons.broken_image_outlined,
                            size: 60, color: Colors.grey.shade400),
                      ),
                    ),
                  ),
          ),
          if (imagens.length > 1)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: List.generate(imagens.length, (i) {
                  final ativo = i == _foto;
                  return AnimatedContainer(
                    duration: const Duration(milliseconds: 200),
                    margin: const EdgeInsets.symmetric(horizontal: 3),
                    width: ativo ? 18 : 7,
                    height: 7,
                    decoration: BoxDecoration(
                      color: ativo ? tema.primary : Colors.grey.shade300,
                      borderRadius: BorderRadius.circular(4),
                    ),
                  );
                }),
              ),
            ),
          Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (p['marca'] != null)
                  Text('${p['marca']}'.toUpperCase(),
                      style: TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w700,
                          letterSpacing: 0.6,
                          color: Colors.grey.shade600)),
                const SizedBox(height: 4),
                Text(p['nome'] ?? '',
                    style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800, height: 1.25)),
                const SizedBox(height: 12),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    _tag('${p['unidade_venda'] ?? 'UN'}'
                        '${asDouble(p['qtd_por_embalagem']) > 1 ? ' c/ ${asDouble(p['qtd_por_embalagem']).toInt()}' : ''}'),
                    if (minima > 1) _tag('Mín. ${minima.toInt()}'),
                    if (p['sku'] != null) _tag('Cód. ${p['sku']}'),
                    _tag(semEstoque ? 'Sem estoque' : 'Disponível',
                        cor: semEstoque ? Colors.red.shade50 : Colors.green.shade50,
                        corTexto: semEstoque ? Colors.red.shade700 : Colors.green.shade700),
                  ],
                ),
                const SizedBox(height: 18),
                if (emPromocao)
                  Text(moeda(p['preco_tabela']),
                      style: TextStyle(
                          fontSize: 15,
                          color: Colors.grey.shade500,
                          decoration: TextDecoration.lineThrough)),
                Text(moeda(p['preco']),
                    style: TextStyle(
                        fontSize: 30,
                        fontWeight: FontWeight.w800,
                        color: emPromocao ? Colors.red.shade600 : tema.primary)),
                Text('por ${p['unidade_venda'] ?? 'unidade'}',
                    style: TextStyle(fontSize: 13, color: Colors.grey.shade600)),
                if ((p['descricao'] ?? '').toString().isNotEmpty) ...[
                  const SizedBox(height: 22),
                  const Text('Descrição',
                      style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
                  const SizedBox(height: 8),
                  Text('${p['descricao']}',
                      style: TextStyle(
                          fontSize: 14, height: 1.5, color: Colors.grey.shade800)),
                ],
              ],
            ),
          ),
        ],
      ),
      bottomNavigationBar: semEstoque
          ? null
          : SafeArea(
              child: Container(
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
                decoration: BoxDecoration(
                  color: Colors.white,
                  boxShadow: [
                    BoxShadow(
                        color: Colors.black.withValues(alpha: 0.06),
                        blurRadius: 12,
                        offset: const Offset(0, -4)),
                  ],
                ),
                child: Row(
                  children: [
                    StepperQuantidade(
                      quantidade: _quantidade,
                      minimo: minima > 1 ? minima : 1,
                      maximo: estoque,
                      onMudar: (v) => setState(() => _quantidade = v),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: FilledButton(
                        onPressed: _adicionando ? null : _adicionar,
                        child: _adicionando
                            ? const SizedBox(
                                width: 22, height: 22,
                                child: CircularProgressIndicator(
                                    strokeWidth: 2.5, color: Colors.white))
                            : Text('Adicionar  •  ${moeda(total)}'),
                      ),
                    ),
                  ],
                ),
              ),
            ),
    );
  }

  Widget _tag(String texto, {Color? cor, Color? corTexto}) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
        decoration: BoxDecoration(
          color: cor ?? Colors.grey.shade100,
          borderRadius: BorderRadius.circular(8),
        ),
        child: Text(texto,
            style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w600,
                color: corTexto ?? Colors.grey.shade700)),
      );
}
