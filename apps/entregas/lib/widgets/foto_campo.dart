import 'dart:io';

import 'package:flutter/material.dart';

import '../app_servicos.dart';
import '../core/tema.dart';

/// Campo de foto: botão tracejado que abre a câmera; com foto, mostra a miniatura e deixa tirar de novo.
class FotoCampo extends StatelessWidget {
  const FotoCampo({super.key, required this.rotulo, required this.caminho, required this.aoMudar, this.altura = 130});
  final String rotulo;
  final String? caminho;
  final ValueChanged<String> aoMudar;
  final double altura;

  Future<void> _tirar(BuildContext context) async {
    try {
      final f = await Servicos.of(context).fotos.tirar();
      if (f != null) aoMudar(f);
    } catch (_) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Não foi possível abrir a câmera. Libere a câmera para o app.')));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = caminho;
    if (c != null) {
      return Stack(
        children: [
          ClipRRect(
            borderRadius: BorderRadius.circular(16),
            child: Image.file(File(c), height: altura + 50, width: double.infinity, fit: BoxFit.cover),
          ),
          Positioned(
            right: 8,
            bottom: 8,
            child: FilledButton.icon(
              style: FilledButton.styleFrom(minimumSize: const Size(0, 44), backgroundColor: Colors.white, foregroundColor: Cores.azul),
              onPressed: () => _tirar(context),
              icon: const Icon(Icons.refresh_rounded),
              label: const Text('Tirar de novo'),
            ),
          ),
        ],
      );
    }
    return Semantics(
      button: true,
      label: rotulo,
      child: InkWell(
        borderRadius: BorderRadius.circular(16),
        onTap: () => _tirar(context),
        child: Container(
          height: altura,
          decoration: BoxDecoration(
            color: const Color(0xFFF2F6FF),
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: const Color(0xFF7F93BC), width: 2),
          ),
          // Baixo: ícone ao lado do texto; alto: ícone em cima.
          child: Flex(
            direction: altura < 100 ? Axis.horizontal : Axis.vertical,
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Icon(Icons.photo_camera_rounded, color: Cores.azul, size: 34),
              const SizedBox(width: 10, height: 6),
              Flexible(child: Text(rotulo, textAlign: TextAlign.center, style: const TextStyle(color: Cores.azul, fontWeight: FontWeight.w800, fontSize: 16))),
            ],
          ),
        ),
      ),
    );
  }
}
