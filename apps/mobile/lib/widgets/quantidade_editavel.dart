import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

/// Número do stepper que vira campo ao toque: abre o teclado numérico com o
/// valor selecionado, confirma no Enter ou ao sair do campo. Aplica as mesmas
/// regras do "+"/"−": mínimo do produto e estoque. Vazio volta pro valor
/// anterior; 0 remove (quando permitirRemover) ou volta pro mínimo.
class QuantidadeEditavel extends StatefulWidget {
  const QuantidadeEditavel({
    super.key,
    required this.quantidade,
    required this.onConfirmar,
    this.minimo = 1,
    this.maximo,
    this.permitirRemover = false,
    this.onEditando,
    this.autofocus = false,
    this.style,
    this.corFoco,
    this.largura = 44,
    this.nomeUnidade,
  });

  final double quantidade;
  final double minimo;
  final double? maximo;
  final bool permitirRemover;
  final bool autofocus;
  final TextStyle? style;
  final Color? corFoco;
  final double largura;
  final String? nomeUnidade;
  final ValueChanged<double> onConfirmar;
  final ValueChanged<bool>? onEditando;

  static String formatar(double v) => v % 1 == 0 ? v.toInt().toString() : v.toString();

  /// Regra pura, testável: devolve (valor ajustado, aviso ou null).
  static (double, String?) ajustar({
    required double digitado,
    required double atual,
    required double minimo,
    double? maximo,
    bool permitirRemover = false,
    String unidade = 'un',
  }) {
    final min = minimo < 1 ? 1.0 : minimo;
    if (digitado.isNaN) return (atual, null);
    if (digitado <= 0) {
      return permitirRemover ? (0, null) : (min, 'Mínimo ${formatar(min)} $unidade');
    }
    if (digitado < min) return (min, 'Pedido mínimo: ${formatar(min)} $unidade');
    if (maximo != null && maximo > 0 && digitado > maximo) {
      return (maximo, 'Só ${formatar(maximo)} $unidade em estoque');
    }
    return (digitado, null);
  }

  @override
  State<QuantidadeEditavel> createState() => _QuantidadeEditavelState();
}

class _QuantidadeEditavelState extends State<QuantidadeEditavel> {
  late final TextEditingController _ctrl =
      TextEditingController(text: QuantidadeEditavel.formatar(widget.quantidade));
  final _foco = FocusNode();
  bool _editando = false;

  @override
  void initState() {
    super.initState();
    _foco.addListener(_focoMudou);
  }

  @override
  void didUpdateWidget(QuantidadeEditavel old) {
    super.didUpdateWidget(old);
    if (!_foco.hasFocus && old.quantidade != widget.quantidade) {
      _ctrl.text = QuantidadeEditavel.formatar(widget.quantidade);
    }
  }

  void _focoMudou() {
    if (_foco.hasFocus) {
      setState(() => _editando = true);
      widget.onEditando?.call(true);
      // Seleciona tudo pra digitar por cima direto.
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted) return;
        _ctrl.selection = TextSelection(baseOffset: 0, extentOffset: _ctrl.text.length);
      });
    } else {
      _confirmar();
      if (mounted) setState(() => _editando = false);
      widget.onEditando?.call(false);
    }
  }

  void _confirmar() {
    final bruto = _ctrl.text.trim().replaceAll(',', '.');
    if (bruto.isEmpty) {
      _ctrl.text = QuantidadeEditavel.formatar(widget.quantidade);
      return;
    }
    final (v, aviso) = QuantidadeEditavel.ajustar(
      digitado: double.tryParse(bruto) ?? double.nan,
      atual: widget.quantidade,
      minimo: widget.minimo,
      maximo: widget.maximo,
      permitirRemover: widget.permitirRemover,
      unidade: widget.nomeUnidade ?? 'un',
    );
    _ctrl.text = QuantidadeEditavel.formatar(v);
    if (aviso != null && mounted) {
      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(SnackBar(content: Text(aviso), duration: const Duration(seconds: 2)));
    }
    if (v != widget.quantidade) widget.onConfirmar(v);
  }

  @override
  void dispose() {
    _foco.removeListener(_focoMudou);
    _foco.dispose();
    _ctrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final estilo = (widget.style ?? const TextStyle(fontSize: 16, fontWeight: FontWeight.w700))
        .copyWith(fontFeatures: const [FontFeature.tabularFigures()]);
    return Semantics(
      label: 'Quantidade, toque pra digitar',
      child: SizedBox(
        width: widget.largura,
        child: TextField(
          controller: _ctrl,
          focusNode: _foco,
          autofocus: widget.autofocus,
          textAlign: TextAlign.center,
          style: estilo,
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[0-9.,]'))],
          textInputAction: TextInputAction.done,
          onSubmitted: (_) => _foco.unfocus(),
          onTapOutside: (_) => _foco.unfocus(),
          scrollPadding: const EdgeInsets.all(120),
          decoration: InputDecoration(
            isDense: true,
            filled: _editando,
            fillColor: widget.corFoco ?? Colors.white.withValues(alpha: 0.6),
            contentPadding: const EdgeInsets.symmetric(vertical: 6, horizontal: 2),
            border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(8), borderSide: BorderSide.none),
            enabledBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(8), borderSide: BorderSide.none),
            focusedBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(8),
                borderSide: BorderSide(color: estilo.color ?? Colors.black, width: 1.5)),
          ),
        ),
      ),
    );
  }
}
