import 'package:flutter_test/flutter_test.dart';
import 'package:fluxo_commerce_app/core/formatadores.dart';

/// O Dlinks manda `unidade = "CX"` para 100% do catálogo (194/194 produtos em
/// 22/09/2026), então a sigla sozinha não diz nada: quem separa venda avulsa de
/// caixa fechada é o múltiplo de venda (`qtd_por_embalagem`).
void main() {
  Map<String, dynamic> produto(String unidade, num porEmbalagem) =>
      {'unidade_venda': unidade, 'qtd_por_embalagem': porEmbalagem, 'preco': 24.0};

  group('venda avulsa (múltiplo 1) nunca é caixa', () {
    test('CX com múltiplo 1 é UNIDADE — ex.: RACAO WHISKAS SC10,1KG', () {
      expect(descricaoEmbalagem(produto('CX', 1)), 'UNIDADE');
    });

    test('CX sem múltiplo informado é UNIDADE', () {
      expect(descricaoEmbalagem({'unidade_venda': 'CX'}), 'UNIDADE');
    });

    test('sigla curta do múltiplo 1 é /un, não /cx', () {
      expect(siglaUnidade(produto('CX', 1)), 'un');
    });

    test('preço unitário do múltiplo 1 é o preço cheio', () {
      expect(precoUnitario(produto('CX', 1)), 24.0);
    });
  });

  group('caixa fechada de verdade continua igual', () {
    test('CX com múltiplo 8 vira CAIXA C/ 8 UN', () {
      expect(descricaoEmbalagem(produto('CX', 8)), 'CAIXA C/ 8 UN');
    });

    test('sigla curta do múltiplo > 1 continua /cx', () {
      expect(siglaUnidade(produto('CX', 8)), 'cx');
    });

    test('preço unitário divide pelo múltiplo', () {
      expect(precoUnitario(produto('CX', 8)), 3.0);
    });
  });

  group('nomeUnidade traduz a sigla crua sem opinar sobre o múltiplo', () {
    test('CX é CAIXA', () => expect(nomeUnidade('CX'), 'CAIXA'));
    test('FD é FARDO', () => expect(nomeUnidade('FD'), 'FARDO'));
    test('sigla desconhecida volta como veio', () => expect(nomeUnidade('DZ'), 'DZ'));
  });
}
