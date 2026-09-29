import 'package:flutter_test/flutter_test.dart';

import 'package:fluxo_commerce_app/widgets/quantidade_editavel.dart';

void main() {
  group('QuantidadeEditavel.ajustar', () {
    test('valor normal passa direto', () {
      expect(QuantidadeEditavel.ajustar(digitado: 37, atual: 1, minimo: 1), (37.0, null));
    });
    test('acima do estoque trava no estoque e avisa', () {
      final (v, aviso) = QuantidadeEditavel.ajustar(digitado: 500, atual: 1, minimo: 1, maximo: 200);
      expect(v, 200);
      expect(aviso, contains('200'));
    });
    test('abaixo do mínimo sobe pro mínimo e avisa', () {
      final (v, aviso) = QuantidadeEditavel.ajustar(digitado: 3, atual: 12, minimo: 12);
      expect(v, 12);
      expect(aviso, contains('12'));
    });
    test('zero remove quando permitido', () {
      expect(QuantidadeEditavel.ajustar(digitado: 0, atual: 5, minimo: 1, permitirRemover: true),
          (0.0, null));
    });
    test('zero sem permissão de remover volta pro mínimo', () {
      final (v, _) = QuantidadeEditavel.ajustar(digitado: 0, atual: 5, minimo: 1);
      expect(v, 1);
    });
    test('inválido mantém o atual', () {
      expect(QuantidadeEditavel.ajustar(digitado: double.nan, atual: 5, minimo: 1), (5.0, null));
    });
  });
}
