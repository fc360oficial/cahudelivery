import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:fluxo_vendas/core/api_client.dart';
import 'package:fluxo_vendas/core/token_store.dart';
import 'package:fluxo_vendas/data/banco_local.dart';
import 'package:fluxo_vendas/data/carga_repository.dart';
import 'package:fluxo_vendas/data/locais_repository.dart';
import 'package:fluxo_vendas/data/meta_repository.dart';
import 'package:fluxo_vendas/data/pedido_local.dart';
import 'package:fluxo_vendas/services/conectividade.dart';
import 'package:fluxo_vendas/services/fila_envio_service.dart';
import 'package:fluxo_vendas/services/sincronizacao_service.dart';
import 'package:http/http.dart' as http;

import 'suporte/banco_teste.dart';
import 'suporte/http_falso.dart';
import 'suporte/pedido_teste.dart';

class _SemRede implements FonteConectividade {
  @override
  Future<bool> temRede() async => true;
  @override
  Stream<bool> get mudancas => const Stream.empty();
}

NovoPedido pedido({double total = 30.23, String cliente = Ids.clienteOk}) => NovoPedido(
      clienteId: cliente,
      tabelaId: Ids.tabEntrega,
      formaId: Ids.boleto,
      total: total,
      observacoes: 'Entregar de manhã',
      itens: const [ItemEnvio(produtoId: Ids.p1, quantidade: 3, precoUnit: 10.075)],
    );

NovoOrcamento orcamento() => const NovoOrcamento(
      clienteId: Ids.clienteOk,
      tabelaId: Ids.tabEntrega,
      total: 11,
      itens: [ItemEnvio(produtoId: Ids.p2, quantidade: 2, precoUnit: 5.5)],
    );

void main() {
  late BancoLocal banco;
  late PedidosLocaisRepository pedidos;
  late OrcamentosLocaisRepository orcamentos;
  late ServidorFalso srv;
  late FilaEnvioService fila;
  late int tick;

  /// Comportamento do servidor falso (cada teste troca).
  late Future<(int, Object?)> Function(Chamada c) servidor;

  Map<String, dynamic> corpoDe(Chamada c) => jsonDecode(c.corpo) as Map<String, dynamic>;
  Iterable<Chamada> posts() => srv.chamadas.where((c) => c.metodo == 'POST' && c.caminho == '/vendas/pedidos');

  Future<(int, Object?)> aceita(Chamada c) async {
    final b = corpoDe(c);
    return (200, {'id': 'srv-${b['idDispositivo']}', 'numero': 101, 'status': 'RECEBIDO', 'total': 30.23, 'divergencias': []});
  }

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
    final api = ApiClient(
        tokens: MemoriaTokenStore(const Tokens('AT', 'RT')), client: srv.cliente, baseUrl: 'http://x/v1', tenant: 'cahu');
    fila = FilaEnvioService(
      api: api,
      pedidos: pedidos,
      orcamentos: orcamentos,
      agora: () => DateTime.utc(2026, 11, 10, 12).add(Duration(seconds: tick++)),
      novoId: () => '00000000-0000-4000-8000-${(++n).toString().padLeft(12, '0')}',
    );
  });
  tearDown(() async {
    fila.dispose();
    await banco.fechar();
  });

  test('online: grava, envia na hora, guarda a resposta e marca enviado', () async {
    final r = await fila.enviarPedido(pedido());
    expect(r.desfecho, DesfechoEnvio.enviado);
    expect(r.numero, 101);
    final p = (await pedidos.porId(r.id))!;
    expect(p.estado, EstadoPedido.enviado);
    expect(p.servidorNumero, 101);
    expect(p.resposta!['status'], 'RECEBIDO');
    expect(p.enviadoEm, isNotNull);
    expect(p.tentativas, 1);
    // corpo: UUID do aparelho, sem tipoEntrega (a tabela manda), preço da tabela
    final corpo = corpoDe(posts().single);
    expect(corpo['idDispositivo'], r.id);
    expect(corpo.containsKey('tipoEntrega'), isFalse);
    expect(corpo['tabelaPrecoId'], Ids.tabEntrega);
    expect(corpo['formaPagamentoId'], Ids.boleto);
    expect(corpo['observacoes'], 'Entregar de manhã');
    expect(corpo['criadoNoAparelhoEm'], '2026-11-10T12:00:00.000Z');
    expect((corpo['itens'] as List).single, {'produtoId': Ids.p1, 'quantidade': 3.0, 'precoUnit': 10.075});
    expect(fila.naFila, 0);
  });

  test('sem internet: fica aguardando_envio; ao voltar a rede reenvia com o MESMO idDispositivo', () async {
    servidor = (c) async => throw http.ClientException('sem rede');
    final r = await fila.enviarPedido(pedido());
    expect(r.desfecho, DesfechoEnvio.naFila);
    expect((await pedidos.porId(r.id))!.estado, EstadoPedido.aguardandoEnvio);
    expect(fila.naFila, 1);

    servidor = aceita;
    await fila.enviarFila();
    final p = (await pedidos.porId(r.id))!;
    expect(p.estado, EstadoPedido.enviado);
    expect(p.tentativas, 2);
    final ids = posts().map((c) => corpoDe(c)['idDispositivo']).toList();
    expect(ids, [r.id, r.id]);
    expect(corpoDe(posts().first), corpoDe(posts().last)); // corpo idêntico, inclusive criadoNoAparelhoEm
    expect(fila.naFila, 0);
  });

  test('resposta do servidor a um reenvio duplicado (mesmo id) é sucesso, não erro', () async {
    // 1ª tentativa chegou ao servidor mas a resposta se perdeu (tempo esgotado)
    servidor = (c) async => throw TimeoutException('lento');
    final r = await fila.enviarPedido(pedido());
    expect(r.desfecho, DesfechoEnvio.naFila);
    // o servidor devolve o pedido que já tinha
    servidor = aceita;
    await fila.enviarFila();
    expect((await pedidos.porId(r.id))!.estado, EstadoPedido.enviado);
    expect((await pedidos.porId(r.id))!.servidorNumero, 101);
  });

  test('recusa definitiva (400 com código): vira recusado com mensagem em português e NUNCA é reenviada', () async {
    servidor = (c) async =>
        (400, {'statusCode': 400, 'message': 'Cliente bloqueado para novos pedidos', 'codigo': 'CLIENTE_BLOQUEADO'});
    final r = await fila.enviarPedido(pedido());
    expect(r.desfecho, DesfechoEnvio.recusado);
    expect(r.mensagem, 'Cliente bloqueado. Fale com o supervisor.');
    final p = (await pedidos.porId(r.id))!;
    expect(p.estado, EstadoPedido.recusado);
    expect(p.codigoErro, 'CLIENTE_BLOQUEADO');
    expect(p.motivo, r.mensagem);
    expect(fila.recusados, 1);
    expect(fila.naFila, 0);

    servidor = aceita;
    await fila.enviarFila();
    await fila.enviarFila();
    expect(posts().length, 1); // não tentou de novo
    expect((await pedidos.porId(r.id))!.estado, EstadoPedido.recusado);
  });

  test('403 e 409 também são definitivos (carteira, id em uso)', () async {
    servidor = (c) async => (403, {'statusCode': 403, 'message': 'x', 'codigo': 'CLIENTE_FORA_DA_CARTEIRA'});
    var r = await fila.enviarPedido(pedido());
    expect(r.mensagem, 'Este cliente não faz parte da sua carteira.');
    servidor = (c) async => (409, {'statusCode': 409, 'message': 'x', 'codigo': 'ID_DISPOSITIVO_EM_USO'});
    r = await fila.enviarPedido(pedido());
    expect(r.desfecho, DesfechoEnvio.recusado);
    expect(r.mensagem, 'Este pedido já foi enviado por outro aparelho.');
  });

  test('erro do servidor (500) e limite de chamadas (429) ficam na fila e a fila para', () async {
    servidor = (c) async => (500, {'statusCode': 500, 'message': 'Erro interno'});
    var r = await fila.enviarPedido(pedido());
    expect(r.desfecho, DesfechoEnvio.naFila);
    servidor = (c) async => (429, {'statusCode': 429, 'message': 'devagar'});
    r = await fila.enviarPedido(pedido());
    expect(r.desfecho, DesfechoEnvio.naFila);
    expect(fila.naFila, 2);
    expect(fila.recusados, 0);
  });

  test('ordem de envio = ordem de criação (pedidos e orçamentos juntos)', () async {
    servidor = (c) async => throw http.ClientException('sem rede');
    final a = await fila.enviarPedido(pedido(total: 10));
    final o = await fila.salvarOrcamento(orcamento());
    final b = await fila.enviarPedido(pedido(total: 20));
    final c3 = await fila.enviarPedido(pedido(total: 30));
    expect(fila.naFila, 4);

    final enviados = <String>[];
    servidor = (c) async {
      enviados.add(c.metodo == 'PUT' ? c.caminho.split('/').last : corpoDe(c)['idDispositivo'] as String);
      return c.metodo == 'PUT' ? (200, {'id': o.id, 'status': 'aberto', 'total': 11}) : await aceita(c);
    };
    await fila.enviarFila();
    expect(enviados, [a.id, o.id, b.id, c3.id]);
    expect(fila.naFila, 0);
  });

  test('sem rede no meio da fila: para ali, o resto fica para depois, na mesma ordem', () async {
    servidor = (c) async => throw http.ClientException('sem rede');
    final a = await fila.enviarPedido(pedido());
    final b = await fila.enviarPedido(pedido());
    final c3 = await fila.enviarPedido(pedido());
    var chamadas = 0;
    servidor = (c) async {
      chamadas++;
      if (chamadas == 2) throw http.ClientException('caiu');
      return aceita(c);
    };
    await fila.enviarFila();
    expect((await pedidos.porId(a.id))!.estado, EstadoPedido.enviado);
    expect((await pedidos.porId(b.id))!.estado, EstadoPedido.aguardandoEnvio);
    expect((await pedidos.porId(c3.id))!.estado, EstadoPedido.aguardandoEnvio);
    expect(chamadas, 2); // não pulou o b para mandar o c
  });

  test('uma recusa no meio não trava os pedidos seguintes', () async {
    servidor = (c) async => throw http.ClientException('sem rede');
    final a = await fila.enviarPedido(pedido(cliente: Ids.clienteBloqueado));
    final b = await fila.enviarPedido(pedido());
    servidor = (c) async => corpoDe(c)['clienteId'] == Ids.clienteBloqueado
        ? (400, {'statusCode': 400, 'message': 'x', 'codigo': 'CLIENTE_BLOQUEADO'})
        : aceita(c);
    await fila.enviarFila();
    expect((await pedidos.porId(a.id))!.estado, EstadoPedido.recusado);
    expect((await pedidos.porId(b.id))!.estado, EstadoPedido.enviado);
  });

  test('pedido retido: guarda a resposta com as divergências e vira retido', () async {
    servidor = (c) async => (
          200,
          {
            'id': 'srv-1',
            'numero': 55,
            'status': 'AGUARDANDO_VENDEDOR',
            'total': 30.23,
            'divergencias': [
              {'tipo': 'preco', 'produtoId': Ids.p1, 'nome': 'Arroz 5kg', 'enviado': 10.0, 'atual': 10.5},
              {'tipo': 'estoque', 'produtoId': Ids.p1, 'nome': 'Arroz 5kg', 'enviado': 3, 'atual': 1},
              {'tipo': 'credito', 'enviado': 31.5, 'atual': 20},
              {'tipo': 'sem_preco', 'produtoId': Ids.p2, 'nome': 'Feijão 1kg', 'enviado': 5.5},
            ],
          }
        );
    final r = await fila.enviarPedido(pedido());
    expect(r.desfecho, DesfechoEnvio.retido);
    expect(r.numero, 55);
    expect(r.divergencias.map((d) => d.tipo), ['preco', 'estoque', 'credito', 'sem_preco']);
    final p = (await pedidos.porId(r.id))!;
    expect(p.estado, EstadoPedido.retido);
    expect(p.divergencias.length, 4);
    expect(p.servidorId, 'srv-1');
    expect(fila.retidos, 1);
    expect(fila.naFila, 0);
    // textos em português com enviado -> atual
    expect(p.divergencias[0].descricao, contains('R\$ 10,00'));
    expect(p.divergencias[0].descricao, contains('R\$ 10,50'));
    expect(p.divergencias[1].descricao, contains('pediu 3 e há 1'));
    expect(p.divergencias[2].titulo, 'Limite de crédito');
    // a fila não reenvia retido
    await fila.enviarFila();
    expect(posts().length, 1);
  });

  test('orçamento salvo offline fica local e sobe com PUT /vendas/orcamentos/:id', () async {
    servidor = (c) async => throw http.ClientException('sem rede');
    final r = await fila.salvarOrcamento(orcamento());
    expect(r.orcamento, isTrue);
    expect(r.desfecho, DesfechoEnvio.naFila);
    expect((await orcamentos.porId(r.id))!.estado, EstadoOrcamento.local);
    expect(fila.naFila, 1);

    servidor = (c) async => (200, {'id': r.id, 'status': 'aberto', 'total': 11});
    await fila.enviarFila();
    final o = (await orcamentos.porId(r.id))!;
    expect(o.estado, EstadoOrcamento.sincronizado);
    expect(o.sincronizadoEm, isNotNull);
    final put = srv.chamadas.last;
    expect(put.metodo, 'PUT');
    expect(put.caminho, '/vendas/orcamentos/${r.id}');
    final corpo = corpoDe(put);
    expect(corpo.containsKey('tipoEntrega'), isFalse);
    expect(corpo.containsKey('formaPagamentoId'), isFalse); // opcional
    expect(corpo['tabelaPrecoId'], Ids.tabEntrega);
    expect(fila.naFila, 0);
  });

  test('orçamento online é enviado na hora; refazer o mesmo id reenvia por cima (PUT idempotente)', () async {
    servidor = (c) async => (200, {'id': 'x', 'status': 'aberto', 'total': 11});
    final r = await fila.salvarOrcamento(orcamento());
    expect(r.desfecho, DesfechoEnvio.enviado);
    final r2 = await fila.salvarOrcamento(orcamento(), id: r.id);
    expect(r2.id, r.id);
    expect(srv.chamadas.where((c) => c.metodo == 'PUT' && c.caminho.endsWith(r.id)).length, 2);
  });

  test('orçamento recusado (409 ORCAMENTO_FECHADO) vira recusado e não é reenviado', () async {
    servidor = (c) async => (409, {'statusCode': 409, 'message': 'x', 'codigo': 'ORCAMENTO_FECHADO'});
    final r = await fila.salvarOrcamento(orcamento());
    expect(r.desfecho, DesfechoEnvio.recusado);
    expect((await orcamentos.porId(r.id))!.estado, EstadoOrcamento.recusado);
    await fila.enviarFila();
    expect(srv.chamadas.where((c) => c.metodo == 'PUT').length, 1);
  });

  test('pedido que ficou enviando (app morto no meio) volta para a fila ao abrir', () async {
    servidor = (c) async => throw http.ClientException('sem rede');
    final r = await fila.enviarPedido(pedido());
    await pedidos.atualizar(r.id, {'estado': EstadoPedido.enviando}, DateTime.utc(2026, 11, 10, 13));
    await fila.recuperarInterrompidos();
    expect((await pedidos.porId(r.id))!.estado, EstadoPedido.aguardandoEnvio);
    expect(fila.naFila, 1);
  });

  test('duas chamadas simultâneas de enviarFila não duplicam o envio', () async {
    servidor = (c) async => throw http.ClientException('sem rede');
    final r = await fila.enviarPedido(pedido());
    servidor = (c) async {
      await Future<void>.delayed(const Duration(milliseconds: 20));
      return aceita(c);
    };
    await Future.wait([fila.enviarFila(), fila.enviarFila(), fila.enviarFila()]);
    expect(posts().where((c) => corpoDe(c)['idDispositivo'] == r.id).length, 2); // 1 offline + 1 online
    expect((await pedidos.porId(r.id))!.estado, EstadoPedido.enviado);
  });

  test('sincronizar envia a fila ANTES de baixar a carga', () async {
    servidor = (c) async => throw http.ClientException('sem rede');
    await fila.enviarPedido(pedido());
    servidor = (c) async {
      if (c.caminho == '/vendas/sync') return (200, fixtureJson('sync'));
      if (c.caminho == '/vendas/resumo') return (200, fixtureJson('resumo'));
      return aceita(c);
    };
    final api = ApiClient(
        tokens: MemoriaTokenStore(const Tokens('AT', 'RT')), client: srv.cliente, baseUrl: 'http://x/v1', tenant: 'cahu');
    final sync = SincronizacaoService(
        api: api, carga: CargaRepository(banco), meta: MetaRepository(banco), conectividade: _SemRede());
    sync.enviarFila = fila.enviarFila;
    final antes = srv.chamadas.length;
    final res = await sync.sincronizar();
    expect(res.ok, isTrue);
    final caminhos = srv.chamadas.skip(antes).map((c) => c.caminho).toList();
    expect(caminhos.first, '/vendas/pedidos');
    expect(caminhos.indexOf('/vendas/sync'), greaterThan(0));
    sync.dispose();
  });
}
