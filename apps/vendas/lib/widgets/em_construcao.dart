import 'package:flutter/material.dart';

import '../core/tema.dart';

/// Tela provisória das áreas ainda não construídas.
class EmConstrucaoPage extends StatelessWidget {
  const EmConstrucaoPage({super.key, required this.titulo, this.comAppBar = true});
  final String titulo;

  /// false quando usada como aba (a casca já tem o cabeçalho).
  final bool comAppBar;

  @override
  Widget build(BuildContext context) {
    final corpo = Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.construction_rounded, size: 56, color: Cores.amarelo),
            const SizedBox(height: 16),
            Text(titulo, style: Theme.of(context).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w700)),
            const SizedBox(height: 8),
            const Text('Em construção', style: TextStyle(color: Cores.textoSuave, fontSize: 16)),
          ],
        ),
      ),
    );
    if (!comAppBar) return corpo;
    return Scaffold(appBar: AppBar(title: Text(titulo)), body: corpo);
  }
}
