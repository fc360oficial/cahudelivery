import 'package:flutter_test/flutter_test.dart';
import 'package:fluxo_entregas/core/api_client.dart';
import 'package:fluxo_entregas/core/token_store.dart';
import 'package:fluxo_entregas/data/banco_local.dart';
import 'package:fluxo_entregas/data/modelos.dart';
import 'package:fluxo_entregas/services/carga_service.dart';

import 'apoio.dart';

void main() {
  late BancoLocal banco;
  late ServidorFalso servidor;
  late CargaService servico;
  late Map<String, dynamic> noServidor;
  final apagadas = <String>[];

  setUp(() async {
    banco = await bancoEmMemoria();
    noServidor = cargaJson();
    apagadas.clear();
    servidor = ServidorFalso((p) {
      if (p.metodo == 'GET' && p.caminho == '/motorista/carga') return (200, {'carga': noServidor});
      return (200, {'ok': true});
    });
    final api = ApiClient(tokens: MemoriaTokenStore(const Tokens('a', 'r')), client: servidor, baseUrl: 'http://x/v1', tenant: 'cahu');
    servico = CargaService(
      api: api,
      banco: banco,
      conectividade: RedeFalsa(),
      lerArquivo: (c) async => [1, 2, 3],
      apagarArquivo: (c) async => apagadas.add(c),
      intervalo: const Duration(hours: 1),
    );
    await servico.iniciar();
  });

  tearDown(() => servico.parar());

  test('baixa a carga, manda X-Tenant e guarda no aparelho', () async {
    expect(servico.carga!.paradas, hasLength(3));
    expect(servidor.pedidos.first.cabecalhos['X-Tenant'], 'cahu');
    expect((await banco.carga())!.numero, 7);
  });

  test('sem sinal: as ações aparecem na hora, ficam na fila e sobem na ordem quando o sinal volta', () async {
    servidor.semSinal = true;
    final p1 = servico.carga!.paradas[0];
    await servico.chegada(p1, const PontoGps(-8.16, -34.92));
    await servico.entregue(servico.carga!.paradas[0], recebedorNome: ' Luciana ', fotoAssinatura: '/f/assinatura.jpg', fotoMercadoria: '/f/merc.jpg');
    await servico.naoEntregue(servico.carga!.paradas[1], motivo: 'cliente_fechado', fotoLocal: '/f/local.jpg');
    await servico.sincronizar();

    final vista = servico.carga!;
    expect(vista.status, 'em_rota'); // a chegada já tira a carga do CD
    expect(vista.paradas[0].status, StatusParada.entregue);
    expect(vista.paradas[0].chegadaEm, isNotNull);
    expect(vista.paradas[1].status, StatusParada.naoEntregue);
    expect(vista.feitas, 2);
    expect(servico.pendentes, 3);
    expect(servico.semSinal, isTrue);

    // O sinal volta: sobe na ordem, as fotos vão e depois são apagadas do celular.
    servidor.semSinal = false;
    servidor.pedidos.clear();
    noServidor = cargaJson(status: 'em_rota');
    (noServidor['paradas'] as List)[0]['status'] = 'entregue';
    (noServidor['paradas'] as List)[1]['status'] = 'nao_entregue';
    await servico.sincronizar();
    expect(servidor.pedidos.map((p) => p.caminho).toList(), [
      '/motorista/cargas/carga-1/chegada',
      '/motorista/cargas/carga-1/entregue',
      '/motorista/cargas/carga-1/nao-entregue',
      '/motorista/carga',
    ]);
    final chegada = servidor.pedidos[0];
    expect(chegada.corpo['linhaIds'], ['linha-1']);
    expect(chegada.corpo['lat'], -8.16);
    final entregue = servidor.pedidos[1];
    expect(entregue.campos['linhaIds'], 'linha-1');
    expect(entregue.campos['recebedorNome'], 'Luciana');
    expect(entregue.campos.containsKey('recebedorDocumento'), isFalse);
    expect(entregue.arquivos, unorderedEquals(['assinatura', 'mercadoria']));
    expect(servidor.pedidos[2].campos['motivo'], 'cliente_fechado');
    expect(servidor.pedidos[2].arquivos, ['foto']);
    expect(apagadas, unorderedEquals(['/f/assinatura.jpg', '/f/merc.jpg', '/f/local.jpg']));
    expect(servico.pendentes, 0);
    expect(servico.semSinal, isFalse);
    expect(servico.carga!.feitas, 2);
  });

  test('recusa definitiva do servidor sai da fila com o motivo e não trava as outras', () async {
    servidor.responder = (p) {
      if (p.caminho.endsWith('/chegada')) return (409, {'message': 'O CD reabriu esta carga para ajuste. Aguarde a nova autorização.'});
      if (p.metodo == 'GET') return (200, {'carga': noServidor});
      return (200, {'ok': true});
    };
    await servico.chegada(servico.carga!.paradas[0], null);
    await servico.ocorrencia(servico.carga!.paradas[1], linhaId: 'linha-2', tipo: 'falta', quantidade: 2);
    await servico.sincronizar();
    expect(servico.recusadas, hasLength(1));
    expect(servico.recusadas.first.recusa, contains('reabriu'));
    expect(servico.pendentes, 0);
    // A recusada não conta na tela.
    expect(servico.carga!.paradas[0].status, StatusParada.pendente);
    await servico.dispensarRecusa(servico.recusadas.first.id);
    expect(servico.recusadas, isEmpty);
  });

  test('erro passageiro do servidor (500) mantém a ação na fila', () async {
    servidor.responder = (p) => p.metodo == 'GET' ? (200, {'carga': noServidor}) : (500, {'message': 'falhou'});
    await servico.chegada(servico.carga!.paradas[0], null);
    await servico.sincronizar();
    expect(servico.pendentes, 1);
    expect((await banco.acoes()).first.tentativas, greaterThanOrEqualTo(1));
  });

  test('ao encerrar a rota a carga sai da tela', () async {
    noServidor = cargaJson(status: 'em_rota', n: 1);
    await servico.sincronizar();
    servidor.semSinal = true;
    await servico.entregue(servico.carga!.paradas[0], recebedorNome: 'Ana', fotoAssinatura: '/f/a.jpg');
    expect(servico.carga!.tudoResolvido, isTrue);
    await servico.encerrar();
    expect(servico.carga, isNull);
    expect(servico.encerramentoPendente, isTrue);
  });

  test('servidor sem carga: nada na tela', () async {
    noServidor = {};
    servidor.responder = (p) => (200, {'carga': null});
    await servico.sincronizar();
    expect(servico.carga, isNull);
  });
}
