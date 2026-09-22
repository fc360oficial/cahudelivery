import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:fluxo_commerce_app/features/auth/login_screen.dart';
import 'package:fluxo_commerce_app/features/auth/cadastro_screen.dart';

void main() {
  testWidgets('tela de login renderiza campos e botão', (tester) async {
    await tester.pumpWidget(const MaterialApp(home: LoginScreen()));
    expect(find.text('CNPJ ou CPF'), findsOneWidget);
    expect(find.text('Senha'), findsOneWidget);
    expect(find.text('Entrar'), findsOneWidget);
    // Olho da senha: começa oculta, toque mostra.
    expect(find.byIcon(Icons.visibility_outlined), findsOneWidget);
    await tester.tap(find.byIcon(Icons.visibility_outlined));
    await tester.pump();
    expect(find.byIcon(Icons.visibility_off_outlined), findsOneWidget);
  });

  testWidgets('IE aparece no modo CNPJ e some no modo CPF', (tester) async {
    await tester.pumpWidget(const MaterialApp(home: CadastroScreen()));

    // CNPJ é o modo inicial.
    expect(find.text('Inscrição Estadual'), findsOneWidget);
    expect(find.text('Isento de Inscrição Estadual'), findsOneWidget);

    await tester.tap(find.text('Pessoa física (CPF)'));
    await tester.pumpAndSettle();

    expect(find.text('Inscrição Estadual'), findsNothing);
    expect(find.text('Isento de Inscrição Estadual'), findsNothing);
  });
}
