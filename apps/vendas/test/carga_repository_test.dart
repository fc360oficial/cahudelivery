import 'package:flutter_test/flutter_test.dart';
import 'package:fluxo_vendas/data/banco_local.dart';
import 'package:fluxo_vendas/data/carga_repository.dart';
import 'package:fluxo_vendas/data/meta_repository.dart';
import 'package:fluxo_vendas/data/modelos.dart';
import 'package:sqflite/sqflite.dart' show Sqflite;

import 'suporte/banco_teste.dart';

Future<int> _contar(BancoLocal b, String t) async =>
    Sqflite.firstIntValue(await b.db.rawQuery('SELECT COUNT(*) FROM $t')) ?? 0;

Future<void> _pedidoLocal(BancoLocal b, String id) => b.db.insert('pedidos_locais', {
      'id': id, 'vendedor_id': 'v1', 'cliente_id': 'c1', 'estado': 'na_fila', 'corpo_json': '{}',
      'criado_em': '2026-11-10T10:00:00Z', 'atualizado_em': '2026-11-10T10:00:00Z',
    });

void main() {
  late BancoLocal banco;
  late CargaRepository repo;

  setUp(() async {
    banco = await bancoEmMemoria();
    repo = CargaRepository(banco);
  });
  tearDown(() => banco.fechar());

  test('grava a carga inteira e o meta', () async {
    final c = cargaDeFixture();
    await repo.substituir(c, agora: DateTime.utc(2026, 11, 10, 12), resumo: ResumoVendedor.fromJson(fixtureJson('resumo')));
    expect(await _contar(banco, 'clientes'), c.clientes.length);
    expect(await _contar(banco, 'produtos'), c.produtos.length);
    expect(await _contar(banco, 'precos'), c.precos.length);
    expect(await _contar(banco, 'titulos'), c.titulos.length);
    expect(await _contar(banco, 'historico'), c.historico.length);
    expect(await _contar(banco, 'tabela_formas'), c.tabelaFormas.length);
    final meta = MetaRepository(banco);
    expect((await meta.vendedor())!.nome, 'ANA PAULA (TESTE)');
    expect(await meta.ultimaSincronizacao(), DateTime.utc(2026, 11, 10, 12));
    expect((await meta.resumo())!.vendidoMes, 13382.57);
  });

  test('substitui o espelho (não acumula) e preserva pedidos/orçamentos locais', () async {
    final c = cargaDeFixture();
    await repo.substituir(c, agora: DateTime.utc(2026, 11, 10, 12));
    await _pedidoLocal(banco, 'p-local-1');
    await banco.db.insert('orcamentos_locais', {
      'id': 'o-local-1', 'vendedor_id': 'v1', 'cliente_id': 'c1', 'estado': 'local', 'corpo_json': '{}',
      'criado_em': '2026-11-10T10:00:00Z', 'atualizado_em': '2026-11-10T10:00:00Z',
    });

    // Segunda carga com MENOS clientes e produtos.
    final menor = CargaVendedor(
      geradoEm: c.geradoEm, vendedor: c.vendedor, clientes: c.clientes.take(1).toList(), titulos: const [],
      tabelas: c.tabelas.take(1).toList(), formas: c.formas, tabelaFormas: const [], categorias: const [],
      produtos: c.produtos.take(2).toList(), precos: const [], historico: const [],
    );
    await repo.substituir(menor, agora: DateTime.utc(2026, 11, 10, 13));

    expect(await _contar(banco, 'clientes'), 1);
    expect(await _contar(banco, 'produtos'), 2);
    expect(await _contar(banco, 'precos'), 0);
    expect(await _contar(banco, 'titulos'), 0);
    expect(await _contar(banco, 'pedidos_locais'), 1);
    expect(await _contar(banco, 'orcamentos_locais'), 1);
  });

  test('é atômico: carga que falha no meio deixa o espelho antigo intacto', () async {
    final c = cargaDeFixture();
    await repo.substituir(c, agora: DateTime.utc(2026, 11, 10, 12));
    await _pedidoLocal(banco, 'p-local-1');

    // Duas tabelas com o mesmo id violam a PRIMARY KEY no meio da gravação.
    final quebrada = CargaVendedor(
      geradoEm: c.geradoEm, vendedor: c.vendedor, clientes: const [], titulos: const [],
      tabelas: [c.tabelas.first, c.tabelas.first], formas: const [], tabelaFormas: const [], categorias: const [],
      produtos: const [], precos: const [], historico: const [],
    );
    await expectLater(repo.substituir(quebrada, agora: DateTime.utc(2026, 11, 10, 13)), throwsA(anything));

    expect(await _contar(banco, 'clientes'), c.clientes.length, reason: 'delete foi desfeito');
    expect(await _contar(banco, 'produtos'), c.produtos.length);
    expect(await _contar(banco, 'pedidos_locais'), 1);
    expect(await MetaRepository(banco).ultimaSincronizacao(), DateTime.utc(2026, 11, 10, 12));
  });

  test('limparEspelho (logout) apaga espelho e meta, mas mantém a fila local', () async {
    await repo.substituir(cargaDeFixture(), agora: DateTime.utc(2026, 11, 10, 12));
    await _pedidoLocal(banco, 'p-local-1');
    await repo.limparEspelho();
    for (final t in [...BancoLocal.tabelasEspelho, 'meta']) {
      expect(await _contar(banco, t), 0, reason: t);
    }
    expect(await _contar(banco, 'pedidos_locais'), 1);
  });
}
