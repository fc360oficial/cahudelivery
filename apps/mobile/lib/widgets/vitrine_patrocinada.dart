import 'package:flutter/material.dart';

import '../features/catalog/produtos_screen.dart';
import 'produto_card.dart';

/// Vitrine patrocinada (indústria/fabricante) na Home: banner + logo redondo +
/// nome + carrossel horizontal de produtos + "Ver todos". Dados já vêm
/// embutidos na resposta do GET /v1/home — sem chamada de rede própria.
class VitrinePatrocinada extends StatelessWidget {
  const VitrinePatrocinada({super.key, required this.patrocinador});

  final Map<String, dynamic> patrocinador;

  @override
  Widget build(BuildContext context) {
    final produtos = List<Map<String, dynamic>>.from(patrocinador['produtos'] as List? ?? const []);
    if (produtos.isEmpty) return const SizedBox.shrink();
    final nome = patrocinador['nome'] as String? ?? '';
    final logoUrl = patrocinador['logoUrl'] as String?;
    final bannerUrl = patrocinador['bannerUrl'] as String?;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (bannerUrl != null && bannerUrl.isNotEmpty)
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 20, 16, 0),
            child: ClipRRect(
              borderRadius: BorderRadius.circular(16),
              child: AspectRatio(
                aspectRatio: 3.5,
                child: Image.network(
                  bannerUrl,
                  fit: BoxFit.cover,
                  errorBuilder: (_, e, s) => Container(color: Colors.grey.shade200),
                ),
              ),
            ),
          ),
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 14, 16, 10),
          child: Row(
            children: [
              if (logoUrl != null && logoUrl.isNotEmpty)
                Padding(
                  padding: const EdgeInsets.only(right: 10),
                  child: ClipOval(
                    child: Image.network(logoUrl, width: 32, height: 32, fit: BoxFit.cover,
                        errorBuilder: (_, e, s) => const SizedBox(width: 32, height: 32)),
                  ),
                ),
              Expanded(
                child: Text(nome, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
              ),
              TextButton(
                onPressed: () => Navigator.of(context).push(MaterialPageRoute(
                    builder: (_) => ProdutosScreen(titulo: nome, produtosFixos: produtos))),
                child: const Text('Ver todos'),
              ),
            ],
          ),
        ),
        SizedBox(
          height: 330,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 16),
            itemCount: produtos.length,
            separatorBuilder: (_, i) => const SizedBox(width: 10),
            itemBuilder: (_, i) => ProdutoCard(produto: produtos[i], largura: 150),
          ),
        ),
      ],
    );
  }
}