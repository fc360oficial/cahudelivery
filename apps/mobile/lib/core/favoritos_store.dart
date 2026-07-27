import 'package:flutter/foundation.dart';

import 'api_client.dart';

/// Estado global dos favoritos do cliente logado, espelho de GET /favoritos.
/// Salvo no servidor (não local) para sincronizar entre dispositivos.
/// Visitante nunca tem favoritos — fica com o Set vazio até logar.
class FavoritosStore extends ChangeNotifier {
  FavoritosStore._();
  static final FavoritosStore instance = FavoritosStore._();

  Set<String> favoritados = {};

  bool favoritado(String produtoId) => favoritados.contains(produtoId);

  Future<void> carregar() async {
    if (!ApiClient.instance.logado) {
      favoritados = {};
      notifyListeners();
      return;
    }
    try {
      final r = await ApiClient.instance.get('/favoritos') as List;
      favoritados = r.map((e) => e as String).toSet();
    } catch (_) {
      // Sem conexão no boot: mantém o estado atual em vez de derrubar o app.
    }
    notifyListeners();
  }

  /// Chama a API primeiro (fonte da verdade), só então atualiza o estado local.
  Future<void> alternar(String produtoId) async {
    if (favoritados.contains(produtoId)) {
      await ApiClient.instance.delete('/favoritos/$produtoId');
      favoritados.remove(produtoId);
    } else {
      await ApiClient.instance.post('/favoritos/$produtoId');
      favoritados.add(produtoId);
    }
    notifyListeners();
  }

  /// Após logout — não chama a API.
  void limpar() {
    favoritados = {};
    notifyListeners();
  }
}