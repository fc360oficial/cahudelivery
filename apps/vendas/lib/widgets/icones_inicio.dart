import 'package:flutter/material.dart';

import '../core/tema.dart';

enum TipoIconeInicio { pedido, clientes, catalogo, orcamentos }

/// Ícones dos atalhos do Início: formas azuis com detalhe amarelo (e azul-marinho), desenhados em
/// uma grade de 48 x 48 e escalados para [tamanho]. Chapados, sem relevo.
class IconeInicio extends StatelessWidget {
  const IconeInicio(this.tipo, {super.key, this.tamanho = 48});
  final TipoIconeInicio tipo;
  final double tamanho;

  @override
  Widget build(BuildContext context) => ExcludeSemantics(
        child: CustomPaint(
          size: Size.square(tamanho),
          painter: _PintorIcone(tipo, DefaultTextStyle.of(context).style.fontFamily),
        ),
      );
}

class _PintorIcone extends CustomPainter {
  _PintorIcone(this.tipo, this.familia);
  final TipoIconeInicio tipo;
  final String? familia;

  static const _azulEscuro = Color(0xFF143F9E);

  Paint _p(Color c) => Paint()
    ..color = c
    ..isAntiAlias = true;
  Paint _traco(Color c, double w) => Paint()
    ..color = c
    ..style = PaintingStyle.stroke
    ..strokeWidth = w
    ..strokeCap = StrokeCap.round
    ..strokeJoin = StrokeJoin.round
    ..isAntiAlias = true;

  @override
  void paint(Canvas canvas, Size size) {
    canvas.scale(size.width / 48, size.height / 48);
    switch (tipo) {
      case TipoIconeInicio.pedido:
        _carrinho(canvas);
      case TipoIconeInicio.clientes:
        _clientes(canvas);
      case TipoIconeInicio.catalogo:
        _caixa(canvas);
      case TipoIconeInicio.orcamentos:
        _orcamento(canvas);
    }
  }

  void _carrinho(Canvas c) {
    c.drawPath(
      Path()
        ..moveTo(3, 7)
        ..lineTo(9, 7)
        ..lineTo(15, 31)
        ..lineTo(38, 31),
      _traco(Cores.marinho, 3.4),
    );
    final cesta = Path()
      ..moveTo(11.5, 12.5)
      ..lineTo(44, 12.5)
      ..lineTo(39.5, 27)
      ..lineTo(15.5, 27)
      ..close();
    c.drawPath(cesta, _p(Cores.azul));
    c.drawPath(cesta, _traco(Cores.azul, 3));
    // faixa amarela na cesta
    c.drawPath(
      Path()
        ..moveTo(15, 19.5)
        ..lineTo(40.5, 19.5),
      _traco(Cores.amarelo, 3),
    );
    c.drawCircle(const Offset(19.5, 40), 4, _p(Cores.amarelo));
    c.drawCircle(const Offset(34.5, 40), 4, _p(Cores.amarelo));
  }

  void _pessoa(Canvas c, double cx, double cabecaY, double raio, double corpoTopo,
      double largura, Color cor, {Color? contorno}) {
    final corpo = RRect.fromRectAndCorners(
      Rect.fromLTRB(cx - largura / 2, corpoTopo, cx + largura / 2, 40),
      topLeft: Radius.circular(largura / 2),
      topRight: Radius.circular(largura / 2),
      bottomLeft: const Radius.circular(3),
      bottomRight: const Radius.circular(3),
    );
    if (contorno != null) {
      c.drawRRect(corpo, _traco(contorno, 3));
      c.drawCircle(Offset(cx, cabecaY), raio, _traco(contorno, 3));
    }
    c.drawRRect(corpo, _p(cor));
    c.drawCircle(Offset(cx, cabecaY), raio, _p(cor));
  }

  void _clientes(Canvas c) {
    _pessoa(c, 9, 17, 4.8, 25, 17, Cores.amarelo);
    _pessoa(c, 39, 17, 4.8, 25, 17, Cores.amarelo);
    _pessoa(c, 24, 14, 7, 24, 24, Cores.azul, contorno: Colors.white);
  }

  void _caixa(Canvas c) {
    const topo = Offset(24, 4);
    const dirCima = Offset(41, 13.5);
    const dirBaixo = Offset(41, 33.5);
    const base = Offset(24, 44);
    const esqBaixo = Offset(7, 33.5);
    const esqCima = Offset(7, 13.5);
    const centro = Offset(24, 23.5);
    Path face(List<Offset> v) => Path()..addPolygon(v, true);
    final faces = [
      (face([topo, dirCima, centro, esqCima]), Cores.amarelo),
      (face([esqCima, centro, base, esqBaixo]), Cores.azul),
      (face([centro, dirCima, dirBaixo, base]), _azulEscuro),
    ];
    for (final (f, cor) in faces) {
      c.drawPath(f, _p(cor));
      c.drawPath(f, _traco(cor, 1.2));
    }
    for (final (f, _) in faces) {
      c.drawPath(f, _traco(Colors.white, 1.6));
    }
  }

  void _orcamento(Canvas c) {
    final pagina = Path()
      ..moveTo(10, 4)
      ..lineTo(28, 4)
      ..lineTo(38, 14)
      ..lineTo(38, 41)
      ..quadraticBezierTo(38, 44, 35, 44)
      ..lineTo(13, 44)
      ..quadraticBezierTo(10, 44, 10, 41)
      ..close();
    c.drawPath(pagina, _p(Cores.azul));
    c.drawPath(
      Path()
        ..moveTo(28, 4)
        ..lineTo(38, 14)
        ..lineTo(28, 14)
        ..close(),
      _p(Cores.amarelo),
    );
    c.drawPath(
      Path()
        ..moveTo(16, 21)
        ..lineTo(26, 21)
        ..moveTo(16, 27)
        ..lineTo(22, 27),
      _traco(Colors.white, 2.6),
    );
    const moeda = Offset(32, 35);
    c.drawCircle(moeda, 10.5, _p(Colors.white));
    c.drawCircle(moeda, 8.5, _p(Cores.amarelo));
    final tp = TextPainter(
      text: TextSpan(
        text: r'$',
        style: TextStyle(
          fontFamily: familia,
          fontSize: 14,
          height: 1,
          fontWeight: FontWeight.w900,
          color: Cores.marinho,
        ),
      ),
      textDirection: TextDirection.ltr,
    )..layout();
    tp.paint(c, moeda - Offset(tp.width / 2, tp.height / 2));
  }

  @override
  bool shouldRepaint(_PintorIcone old) => old.tipo != tipo || old.familia != familia;
}
