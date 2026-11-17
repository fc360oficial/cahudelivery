import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';

import '../core/tema.dart';

/// Foto do produto (cache em disco; ícone quando não há foto ou ela não carrega).
class FotoProduto extends StatelessWidget {
  const FotoProduto({
    super.key,
    this.url,
    this.lado = 64,
    this.raio = 12,
    this.ajuste = BoxFit.contain,
  });
  final String? url;
  final double lado, raio;
  final BoxFit ajuste;

  /// Só para testes: devolve a imagem de uma URL a partir de arquivos locais, sem rede.
  @visibleForTesting
  static ImageProvider? Function(String url)? provedor;

  @override
  Widget build(BuildContext context) {
    Widget vazio() => Container(
      width: lado,
      height: lado,
      color: Cores.fundo,
      child: Icon(
        Icons.image_outlined,
        color: Cores.textoSuave,
        size: lado * 0.4,
      ),
    );
    final u = url;
    Widget conteudo;
    if (u == null || u.isEmpty) {
      conteudo = vazio();
    } else if (provedor?.call(u) case final ImageProvider p) {
      conteudo = Image(
        image: p,
        width: lado,
        height: lado,
        fit: ajuste,
        errorBuilder: (_, _, _) => vazio(),
      );
    } else {
      conteudo = CachedNetworkImage(
        imageUrl: u,
        width: lado,
        height: lado,
        fit: ajuste,
        placeholder: (_, _) => Container(
          width: lado,
          height: lado,
          color: Cores.fundo,
          alignment: Alignment.center,
          child: const SizedBox(
            width: 20,
            height: 20,
            child: CircularProgressIndicator(strokeWidth: 2),
          ),
        ),
        errorWidget: (_, _, _) => vazio(),
      );
    }
    return ClipRRect(
      borderRadius: BorderRadius.circular(raio),
      child: Container(color: Colors.white, child: conteudo),
    );
  }
}
