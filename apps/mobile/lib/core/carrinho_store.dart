import 'package:flutter/foundation.dart';

import 'api_client.dart';
import 'formatadores.dart';

/// Estado global do carrinho, espelho de GET /v1/carrinho.
/// Toda mutação vai à API e aplica a resposta — o servidor é a fonte da verdade
/// (preço da tabela do cliente, promoções e estoque são resolvidos lá).
class CarrinhoStore extends ChangeNotifier {
  CarrinhoStore._();
  static final CarrinhoStore instance = CarrinhoStore._();

  List<Map<String, dynamic>> itens = [];
  double subtotal = 0;
  bool carregando = false;
  String? erro;

  int get totalItens => itens.length;

  double quantidadeDe(String produtoId) {
    for (final i in itens) {
      if (i['produto_id'] == produtoId) return asDouble(i['quantidade']);
    }
    return 0;
  }

  Future<void> carregar() async {
    if (!ApiClient.instance.logado) return;
    carregando = true;
    erro = null;
    notifyListeners();
    try {
      _aplicar(await ApiClient.instance.get('/carrinho') as Map<String, dynamic>);
    } on ApiException catch (e) {
      erro = e.message;
    } catch (_) {
      erro = 'Sem conexão';
    } finally {
      carregando = false;
      notifyListeners();
    }
  }

  /// quantidade <= 0 remove o item (mesma regra da API).
  Future<void> definirQuantidade(String produtoId, double quantidade) async {
    final r = await ApiClient.instance
        .put('/carrinho/itens', {'produtoId': produtoId, 'quantidade': quantidade});
    _aplicar(r as Map<String, dynamic>);
    notifyListeners();
  }

  Future<void> remover(String produtoId) async {
    final r = await ApiClient.instance.delete('/carrinho/itens/$produtoId');
    _aplicar(r as Map<String, dynamic>);
    notifyListeners();
  }

  /// Após checkout ou logout — não chama a API.
  void limpar() {
    itens = [];
    subtotal = 0;
    erro = null;
    notifyListeners();
  }

  void _aplicar(Map<String, dynamic> resp) {
    itens = List<Map<String, dynamic>>.from(resp['itens'] as List? ?? const []);
    subtotal = asDouble(resp['subtotal']);
  }
}
