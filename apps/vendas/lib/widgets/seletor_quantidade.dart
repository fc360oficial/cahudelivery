import 'package:flutter/material.dart';

import '../core/formatadores.dart' as fmt;
import '../core/tema.dart';

/// [-] quantidade [+] com alvos de toque de 48 dp. Tocar na quantidade abre um campo para digitar.
class SeletorQuantidade extends StatelessWidget {
  const SeletorQuantidade({
    super.key,
    required this.quantidade,
    required this.aoMudar,
    this.minimo = 0,
  });
  final double quantidade;
  final ValueChanged<double> aoMudar;

  /// Abaixo disso o valor vai a 0 (remove).
  final double minimo;

  static Future<double?> digitar(BuildContext context, double atual) {
    final c = TextEditingController(text: fmt.quantidade(atual));
    return showDialog<double>(
      context: context,
      builder: (ctx) {
        void confirmar() {
          final v = double.tryParse(c.text.trim().replaceAll(',', '.'));
          if (v != null && v >= 0 && v <= 9999999) Navigator.pop(ctx, v);
        }

        return AlertDialog(
          title: const Text('Quantidade'),
          content: TextField(
            controller: c,
            autofocus: true,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            onSubmitted: (_) => confirmar(),
            decoration: const InputDecoration(hintText: 'Ex.: 12'),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx),
              child: const Text('Cancelar'),
            ),
            FilledButton(
              style: FilledButton.styleFrom(minimumSize: const Size(0, 48)),
              onPressed: confirmar,
              child: const Text('Confirmar'),
            ),
          ],
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        _Botao(
          icone: Icons.remove_rounded,
          dica: 'Diminuir',
          aoTocar: () => aoMudar(quantidade - 1 < minimo ? 0 : quantidade - 1),
        ),
        InkWell(
          borderRadius: BorderRadius.circular(10),
          onTap: () async {
            final v = await digitar(context, quantidade);
            if (v != null) aoMudar(v);
          },
          child: Container(
            constraints: const BoxConstraints(minWidth: 52, minHeight: 48),
            alignment: Alignment.center,
            child: Text(
              fmt.quantidade(quantidade),
              style: const TextStyle(
                fontSize: 17,
                fontWeight: FontWeight.w800,
                color: Cores.marinho,
              ),
            ),
          ),
        ),
        _Botao(
          icone: Icons.add_rounded,
          dica: 'Aumentar',
          aoTocar: () => aoMudar(quantidade + 1),
          destaque: true,
        ),
      ],
    );
  }
}

class _Botao extends StatelessWidget {
  const _Botao({
    required this.icone,
    required this.dica,
    required this.aoTocar,
    this.destaque = false,
  });
  final IconData icone;
  final String dica;
  final VoidCallback aoTocar;
  final bool destaque;

  @override
  Widget build(BuildContext context) {
    return Tooltip(
      message: dica,
      child: InkWell(
        borderRadius: BorderRadius.circular(24),
        onTap: aoTocar,
        child: Container(
          width: 48,
          height: 48,
          alignment: Alignment.center,
          child: Container(
            width: 36,
            height: 36,
            decoration: BoxDecoration(
              color: destaque ? Cores.azul : Colors.white,
              shape: BoxShape.circle,
              border: destaque
                  ? null
                  : Border.all(color: Cores.linha, width: 1.5),
            ),
            child: Icon(
              icone,
              size: 22,
              color: destaque ? Colors.white : Cores.azul,
            ),
          ),
        ),
      ),
    );
  }
}

/// Versão em pílula do seletor (− qtd +), para as linhas do pedido: botões de 40 x 48 dp e a quantidade
/// no meio; tocar nela abre o campo para digitar. Em 0 o item sai do pedido.
class SeletorQuantidadeCompacto extends StatelessWidget {
  const SeletorQuantidadeCompacto({
    super.key,
    required this.quantidade,
    required this.aoMudar,
  });
  final double quantidade;
  final ValueChanged<double> aoMudar;

  @override
  Widget build(BuildContext context) {
    Widget botao(IconData i, String dica, VoidCallback f) => Tooltip(
      message: dica,
      child: InkWell(
        customBorder: const CircleBorder(),
        onTap: f,
        child: SizedBox(
          width: 38,
          height: 48,
          child: Icon(i, size: 20, color: Cores.azul),
        ),
      ),
    );
    return Container(
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(22),
        border: Border.all(color: Cores.linha, width: 1.5),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          botao(
            Icons.remove_rounded,
            'Diminuir',
            () => aoMudar(quantidade - 1 < 0 ? 0 : quantidade - 1),
          ),
          InkWell(
            onTap: () async {
              final v = await SeletorQuantidade.digitar(context, quantidade);
              if (v != null) aoMudar(v);
            },
            child: Container(
              constraints: const BoxConstraints(minWidth: 24, minHeight: 48),
              alignment: Alignment.center,
              child: Text(
                fmt.quantidade(quantidade),
                style: const TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w800,
                  color: Cores.marinho,
                ),
              ),
            ),
          ),
          botao(Icons.add_rounded, 'Aumentar', () => aoMudar(quantidade + 1)),
        ],
      ),
    );
  }
}
