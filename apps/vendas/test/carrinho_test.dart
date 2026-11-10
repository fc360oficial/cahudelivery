import 'package:flutter_test/flutter_test.dart';
import 'package:fluxo_vendas/data/banco_local.dart';
import 'package:fluxo_vendas/data/meta_repository.dart';
import 'package:fluxo_vendas/data/modelos.dart';
import 'package:fluxo_vendas/data/rascunho.dart';
import 'package:fluxo_vendas/data/repositorios.dart';
import 'package:fluxo_vendas/services/carrinho_service.dart';

import 'suporte/banco_teste.dart';
import 'suporte/pedido_teste.dart';

void main() {
  late BancoLocal banco;
  late ClientesRepository clientes;
  late ProdutosRepository produtos;
  late TabelasRepository tabelas;

  final criados = <CarrinhoService>[];
  CarrinhoService novo() {
    final c = CarrinhoService(
      produtos: produtos,
      tabelas: tabelas,
      clientes: clientes,
      rascunhos: RascunhoRepository(banco, MetaRepository(banco)),
      agora: () => DateTime.utc(2026, 11, 10, 12),
    );
    criados.add(c);
    return c;
  }

  setUp(() async {
    banco = await bancoEmMemoria();
    await semear(banco);
    clientes = ClientesRepository(banco);
    produtos = ProdutosRepository(banco);
    tabelas = TabelasRepository(banco);
  });
  tearDown(() async {
    for (final c in criados) {
      await c.aguardarGravacao();
    }
    criados.clear();
    await banco.fechar();
  });

  Future<CarrinhoService> comCliente() async {
    final c = novo();
    c.iniciar((await clientes.porId(Ids.clienteOk))!);
    return c;
  }

  Future<void> add(CarrinhoService c, String id, double qtd) async {
    final p = await produtos.porId(id, tabelaId: c.tabela!.tabela.id);
    c.definirQuantidade(p!, qtd);
  }

  Future<FormaPagamento> forma(String id) async => (await tabelas.formas()).firstWhere((f) => f.id == id);

  test('total espelha o servidor: linha arredondada (10,075 x 3 = 30,23) e soma das linhas', () async {
    final c = await comCliente();
    await c.escolherTabela((await tabelas.porId(Ids.tabEntrega))!);
    await add(c, Ids.p1, 3); // 30.225 -> 30.23 (meio centavo sobe)
    await add(c, Ids.p2, 2); // 11
    expect(c.itens.first.total, 30.23);
    expect(c.total, 41.23);
    expect(c.qtdItens, 2);
  });

  test('preço sempre da tabela do espelho; produto sem preço na tabela não entra', () async {
    final c = await comCliente();
    await c.escolherTabela((await tabelas.porId(Ids.tabSoPix))!);
    await add(c, Ids.p3, 2); // sem preço nesta tabela
    expect(c.vazio, isTrue);
    await add(c, Ids.p1, 1);
    expect(c.itens.single.precoUnit, 11);
  });

  test('quantidade <= 0 remove a linha', () async {
    final c = await comCliente();
    await c.escolherTabela((await tabelas.porId(Ids.tabEntrega))!);
    await add(c, Ids.p1, 1);
    c.alterarQuantidade(Ids.p1, 0);
    expect(c.vazio, isTrue);
  });

  test('forma automática quando a tabela aceita uma só; pergunta quando aceita várias', () async {
    final c = await comCliente();
    await c.escolherTabela((await tabelas.porId(Ids.tabEntrega))!);
    expect(c.formaAutomatica, isTrue);
    expect(c.precisaEscolherForma, isFalse);
    expect(c.forma!.id, Ids.boleto);
    expect(c.prontoParaCatalogo, isTrue);

    await c.escolherTabela((await tabelas.porId(Ids.tabRetirada))!);
    expect(c.precisaEscolherForma, isTrue);
    expect(c.formaAutomatica, isFalse);
    expect(c.forma!.id, Ids.boleto); // boleto também é aceito na retirada: continua escolhida
  });

  test('forma só pode ser uma das aceitas pela tabela', () async {
    final c = await comCliente();
    await c.escolherTabela((await tabelas.porId(Ids.tabEntrega))!);
    c.escolherForma(await forma(Ids.pix)); // entrega só aceita boleto
    expect(c.forma!.id, Ids.boleto);
    await c.escolherTabela((await tabelas.porId(Ids.tabRetirada))!);
    c.escolherForma(await forma(Ids.pix));
    expect(c.forma!.id, Ids.pix);
  });

  test('tipo de entrega vem da tabela', () async {
    final c = await comCliente();
    await c.escolherTabela((await tabelas.porId(Ids.tabRetirada))!);
    expect(c.tipoEntrega!.name, 'retirada');
  });

  group('troca de tabela com itens', () {
    test('recalcula preços; a prévia mostra total antigo e novo e os itens sem preço', () async {
      final c = await comCliente();
      await c.escolherTabela((await tabelas.porId(Ids.tabEntrega))!);
      await add(c, Ids.p1, 2); // 20.15
      await add(c, Ids.p3, 10); // 20
      expect(c.total, 40.15);

      final nova = (await tabelas.porId(Ids.tabSoPix))!;
      final prev = await c.previsaoTroca(nova);
      expect(prev.totalAtual, 40.15);
      expect(prev.totalNovo, 22); // só p1 a 11 x 2
      expect(prev.removidos.map((i) => i.produto.id), [Ids.p3]);
      expect(prev.formaPerdida, isTrue); // boleto não é aceito na tabela só-PIX
      expect(c.total, 40.15); // a prévia NÃO altera o carrinho

      await c.escolherTabela(nova);
      expect(c.total, 22);
      expect(c.itens.map((i) => i.produto.id), [Ids.p1]);
      expect(c.itens.single.precoUnit, 11);
      expect(c.forma!.id, Ids.pix); // a nova tabela tem uma forma só: automática
    });

    test('forma que a tabela nova não aceita e com mais de uma opção fica vazia (pergunta de novo)', () async {
      final c = await comCliente();
      await c.escolherTabela((await tabelas.porId(Ids.tabRetirada))!);
      c.escolherForma(await forma(Ids.cartao));
      // tabela com PIX e boleto, sem cartão
      await banco.db.insert('tabelas', {'id': 'tab-x', 'nome': 'X', 'erp_tabela_id': '9', 'tipo_entrega': 'entrega'});
      await banco.db.insert('tabela_formas', {'tabela_id': 'tab-x', 'forma_id': Ids.pix});
      await banco.db.insert('tabela_formas', {'tabela_id': 'tab-x', 'forma_id': Ids.boleto});
      final nova = (await tabelas.porId('tab-x'))!;
      expect((await c.previsaoTroca(nova)).formaPerdida, isTrue);
      await c.escolherTabela(nova);
      expect(c.forma, isNull);
      expect(c.precisaEscolherForma, isTrue);
      expect(c.prontoParaCatalogo, isFalse);
    });
  });

  group('crédito e estoque', () {
    test('crédito disponível = limite - em aberto - em trânsito, só com forma que confere limite', () async {
      final c = await comCliente();
      await c.escolherTabela((await tabelas.porId(Ids.tabRetirada))!);
      c.escolherForma(await forma(Ids.boleto));
      expect(c.creditoDisponivel, 700);
      c.escolherForma(await forma(Ids.pix));
      expect(c.creditoDisponivel, isNull);
      expect(c.passaDoLimite, isFalse);
    });

    test('aviso só quando o total ultrapassa o disponível (igual não avisa)', () async {
      final c = await comCliente();
      await c.escolherTabela((await tabelas.porId(Ids.tabRetirada))!);
      c.escolherForma(await forma(Ids.boleto));
      await add(c, Ids.p2, 140); // 5 x 140 = 700: exatamente o disponível
      expect(c.total, 700);
      expect(c.passaDoLimite, isFalse);
      await add(c, Ids.p2, 141); // 705
      expect(c.passaDoLimite, isTrue);
      c.escolherForma(await forma(Ids.pix)); // PIX não confere limite
      expect(c.passaDoLimite, isFalse);
    });

    test('acima do estoque é permitido e conta como aviso', () async {
      final c = await comCliente();
      await c.escolherTabela((await tabelas.porId(Ids.tabEntrega))!);
      await add(c, Ids.p2, 4); // estoque 3
      expect(c.itens.single.acimaDoEstoque, isTrue);
      expect(c.itensAcimaDoEstoque, 1);
      await add(c, Ids.p2, 3);
      expect(c.itensAcimaDoEstoque, 0);
    });
  });

  group('rascunho no banco', () {
    test('ida e volta: matar o app e reabrir devolve cliente, tabela, forma, itens e observação', () async {
      final c = await comCliente();
      await c.escolherTabela((await tabelas.porId(Ids.tabRetirada))!);
      c.escolherForma(await forma(Ids.pix));
      await add(c, Ids.p1, 4);
      await add(c, Ids.p2, 1.5);
      c.definirObservacoes('Entregar de manhã');
      await c.aguardarGravacao();

      final outro = novo(); // "app reaberto"
      expect(outro.temRascunho, isFalse);
      await outro.restaurar();
      expect(outro.cliente!.id, Ids.clienteOk);
      expect(outro.tabela!.tabela.id, Ids.tabRetirada);
      expect(outro.forma!.id, Ids.pix);
      expect(outro.itens.map((i) => (i.produto.id, i.quantidade)), [(Ids.p1, 4.0), (Ids.p2, 1.5)]);
      expect(outro.total, c.total);
      expect(outro.observacoes, 'Entregar de manhã');
      expect(outro.aviso, isNull);
    });

    test('restaurar relê o preço do espelho e avisa do item que perdeu o preço', () async {
      final c = await comCliente();
      await c.escolherTabela((await tabelas.porId(Ids.tabEntrega))!);
      await add(c, Ids.p1, 1);
      await add(c, Ids.p2, 1);
      await c.aguardarGravacao();
      await banco.db
          .update('precos', {'preco': 12.0}, where: 'produto_id = ? AND tabela_id = ?', whereArgs: [Ids.p1, Ids.tabEntrega]);
      await banco.db.delete('precos', where: 'produto_id = ? AND tabela_id = ?', whereArgs: [Ids.p2, Ids.tabEntrega]);

      final outro = novo();
      await outro.restaurar();
      expect(outro.itens.single.precoUnit, 12);
      expect(outro.aviso, contains('1 item saiu'));
    });

    test('limpar apaga o rascunho do banco; cliente que sumiu descarta o rascunho', () async {
      final c = await comCliente();
      await c.limpar();
      final outro = novo();
      await outro.restaurar();
      expect(outro.temRascunho, isFalse);

      final d = await comCliente();
      await d.aguardarGravacao();
      await banco.db.delete('clientes');
      final e = novo();
      await e.restaurar();
      expect(e.temRascunho, isFalse);
    });

    test('um rascunho por vez: iniciar substitui o anterior', () async {
      final c = await comCliente();
      await c.escolherTabela((await tabelas.porId(Ids.tabEntrega))!);
      await add(c, Ids.p1, 1);
      c.iniciar((await clientes.porId(Ids.clienteBloqueado))!);
      expect(c.vazio, isTrue);
      expect(c.tabela, isNull);
      await c.aguardarGravacao();
      final outro = novo();
      await outro.restaurar();
      expect(outro.cliente!.id, Ids.clienteBloqueado);
      expect(outro.itens, isEmpty);
    });
  });
}
