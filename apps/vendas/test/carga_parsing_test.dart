import 'package:flutter_test/flutter_test.dart';
import 'package:fluxo_vendas/data/modelos.dart';

import 'suporte/banco_teste.dart';

void main() {
  test('interpreta a carga real do servidor (sync.json)', () {
    final c = cargaDeFixture();
    expect(c.vendedor.nome, 'ANA PAULA (TESTE)');
    expect(c.vendedor.erpVendedorId, isNotNull);
    expect(c.clientes, hasLength(4));
    expect(c.tabelas.map((t) => t.tipoEntrega).toSet(), {TipoEntrega.entrega, TipoEntrega.retirada});
    expect(c.produtos, hasLength(8));
    expect(c.titulos, hasLength(2));
    expect(c.historico, isNotEmpty);
    expect(c.formas.any((f) => f.exigeCredito), isTrue);
    expect(c.formas.any((f) => !f.exigeCredito), isTrue);
  });

  test('cliente: crédito, endereço e campos opcionais', () {
    final c = cargaDeFixture().clientes.first;
    expect(c.limiteCredito, 30000);
    expect(c.creditoDisponivel, c.limiteCredito! - c.emAberto - c.pedidosEmTransito);
    expect(c.endereco?.cidade, 'IPOJUCA');
    expect(c.endereco?.resumo, contains('IPOJUCA/PE'));
    expect(c.temCadastroErp, isTrue);
    expect(c.bloqueado, isFalse);
  });

  test('números inteiros e decimais viram double; nulos continuam nulos', () {
    final c = Cliente.fromJson({
      'id': 'x', 'erpClienteId': null, 'documento': '1', 'razaoSocial': null, 'nomeFantasia': 'A',
      'telefone': null, 'status': 'pendente', 'limiteCredito': null, 'emAberto': 10, 'pedidosEmTransito': 2.5,
      'endereco': null,
    });
    expect(c.limiteCredito, isNull);
    expect(c.creditoDisponivel, isNull);
    expect(c.emAberto, 10.0);
    expect(c.temCadastroErp, isFalse);
    expect(c.bloqueado, isTrue);
    expect(c.endereco, isNull);
  });

  test('histórico traz itens; produto sem imagem fica nulo', () {
    final c = cargaDeFixture();
    expect(c.historico.first.itens, isNotEmpty);
    expect(c.historico.first.origem, anyOf('vendedor', 'app_cliente'));
    expect(c.produtos.any((p) => p.imagemUrl == null), isTrue);
  });

  test('resumo real', () {
    final r = ResumoVendedor.fromJson(fixtureJson('resumo'));
    expect(r.vendidoHoje, 4565.85);
    expect(r.pedidosHoje, 7);
    expect(r.pedidosRetidos, 1);
    expect(r.orcamentosAbertos, 3);
    expect(ResumoVendedor.fromJson(r.toJson()).vendidoMes, r.vendidoMes);
  });

  test('resumo de API antiga (sem meta nem pedidosMes) continua valendo', () {
    final r = ResumoVendedor.fromJson(fixtureJson('resumo'));
    expect(r.meta, isNull);
    expect(r.pedidosMes, 0);
    expect(r.pedidosFaturadosMes, 0);
  });

  test('resumo com meta do mês: lê, guarda e devolve igual', () {
    final r = ResumoVendedor.fromJson(fixtureJson('resumo_meta'));
    expect(r.pedidosMes, 20);
    expect(r.pedidosFaturadosMes, 3);
    expect(r.meta!.temMeta, isTrue);
    expect(r.meta!.metaMes, 10500);
    expect(r.meta!.atingidoPct, 74.4);
    expect(r.meta!.faltam, 2682.96);
    expect(r.meta!.vendidoMesAnterior, 10000);
    expect(r.meta!.origemBase, 'erp');
    final volta = ResumoVendedor.fromJson(r.toJson());
    expect(volta.meta!.atingidoPct, 74.4);
    expect(volta.pedidosMes, 20);
  });

  test('sem meta no mês: metaMes, atingidoPct e faltam nulos', () {
    final r = ResumoVendedor.fromJson({
      ...fixtureJson('resumo_meta'),
      'meta': {'percentual': 5, 'vendidoMesAnterior': 0, 'origemBase': 'erp', 'metaMes': null, 'atingidoPct': null, 'faltam': null},
    });
    expect(r.meta!.temMeta, isFalse);
    expect(r.meta!.atingidoPct, isNull);
  });
}
