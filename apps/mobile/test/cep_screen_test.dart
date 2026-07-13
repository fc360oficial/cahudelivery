import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:fluxo_commerce_app/features/onboarding/cep_screen.dart';

void main() {
  testWidgets('tela de CEP renderiza campo e ações', (tester) async {
    await tester.pumpWidget(const MaterialApp(home: CepScreen()));
    expect(find.text('Qual o CEP de entrega?'), findsOneWidget);
    expect(find.byType(TextField), findsOneWidget);
    expect(find.text('Confirmar'), findsOneWidget);
    expect(find.text('Pular por agora'), findsOneWidget);
  });
}
