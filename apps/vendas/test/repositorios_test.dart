import 'package:flutter_test/flutter_test.dart';
import 'package:fluxo_vendas/data/banco_local.dart';
import 'package:fluxo_vendas/data/carga_repository.dart';
import 'package:fluxo_vendas/data/modelos.dart';
import 'package:fluxo_vendas/data/repositorios.dart';

import 'suporte/banco_teste.dart';

void main() {
  late BancoLocal banco;
  late CargaVendedor carga;

  setUp(() async {
    banco = await bancoEmMemoria();
    carga = cargaDeFixture();
    await CargaRepository(banco).substituir(carga, agora: DateTime.utc(2026, 11, 10, 12));
  });
  tearDown(() => banco.fechar());

  group('clientes', () {
    test('lista toda a carteira em ordem alfabética', () async {
      final l = await ClientesRepository(banco).buscar();
      expect(l, hasLength(carga.clientes.length));
      final nomes = l.map((c) => c.nomeFantasia.toLowerCase()).toList();
      expect(nomes, [...nomes]..sort());
    });

    test('busca por nome sem acento e sem maiúsculas', () async {
      final r = ClientesRepository(banco);
      final base = carga.clientes.first;
      final trecho = base.nomeFantasia.substring(10, 18).toLowerCase();
      final achados = await r.buscar(termo: trecho);
      expect(achados.map((c) => c.id), contains(base.id));
      expect(await r.buscar(termo: 'zzzz-inexistente'), isEmpty);
    });

    test('busca por código do ERP e por documento (com pontuação)', () async {
      final r = ClientesRepository(banco);
      final base = carga.clientes.first;
      expect((await r.buscar(termo: base.erpClienteId!)).map((c) => c.id), contains(base.id));
      final cnpjFormatado = '${base.documento.substring(0, 2)}.${base.documento.substring(2, 5)}.${base.documento.substring(5, 8)}';
      expect((await r.buscar(termo: cnpjFormatado)).map((c) => c.id), contains(base.id));
    });

    test('porId devolve endereço, crédito e última compra do histórico', () async {
      final h = carga.historico.first;
      final c = (await ClientesRepository(banco).porId(h.clienteId))!;
      expect(c.endereco, isNotNull);
      expect(c.ultimaCompra, isNotNull);
      expect(await ClientesRepository(banco).porId('nao-existe'), isNull);
    });

    test('termo com % e _ não vira curinga', () async {
      expect(await ClientesRepository(banco).buscar(termo: '%'), isEmpty);
      expect(await ClientesRepository(banco).buscar(termo: '_'), isEmpty);
    });
  });

  group('produtos e preço por tabela', () {
    test('traz o preço da tabela pedida', () async {
      final preco = carga.precos.first;
      final r = ProdutosRepository(banco);
      final p = (await r.porId(preco.produtoId, tabelaId: preco.tabelaId))!;
      expect(p.preco, preco.preco);
      expect(await r.preco(preco.produtoId, preco.tabelaId), preco.preco);
    });

    test('produto sem preço na tabela aparece com preco nulo e some com somenteComPreco', () async {
      final r = ProdutosRepository(banco);
      final tabela = carga.tabelas.first.id;
      final comPreco = carga.precos.where((p) => p.tabelaId == tabela).map((p) => p.produtoId).toSet();
      final semPreco = carga.produtos.where((p) => !comPreco.contains(p.id)).toList();
      expect(semPreco, isNotEmpty, reason: 'a fixture precisa ter produto sem preço nessa tabela');

      final todos = await r.buscar(tabelaId: tabela);
      expect(todos, hasLength(carga.produtos.length));
      expect(todos.where((p) => p.semPreco).map((p) => p.produto.id).toSet(), semPreco.map((p) => p.id).toSet());

      final vendaveis = await r.buscar(tabelaId: tabela, somenteComPreco: true);
      expect(vendaveis.map((p) => p.produto.id).toSet(), comPreco.intersection(carga.produtos.map((p) => p.id).toSet()));
      expect(vendaveis.every((p) => p.preco != null), isTrue);
    });

    test('o mesmo produto tem preços diferentes em tabelas diferentes', () async {
      final r = ProdutosRepository(banco);
      final porProduto = <String, List<Preco>>{};
      for (final p in carga.precos) {
        porProduto.putIfAbsent(p.produtoId, () => []).add(p);
      }
      final dif = porProduto.values.firstWhere((l) => l.length > 1 && l[0].preco != l[1].preco);
      expect(await r.preco(dif[0].produtoId, dif[0].tabelaId), dif[0].preco);
      expect(await r.preco(dif[0].produtoId, dif[1].tabelaId), dif[1].preco);
    });

    test('busca por nome, SKU/EAN e filtro de categoria', () async {
      final r = ProdutosRepository(banco);
      final p = carga.produtos.first;
      expect((await r.buscar(termo: p.nome.substring(0, 6))).map((x) => x.produto.id), contains(p.id));
      expect((await r.buscar(termo: p.sku)).map((x) => x.produto.id), contains(p.id));
      final cat = p.categoriaId!;
      final daCat = await r.buscar(categoriaId: cat);
      expect(daCat.every((x) => x.produto.categoriaId == cat), isTrue);
      expect(daCat, isNotEmpty);
    });

    test('estoque, somenteComEstoque, paginação e categorias', () async {
      final r = ProdutosRepository(banco);
      final comEstoque = await r.buscar(somenteComEstoque: true);
      expect(comEstoque.every((x) => x.produto.estoque > 0), isTrue);
      expect(comEstoque, isNotEmpty);
      final p1 = await r.buscar(limite: 3);
      final p2 = await r.buscar(limite: 3, deslocamento: 3);
      expect(p1, hasLength(3));
      expect(p1.map((x) => x.produto.id).toSet().intersection(p2.map((x) => x.produto.id).toSet()), isEmpty);
      expect((await r.categorias()).map((c) => c.id), containsAll(carga.categorias.map((c) => c.id)));
    });

    test('precosDaTabela devolve só os pedidos', () async {
      final r = ProdutosRepository(banco);
      final tabela = carga.tabelas.first.id;
      final ids = carga.precos.where((p) => p.tabelaId == tabela).take(2).map((p) => p.produtoId).toList();
      final m = await r.precosDaTabela(tabela, produtoIds: [...ids, 'inexistente']);
      expect(m.keys.toSet(), ids.toSet());
      expect(await r.precosDaTabela(tabela, produtoIds: const []), isEmpty);
    });
  });

  group('tabelas e formas', () {
    test('cada tabela vem com suas formas e o tipo de entrega', () async {
      final l = await TabelasRepository(banco).listar();
      expect(l, hasLength(carga.tabelas.length));
      final retirada = l.firstWhere((t) => t.tabela.tipoEntrega == TipoEntrega.retirada);
      expect(retirada.formas.map((f) => f.descricao), containsAll(['PIX', 'Boleto', 'CARTAO']));
      final entrega = l.firstWhere((t) => t.tabela.tipoEntrega == TipoEntrega.entrega);
      expect(entrega.formas.map((f) => f.descricao), ['Boleto']);
      expect(entrega.formas.single.exigeCredito, isTrue);
    });

    test('porId, formasDaTabela e todas as formas', () async {
      final r = TabelasRepository(banco);
      final t = carga.tabelas.first;
      expect((await r.porId(t.id))!.tabela.nome, t.nome);
      expect(await r.porId('x'), isNull);
      expect(await r.formasDaTabela(t.id), isNotEmpty);
      expect(await r.formasDaTabela('x'), isEmpty);
      expect(await r.formas(), hasLength(carga.formas.length));
    });
  });

  group('financeiro e histórico', () {
    test('títulos do cliente por vencimento', () async {
      final t = await TitulosRepository(banco).porCliente(carga.clientes.first.id);
      expect(t.map((x) => x.numero), ['TIT-1001', 'TIT-1002']);
      expect(t.first.vencimento, DateTime(2026, 11, 20));
      expect(t.first.vencido(DateTime(2026, 11, 21)), isTrue);
      expect(t.first.vencido(DateTime(2026, 11, 20, 23)), isFalse);
      expect(await TitulosRepository(banco).porCliente('x'), isEmpty);
    });

    test('histórico do cliente, mais novo primeiro, com itens', () async {
      final cid = carga.historico.first.clienteId;
      final h = await HistoricoRepository(banco).porCliente(cid);
      expect(h, isNotEmpty);
      for (var i = 1; i < h.length; i++) {
        expect(h[i - 1].criadoEm.isBefore(h[i].criadoEm), isFalse);
      }
      expect(h.first.itens, isNotEmpty);
      expect(await HistoricoRepository(banco).porCliente(cid, limite: 1), hasLength(1));
    });
  });
}
