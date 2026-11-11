import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';

/// Logo da distribuidora (cliente), pequena e discreta. Sem URL, ou se a imagem não carregar,
/// não ocupa espaço. Usa o cache de imagem em disco, então aparece também sem internet depois da primeira vez.
class LogoCliente extends StatelessWidget {
  const LogoCliente({super.key, required this.url, this.largura = 84, this.altura = 44});
  final String? url;
  final double largura, altura;

  /// Só para testes: devolve a imagem de uma URL sem rede.
  @visibleForTesting
  static ImageProvider? Function(String url)? provedor;

  @override
  Widget build(BuildContext context) {
    final u = url;
    if (u == null || u.isEmpty) return const SizedBox.shrink();
    final p = provedor?.call(u);
    final vazio = const SizedBox.shrink();
    return Semantics(
      label: 'Logo da distribuidora',
      child: ConstrainedBox(
        constraints: BoxConstraints(maxWidth: largura, maxHeight: altura),
        child: p != null
            ? Image(image: p, fit: BoxFit.contain, errorBuilder: (_, _, _) => vazio)
            : CachedNetworkImage(
                imageUrl: u,
                fit: BoxFit.contain,
                placeholder: (_, _) => vazio,
                errorWidget: (_, _, _) => vazio,
              ),
      ),
    );
  }
}
