import 'package:flutter_test/flutter_test.dart';
import 'package:fluxo_vendas/core/dinheiro.dart';

/// Espelha apps/api/src/vendas/conferir-pedido.spec.ts.
void main() {
  group('arredondar (mesmos casos do servidor)', () {
    test('meio centavo sobe mesmo quando o binário fica abaixo', () {
      expect(arredondar(1.005), 1.01);
      expect(arredondar(10.075), 10.08);
      expect(arredondar(1234.565), 1234.57);
      expect(arredondar(345.6), 345.6);
    });

    test('valores comuns e zero', () {
      expect(arredondar(0), 0);
      expect(arredondar(86.4 * 4), 345.6);
      expect(arredondar(2.344), 2.34);
      expect(arredondar(2.346), 2.35);
    });

    test('meio centavo para cima também nos negativos (Math.round do JS)', () {
      expect(arredondar(-2.5), -2.5);
      expect(arredondar(-0.005), -0.0); // JS: Math.round(-0.5) = -0
    });
  });

  group('total do pedido', () {
    test('arredonda cada linha antes de somar (0,333 x 1,55 três vezes = 1,56)', () {
      final itens = List.filled(3, (precoUnit: 1.55, quantidade: 0.333));
      // cada linha: 0.51615 -> 0.52; soma 1.56 (somar sem arredondar daria 1.55)
      expect(totalLinha(1.55, 0.333), 0.52);
      expect(totalDoPedido(itens), 1.56);
    });

    test('linha do mesmo pedido do servidor: 86,4 x 100 e 31 x 100', () {
      expect(totalDoPedido([(precoUnit: 86.4, quantidade: 2), (precoUnit: 31, quantidade: 3)]), 265.8);
    });

    test('pedido vazio é zero', () {
      expect(totalDoPedido(const []), 0);
    });
  });
}
