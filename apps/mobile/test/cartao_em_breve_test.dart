import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:fluxo_commerce_app/features/checkout/cartao_em_breve.dart';

void main() {
  group('mostrarCartaoEmBreve', () {
    test('só quando a retaguarda ligou o aviso e o cartão está desligado', () {
      expect(mostrarCartaoEmBreve({'cartao_em_breve': true, 'formas_pagamento': ['pix']}), isTrue);
    });

    test('cartão aceito no checkout: não mostra o aviso', () {
      expect(mostrarCartaoEmBreve({'cartao_em_breve': true, 'formas_pagamento': ['pix', 'cartao']}), isFalse);
    });

    test('aviso desligado (ou ausente): não mostra', () {
      expect(mostrarCartaoEmBreve({'formas_pagamento': ['pix']}), isFalse);
      expect(mostrarCartaoEmBreve({'cartao_em_breve': false, 'formas_pagamento': ['pix']}), isFalse);
    });

    test('sem config de formas o app mostra todas (inclui cartão): não mostra', () {
      expect(mostrarCartaoEmBreve({'cartao_em_breve': true}), isFalse);
    });
  });

  group('linkWhatsApp', () {
    test('monta wa.me com DDI 55 e só dígitos', () {
      expect(linkWhatsApp('(81) 98646-0098'), 'https://wa.me/5581986460098');
    });

    test('número já com 55 não duplica', () {
      expect(linkWhatsApp('+55 81 98646-0098'), 'https://wa.me/5581986460098');
    });

    test('vazio ou nulo: sem link', () {
      expect(linkWhatsApp(null), isNull);
      expect(linkWhatsApp('  '), isNull);
    });
  });

  group('CartaoEmBreveCard', () {
    testWidgets('mostra o selo Em breve e o texto da distribuidora', (tester) async {
      await tester.pumpWidget(const MaterialApp(
        home: Scaffold(body: CartaoEmBreveCard(whatsapp: '81986460098', horario: 'Seg a sex, 8h às 17h')),
      ));
      expect(find.text('Cartão de crédito'), findsOneWidget);
      expect(find.text('EM BREVE'), findsOneWidget);
      expect(find.textContaining('compre direto na distribuidora'), findsOneWidget);
      expect(find.text('Falar com a distribuidora'), findsOneWidget);
    });

    testWidgets('toque abre o aviso com o botão do WhatsApp', (tester) async {
      await tester.pumpWidget(const MaterialApp(
        home: Scaffold(body: CartaoEmBreveCard(whatsapp: '81986460098', horario: 'Seg a sex, 8h às 17h')),
      ));
      await tester.tap(find.text('Cartão de crédito'));
      await tester.pumpAndSettle();
      expect(find.text('Chamar no WhatsApp'), findsOneWidget);
      expect(find.text('Seg a sex, 8h às 17h'), findsOneWidget);
    });

    testWidgets('sem WhatsApp configurado não mostra botão nem link', (tester) async {
      await tester.pumpWidget(const MaterialApp(
        home: Scaffold(body: CartaoEmBreveCard(whatsapp: null, horario: null)),
      ));
      expect(find.text('Falar com a distribuidora'), findsNothing);
      await tester.tap(find.text('Cartão de crédito'));
      await tester.pumpAndSettle();
      expect(find.text('Chamar no WhatsApp'), findsNothing);
      expect(find.textContaining('compre direto na distribuidora'), findsWidgets);
    });
  });
}
