import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:fluxo_vendas/core/api_client.dart';
import 'package:fluxo_vendas/core/api_exception.dart';
import 'package:fluxo_vendas/core/token_store.dart';
import 'package:fluxo_vendas/data/banco_local.dart';
import 'package:fluxo_vendas/data/locais_repository.dart';
import 'package:fluxo_vendas/data/meta_repository.dart';
import 'package:fluxo_vendas/data/pedido_local.dart';
import 'package:fluxo_vendas/data/rascunho.dart';
import 'package:fluxo_vendas/data/repositorios.dart';
import 'package:fluxo_vendas/data/situacao_pedido.dart';
import 'package:fluxo_vendas/features/mais/mais_page.dart';
import 'package:fluxo_vendas/services/carrinho_service.dart';
import 'package:fluxo_vendas/services/fila_envio_service.dart';
import 'package:fluxo_vendas/services/pedidos_service.dart';
import 'package:http/http.dart' as http;

import 'suporte/banco_teste.dart';
import 'suporte/http_falso.dart';
import 'suporte/pedido_teste.dart';

NovoPedido pedido({String? orcamentoId, double total = 30.23}) => NovoPedido(
      clienteId: Ids.clienteOk,
      tabelaId: Ids.tabEntrega,
      formaId: Ids.boleto,
      total: total,
      orcamentoId: orcamentoId,
      itens: const [ItemEnvio(produtoId: Ids.p1, quantidade: 3, precoUnit: 10.075)],
    );

NovoOrcamento orcamento({double total = 11}) => NovoOrcamento(
      clienteId: Ids.clienteOk,
      tabelaId: Ids.tabEntrega,
      formaId: Ids.boleto,
      total: total,
      itens: const [ItemEnvio(produtoId: Ids.p2, quantidade: 2, precoUnit: 5.5)],
    );

void main() {
  late BancoLocal banco;
  late PedidosLocaisRepository pedidos;
  late OrcamentosLocaisRepository orcamentos;
  late ServidorFalso srv;
  late FilaEnvioService fila;
  late PedidosService servico;
  late int tick;
  late Future<(int, Object?)> Function(Chamada c) servidor;

  Map<String, dynamic> corpoDe(Chamada c) => jsonDecode(c.corpo) as Map<String, dynamic>;
  Iterable<Chamada> posts() => srv.chamadas.where((c) => c.metodo == 'POST' && c.caminho == '/vendas/pedidos');

  /// Pedido aceito (RECEBIDO).
  Future<(int, Object?)> aceita(Chamada c) async => (
        200,
        {'id': 'srv-${corpoDe(c)['idDispositivo']}', 'numero': 101, 'status': 'RECEBIDO', 'total': 30.23, 'divergencias': const []}
      );

  /// Pedido retido por preço (10,075 -> 11) e estoque.
  Future<(int, Object?)> retem(Chamada c) async => (
        200,
        {
          'id': 'srv-${corpoDe(c)['idDispositivo']}',
          'numero': 102,
          'status': 'AGUARDANDO_VENDEDOR',
          'total': 30.23,
          'divergencias': [
            {'tipo': 'preco', 'produtoId': Ids.p1, 'nome': 'Arroz 5kg', 'enviado': 10.075, 'atual': 11},
          ],
        }
      );

  setUp(() async {
    banco = await bancoEmMemoria();
    await semear(banco);
    final meta = MetaRepository(banco);
    pedidos = PedidosLocaisRepository(banco, meta);
    orcamentos = OrcamentosLocaisRepository(banco, meta);
    servidor = aceita;
    srv = ServidorFalso((c) => servidor(c));
    tick = 0;
    var n = 0;
    final api = ApiClient(tokens: MemoriaTokenStore(const Tokens('AT', 'RT')), client: srv.cliente, baseUrl: 'http://x/v1', tenant: 'cahu');
    DateTime relogio() => DateTime.utc(2026, 11, 10, 12).add(Duration(seconds: tick++));
    fila = FilaEnvioService(
      api: api,
      pedidos: pedidos,
      orcamentos: orcamentos,
      agora: relogio,
      novoId: () => '00000000-0000-4000-8000-${(++n).toString().padLeft(12, '0')}',
    );
    servico = PedidosService(api: api, pedidos: pedidos, orcamentos: orcamentos, fila: fila, agora: relogio);
  });
  tearDown(() async {
    servico.dispose();
    fila.dispose();
    await banco.fechar();
  });

  Map<String, Object?> itemServidor({
    required String id,
    String? idDispositivo,
    String status = 'RECEBIDO',
    double total = 30.23,
    int numero = 200,
    String criadoEm = '2026-11-10T12:00:00.000Z',
    List<Object?> divergencias = const [],
  }) =>
      {
        'id': id,
        'numero': numero,
        'idDispositivo': idDispositivo,
        'clienteId': Ids.clienteOk,
        'status': status,
        'total': total,
        'criadoEm': criadoEm,
        'divergencias': divergencias,
      };

  group('reconciliação de pedidos', () {
    test('atualiza o status do pedido do aparelho sem duplicar e traz pedido de outro aparelho', () async {
      final r = await fila.enviarPedido(pedido());
      expect((await pedidos.listar()).length, 1);

      servidor = (c) async {
        if (c.caminho == '/vendas/pedidos') {
          return (
            200,
            [
              itemServidor(id: 'srv-${r.id}', idDispositivo: r.id, status: 'FATURADO', numero: 101),
              itemServidor(id: 'srv-outro', idDispositivo: '99999999-0000-4000-8000-000000000001', status: 'RECEBIDO', numero: 150, total: 80),
              itemServidor(id: 'srv-semid', status: 'EM_FATURAMENTO', numero: 151, total: 12),
            ]
          );
        }
        return (200, <Object?>[]);
      };
      expect(await servico.reconciliar(), isTrue);

      final todos = await pedidos.listar();
      expect(todos.length, 3, reason: 'o pedido local não pode aparecer duas vezes');
      final local = (await pedidos.porId(r.id))!;
      expect(local.statusServidor, 'FATURADO');
      expect(situacaoDe(local), SituacaoPedido.faturado);
      expect(local.corpo['idDispositivo'], r.id, reason: 'o corpo original continua com o idDispositivo');

      final outro = (await pedidos.porId('99999999-0000-4000-8000-000000000001'))!;
      expect(outro.doServidor, isTrue);
      expect(outro.servidorNumero, 150);
      expect(outro.total, 80);
      expect(situacaoDe(outro), SituacaoPedido.aguardandoErp);
      expect(situacaoDe((await pedidos.porId('srv-srv-semid'))!), SituacaoPedido.noErp);

      // de novo: idempotente
      expect(await servico.reconciliar(), isTrue);
      expect((await pedidos.listar()).length, 3);
    });

    test('retido que o servidor cancelou (outro aparelho) vira cancelado; envio perdido vira enviado', () async {
      servidor = retem;
      final retido = await fila.enviarPedido(pedido());
      expect(retido.desfecho, DesfechoEnvio.retido);
      servidor = (c) async => throw http.ClientException('sem rede');
      final perdido = await fila.enviarPedido(pedido(total: 40));
      expect((await pedidos.porId(perdido.id))!.estado, EstadoPedido.aguardandoEnvio);

      servidor = (c) async => c.caminho == '/vendas/pedidos'
          ? (
              200,
              [
                itemServidor(id: 'srv-${retido.id}', idDispositivo: retido.id, status: 'CANCELADO', numero: 102),
                itemServidor(id: 'srv-${perdido.id}', idDispositivo: perdido.id, status: 'RECEBIDO', numero: 103),
              ]
            )
          : (200, <Object?>[]);
      await servico.reconciliar();
      expect((await pedidos.porId(retido.id))!.estado, EstadoPedido.cancelado);
      final p = (await pedidos.porId(perdido.id))!;
      expect(p.estado, EstadoPedido.enviado);
      expect(p.servidorNumero, 103);
      expect(fila.retidos, 0);
    });

    test('sem rede: devolve falso, nada muda e nada quebra', () async {
      await fila.enviarPedido(pedido());
      servidor = (c) async => throw http.ClientException('sem rede');
      expect(await servico.reconciliar(), isFalse);
      expect((await pedidos.listar()).length, 1);
    });

    test('chamadas simultâneas compartilham a mesma reconciliação', () async {
      servidor = (c) async => (200, <Object?>[]);
      final a = servico.reconciliar();
      final b = servico.reconciliar();
      await Future.wait([a, b]);
      expect(srv.contar('GET', '/vendas/pedidos'), 1);
    });
  });

  group('pedido retido', () {
    test('confirmar com os valores atuais atualiza itens, total e status', () async {
      servidor = retem;
      final r = await fila.enviarPedido(pedido());
      expect(r.desfecho, DesfechoEnvio.retido);
      var p = (await pedidos.porId(r.id))!;
      expect(totalSeConfirmar(p), 33, reason: '3 x 11,00');

      servidor = (c) async => c.caminho == '/vendas/pedidos/srv-${r.id}/confirmar'
          ? (200, {'id': 'srv-${r.id}', 'numero': 102, 'status': 'RECEBIDO', 'total': 33, 'divergencias': const []})
          : (404, {});
      final res = await servico.confirmar(p);
      expect(res.confirmado, isTrue);

      p = (await pedidos.porId(r.id))!;
      expect(p.estado, EstadoPedido.enviado);
      expect(p.statusServidor, 'RECEBIDO');
      expect(p.totalServidor, 33);
      expect(p.total, 33);
      expect(p.itens.single.precoUnit, 11, reason: 'o item guarda o preço atual');
      expect(p.divergencias, isEmpty);
      expect(p.resposta!['confirmadoEm'], isNotNull);
      expect(situacaoDe(p), SituacaoPedido.aguardandoErp);
      expect(fila.retidos, 0);
    });

    test('confirmar com divergência que sobrou (estoque/crédito): continua retido e mostra o que barra', () async {
      servidor = retem;
      final r = await fila.enviarPedido(pedido());
      final p = (await pedidos.porId(r.id))!;
      servidor = (c) async => (
            409,
            {
              'statusCode': 409,
              'message': 'O pedido ainda tem pendência de estoque ou crédito',
              'codigo': 'AINDA_DIVERGENTE',
              'divergencias': [
                {'tipo': 'estoque', 'produtoId': Ids.p1, 'nome': 'Arroz 5kg', 'enviado': 3, 'atual': 1},
                {'tipo': 'credito', 'enviado': 33, 'atual': 20},
              ],
            }
          );
      final res = await servico.confirmar(p);
      expect(res.confirmado, isFalse);
      expect(res.divergencias.map((d) => d.tipo), ['estoque', 'credito']);
      final depois = (await pedidos.porId(r.id))!;
      expect(depois.estado, EstadoPedido.retido, reason: 'nada vai para o ERP');
      expect(depois.divergencias.map((d) => d.tipo), ['estoque', 'credito'], reason: 'o painel passa a mostrar o que ainda barra');
    });

    test('confirmar sem internet lança SemConexao e não muda o pedido', () async {
      servidor = retem;
      final r = await fila.enviarPedido(pedido());
      servidor = (c) async => throw http.ClientException('sem rede');
      await expectLater(servico.confirmar((await pedidos.porId(r.id))!), throwsA(isA<SemConexao>()));
      expect((await pedidos.porId(r.id))!.estado, EstadoPedido.retido);
    });

    test('confirmar pedido que já foi resolvido em outro aparelho (404) atualiza a lista', () async {
      servidor = retem;
      final r = await fila.enviarPedido(pedido());
      servidor = (c) async => c.metodo == 'POST'
          ? (404, {'statusCode': 404, 'message': 'Pedido não encontrado ou já resolvido'})
          : c.caminho == '/vendas/pedidos'
              ? (200, [itemServidor(id: 'srv-${r.id}', idDispositivo: r.id, status: 'RECEBIDO', numero: 102)])
              : (200, <Object?>[]);
      final res = await servico.confirmar((await pedidos.porId(r.id))!);
      expect(res.jaResolvido, isTrue);
      expect((await pedidos.porId(r.id))!.estado, EstadoPedido.enviado);
    });

    test('cancelar o retido: cancelado no servidor e no aparelho', () async {
      servidor = retem;
      final r = await fila.enviarPedido(pedido());
      servidor = (c) async => c.metodo == 'POST' ? (200, {'ok': true}) : (200, <Object?>[]);
      expect(await servico.cancelarRetido((await pedidos.porId(r.id))!), isTrue);
      final p = (await pedidos.porId(r.id))!;
      expect(p.estado, EstadoPedido.cancelado);
      expect(situacaoDe(p), SituacaoPedido.cancelado);
      expect(srv.contar('POST', '/vendas/pedidos/srv-${r.id}/cancelar'), 1);
      expect(fila.retidos, 0);
    });
  });

  group('pedido recusado e fila', () {
    test('recusado: editar e reenviar monta o rascunho e envia com um idDispositivo NOVO', () async {
      servidor = (c) async => (400, {'statusCode': 400, 'message': 'x', 'codigo': 'CLIENTE_BLOQUEADO'});
      final r = await fila.enviarPedido(pedido());
      final antigo = (await pedidos.porId(r.id))!;
      expect(antigo.estado, EstadoPedido.recusado);

      final meta = MetaRepository(banco);
      final cart = CarrinhoService(
        produtos: ProdutosRepository(banco),
        tabelas: TabelasRepository(banco),
        clientes: ClientesRepository(banco),
        rascunhos: RascunhoRepository(banco, meta),
        agora: () => DateTime.utc(2026, 11, 10, 12),
      );
      await cart.carregar(
        cliente: (await ClientesRepository(banco).porId(antigo.clienteId))!,
        tabela: (await TabelasRepository(banco).porId(antigo.tabelaId!))!,
        formaId: antigo.formaId,
        itens: antigo.itens,
        observacoes: antigo.observacoes,
      );
      await servico.descartar(antigo.id); // o recusado vira rascunho e sai da lista
      expect(cart.itens.single.quantidade, 3);
      expect(cart.forma!.id, Ids.boleto);
      expect(await pedidos.porId(antigo.id), isNull);

      servidor = aceita;
      final novo = await fila.enviarPedido(NovoPedido(
        clienteId: cart.cliente!.id,
        tabelaId: cart.tabela!.tabela.id,
        formaId: cart.forma!.id,
        itens: cart.itens.map((i) => i.paraEnvio()).toList(),
        total: cart.total,
      ));
      expect(novo.desfecho, DesfechoEnvio.enviado);
      expect(novo.id, isNot(antigo.id));
      final enviados = posts().map((c) => corpoDe(c)['idDispositivo']).toList();
      expect(enviados, [antigo.id, novo.id]);
      await cart.aguardarGravacao();
    });

    test('cancelar o envio de pedido na fila: sai da fila e NUNCA é enviado', () async {
      servidor = (c) async => throw http.ClientException('sem rede');
      final r = await fila.enviarPedido(pedido());
      expect(fila.naFila, 1);
      expect(await fila.cancelarEnvio(r.id), isTrue);
      final p = (await pedidos.porId(r.id))!;
      expect(p.estado, EstadoPedido.cancelado);
      expect(situacaoDe(p), SituacaoPedido.cancelado);
      expect(fila.naFila, 0);

      final antes = posts().length;
      servidor = aceita;
      await fila.enviarFila();
      expect(posts().length, antes, reason: 'a internet voltou e nada foi enviado');
      expect((await pedidos.porId(r.id))!.estado, EstadoPedido.cancelado);
    });

    test('cancelar o envio de pedido que já subiu não faz nada', () async {
      final r = await fila.enviarPedido(pedido());
      expect(await fila.cancelarEnvio(r.id), isFalse);
      expect((await pedidos.porId(r.id))!.estado, EstadoPedido.enviado);
    });

    test('a situação de cada pedido sai do estado local + status do servidor', () async {
      PedidoLocal com(String estado, [String? status]) => PedidoLocal(
            id: 'x',
            vendedorId: Ids.vendedor,
            clienteId: Ids.clienteOk,
            total: 1,
            estado: estado,
            corpo: const {},
            resposta: status == null ? null : {'status': status},
            criadoEm: DateTime.utc(2026),
            atualizadoEm: DateTime.utc(2026),
          );
      expect(situacaoDe(com(EstadoPedido.aguardandoEnvio)), SituacaoPedido.naFila);
      expect(situacaoDe(com(EstadoPedido.enviando)), SituacaoPedido.enviando);
      expect(situacaoDe(com(EstadoPedido.retido, 'AGUARDANDO_VENDEDOR')), SituacaoPedido.retido);
      expect(situacaoDe(com(EstadoPedido.enviado, 'RECEBIDO')), SituacaoPedido.aguardandoErp);
      expect(situacaoDe(com(EstadoPedido.enviado, 'ENVIADO_ERP')), SituacaoPedido.noErp);
      expect(situacaoDe(com(EstadoPedido.enviado, 'EM_FATURAMENTO')), SituacaoPedido.noErp);
      expect(situacaoDe(com(EstadoPedido.enviado, 'FATURADO')), SituacaoPedido.faturado);
      expect(situacaoDe(com(EstadoPedido.enviado, 'ENTREGUE')), SituacaoPedido.faturado);
      expect(situacaoDe(com(EstadoPedido.cancelado)), SituacaoPedido.cancelado);
      expect(situacaoDe(com(EstadoPedido.recusado)), SituacaoPedido.recusado);
      // filtros
      expect(FiltroPedido.naFila.aceita(SituacaoPedido.enviando), isTrue);
      expect(FiltroPedido.enviados.aceita(SituacaoPedido.noErp), isTrue);
      expect(FiltroPedido.enviados.aceita(SituacaoPedido.faturado), isFalse);
      expect(FiltroPedido.encerrados.aceita(SituacaoPedido.recusado), isTrue);
      expect(FiltroPedido.todos.aceita(SituacaoPedido.retido), isTrue);
    });
  });

  group('orçamentos', () {
    Future<(int, Object?)> aceitaOrcamento(Chamada c) async {
      if (c.metodo == 'PUT') return (200, {'id': c.caminho.split('/').last, 'status': 'aberto', 'total': corpoDe(c)['itens'] == null ? 0 : 11});
      return aceita(c);
    }

    test('editar mantém o MESMO id: dois PUT no mesmo caminho e uma só linha local', () async {
      servidor = aceitaOrcamento;
      final r = await fila.salvarOrcamento(orcamento());
      expect(r.desfecho, DesfechoEnvio.enviado);
      final editado = await fila.salvarOrcamento(orcamento(total: 16.5), id: r.id);
      expect(editado.id, r.id);

      final puts = srv.chamadas.where((c) => c.metodo == 'PUT').toList();
      expect(puts.length, 2);
      expect(puts.map((c) => c.caminho).toSet(), {'/vendas/orcamentos/${r.id}'});
      final lista = await orcamentos.listar();
      expect(lista.length, 1);
      expect(lista.single.total, 16.5);
      expect(lista.single.estado, EstadoOrcamento.sincronizado);
    });

    test('transformar em pedido envia orcamentoId e marca o orçamento como convertido', () async {
      servidor = aceitaOrcamento;
      final o = await fila.salvarOrcamento(orcamento());
      final r = await fila.enviarPedido(pedido(orcamentoId: o.id));
      expect(r.desfecho, DesfechoEnvio.enviado);
      expect(corpoDe(posts().single)['orcamentoId'], o.id);
      final q = (await orcamentos.porId(o.id))!;
      expect(q.estado, EstadoOrcamento.convertido);
      expect(q.pedidoId, 'srv-${r.id}', reason: 'o orçamento aponta para o pedido');
      expect(situacaoOrcamentoDe(q), SituacaoOrcamento.convertido);
    });

    test('cancelar o orçamento aberto: cancelado no servidor e no aparelho; sem internet lança SemConexao', () async {
      servidor = aceitaOrcamento;
      final o = await fila.salvarOrcamento(orcamento());
      final q = (await orcamentos.porId(o.id))!;
      servidor = (c) async => throw http.ClientException('sem rede');
      await expectLater(servico.cancelarOrcamento(q), throwsA(isA<SemConexao>()));
      expect((await orcamentos.porId(o.id))!.estado, EstadoOrcamento.sincronizado);

      servidor = (c) async => (200, {'ok': true});
      expect(await servico.cancelarOrcamento(q), isTrue);
      expect((await orcamentos.porId(o.id))!.estado, EstadoOrcamento.cancelado);
      expect(srv.contar('POST', '/vendas/orcamentos/${o.id}/cancelar'), 2, reason: 'a 1ª tentativa caiu sem rede, a 2ª passou');
    });

    test('reconciliar orçamentos: status do servidor, orçamento de outro aparelho e alteração pendente preservada', () async {
      servidor = aceitaOrcamento;
      final convertido = await fila.salvarOrcamento(orcamento());
      servidor = (c) async => throw http.ClientException('sem rede');
      final pendente = await fila.salvarOrcamento(orcamento(total: 99)); // fica `local`
      expect((await orcamentos.porId(pendente.id))!.estado, EstadoOrcamento.local);

      Map<String, Object?> orc(String id, String status, {String? pedidoId, double total = 11}) => {
            'id': id,
            'clienteId': Ids.clienteOk,
            'tabelaPrecoId': Ids.tabEntrega,
            'formaPagamentoId': Ids.boleto,
            'tipoEntrega': 'entrega',
            'observacoes': null,
            'total': total,
            'status': status,
            'pedidoId': pedidoId,
            'criadoEm': '2026-11-10T12:00:00.000Z',
            'atualizadoEm': '2026-11-10T13:00:00.000Z',
            'itens': [
              {'produtoId': Ids.p2, 'quantidade': 2, 'precoUnit': 5.5}
            ],
          };
      servidor = (c) async => c.caminho == '/vendas/orcamentos'
          ? (200, [orc(convertido.id, 'convertido', pedidoId: 'srv-ped'), orc(pendente.id, 'aberto', total: 11), orc('orc-outro', 'aberto', total: 50)])
          : (200, <Object?>[]);
      await servico.reconciliar();

      expect((await orcamentos.porId(convertido.id))!.estado, EstadoOrcamento.convertido);
      expect((await orcamentos.porId(convertido.id))!.pedidoId, 'srv-ped');
      final p = (await orcamentos.porId(pendente.id))!;
      expect(p.estado, EstadoOrcamento.local, reason: 'a edição que não subiu não é sobrescrita');
      expect(p.total, 99);
      final outro = (await orcamentos.porId('orc-outro'))!;
      expect(outro.total, 50);
      expect(outro.itens.single.produtoId, Ids.p2);
      expect((await orcamentos.listar()).length, 3);
    });
  });

  group('carrinho a partir de orçamento', () {
    test('carregar usa os preços ATUAIS da tabela e avisa quando o total mudou', () async {
      final meta = MetaRepository(banco);
      final cart = CarrinhoService(
        produtos: ProdutosRepository(banco),
        tabelas: TabelasRepository(banco),
        clientes: ClientesRepository(banco),
        rascunhos: RascunhoRepository(banco, meta),
        agora: () => DateTime.utc(2026, 11, 10, 12),
      );
      await cart.carregar(
        cliente: (await ClientesRepository(banco).porId(Ids.clienteOk))!,
        tabela: (await TabelasRepository(banco).porId(Ids.tabEntrega))!,
        formaId: Ids.boleto,
        // o orçamento foi feito com preço antigo (4,00); hoje a tabela diz 5,50
        itens: const [ItemEnvio(produtoId: Ids.p2, quantidade: 2, precoUnit: 4)],
        orcamentoId: 'orc-1',
        totalAnterior: 8,
      );
      expect(cart.itens.single.precoUnit, 5.5);
      expect(cart.total, 11);
      expect(cart.orcamentoId, 'orc-1');
      expect(cart.totalAnterior, 8);
      expect(cart.aviso, contains('O total mudou'));
      expect(cart.aviso, contains('R\$ 8,00'));
      expect(cart.aviso, contains('R\$ 11,00'));
      await cart.aguardarGravacao();
    });

    test('item sem preço na tabela sai do rascunho e vira aviso', () async {
      final meta = MetaRepository(banco);
      final cart = CarrinhoService(
        produtos: ProdutosRepository(banco),
        tabelas: TabelasRepository(banco),
        clientes: ClientesRepository(banco),
        rascunhos: RascunhoRepository(banco, meta),
        agora: () => DateTime.utc(2026, 11, 10, 12),
      );
      await cart.carregar(
        cliente: (await ClientesRepository(banco).porId(Ids.clienteOk))!,
        tabela: (await TabelasRepository(banco).porId(Ids.tabSoPix))!,
        itens: const [
          ItemEnvio(produtoId: Ids.p1, quantidade: 1, precoUnit: 11),
          ItemEnvio(produtoId: Ids.p3, quantidade: 1, precoUnit: 2), // sem preço nesta tabela
        ],
      );
      expect(cart.itens.length, 1);
      expect(cart.aviso, contains('1 item saiu'));
      expect(cart.forma!.id, Ids.pix, reason: 'tabela com uma forma só escolhe sozinha');
      await cart.aguardarGravacao();
    });
  });

  group('sair com a fila', () {
    test('aviso com pedidos e orçamentos que ainda não subiram', () async {
      expect(mensagemDeSaida(pedidos: 0, orcamentos: 0), isNull);
      expect(mensagemDeSaida(pedidos: 2, orcamentos: 0), 'Você tem 2 pedido(s) na fila. Se sair agora eles serão perdidos.');
      expect(mensagemDeSaida(pedidos: 1, orcamentos: 3), 'Você tem 1 pedido(s) e 3 orçamento(s) na fila. Se sair agora eles serão perdidos.');

      servidor = (c) async => throw http.ClientException('sem rede');
      await fila.enviarPedido(pedido());
      await fila.enviarPedido(pedido(total: 20));
      await fila.salvarOrcamento(orcamento());
      final p = await fila.pendentes();
      expect((p.pedidos, p.orcamentos), (2, 1));
      expect(mensagemDeSaida(pedidos: p.pedidos, orcamentos: p.orcamentos), contains('2 pedido(s) e 1 orçamento(s) na fila'));
    });
  });
}
