import 'package:flutter_test/flutter_test.dart';
import 'package:fluxo_entregas/core/api_client.dart';
import 'package:fluxo_entregas/core/token_store.dart';
import 'package:fluxo_entregas/services/carga_service.dart';
import 'package:fluxo_entregas/services/localizacao_service.dart';
import 'package:geolocator/geolocator.dart';

import 'apoio.dart';

void main() {
  late PlataformaFalsa plataforma;
  late ServidorFalso servidor;
  late LocalizacaoService loc;

  setUp(() async {
    plataforma = PlataformaFalsa();
    servidor = ServidorFalso((p) => (200, {'aceitos': 1}));
    loc = LocalizacaoService(
      plataforma: plataforma,
      api: ApiClient(tokens: MemoriaTokenStore(const Tokens('a', 'r')), client: servidor, baseUrl: 'http://x/v1'),
      banco: await bancoEmMemoria(),
      intervaloEnvio: const Duration(hours: 1),
    );
  });

  test('só libera com GPS ligado e permissão "o tempo todo"', () async {
    plataforma.gps = false;
    await loc.verificar();
    expect(loc.estado, EstadoLocalizacao.gpsDesligado);
    plataforma.gps = true;
    for (final (perm, esperado) in [
      (LocationPermission.denied, EstadoLocalizacao.semPermissao),
      (LocationPermission.deniedForever, EstadoLocalizacao.negadaParaSempre),
      (LocationPermission.whileInUse, EstadoLocalizacao.soDuranteUso),
      (LocationPermission.always, EstadoLocalizacao.ok),
    ]) {
      plataforma.perm = perm;
      await loc.verificar();
      expect(loc.estado, esperado, reason: '$perm');
      expect(loc.liberado, esperado == EstadoLocalizacao.ok);
    }
  });

  test('o botão faz o próximo passo: liga o GPS, pede a permissão e, se vier "durante o uso", abre as configurações', () async {
    plataforma.gps = false;
    await loc.verificar();
    await loc.resolver();
    expect(plataforma.abriuGps, 1);
    plataforma.gps = true;
    await loc.verificar();
    await loc.resolver();
    expect(plataforma.perm, LocationPermission.whileInUse);
    expect(plataforma.abriuApp, 1);
    expect(loc.estado, EstadoLocalizacao.soDuranteUso);
    await loc.resolver();
    expect(plataforma.abriuApp, 2);
    plataforma.perm = LocationPermission.always;
    await loc.verificar();
    expect(loc.liberado, isTrue);
  });

  test('tirou a permissão no meio da rota: volta a bloquear e para de acompanhar', () async {
    plataforma.perm = LocationPermission.always;
    await loc.verificar();
    loc.acompanhar();
    expect(loc.acompanhando, isTrue);
    plataforma.perm = LocationPermission.whileInUse;
    await loc.verificar();
    expect(loc.liberado, isFalse);
    expect(loc.acompanhando, isFalse);
  });

  test('guarda os pontos e manda em lote; sem sinal guarda para depois', () async {
    plataforma.perm = LocationPermission.always;
    await loc.verificar();
    loc.acompanhar();
    servidor.semSinal = true;
    plataforma.pontos.add(const PontoGps(-8.16, -34.92, 6));
    await Future<void>.delayed(const Duration(milliseconds: 20));
    plataforma.pontos.add(const PontoGps(-8.17, -34.93));
    await Future<void>.delayed(const Duration(milliseconds: 20));
    await loc.enviarPosicoes();
    expect(servidor.pedidos, isEmpty);
    servidor.semSinal = false;
    await loc.enviarPosicoes();
    expect(servidor.pedidos.single.caminho, '/motorista/posicoes');
    final pontos = servidor.pedidos.single.corpo['pontos'] as List;
    expect(pontos, hasLength(2));
    expect(pontos.first['precisaoM'], 6);
    expect((pontos.last as Map).containsKey('precisaoM'), isFalse);
    await loc.enviarPosicoes();
    expect(servidor.pedidos, hasLength(1)); // nada repetido
  });

  test('sem liberação não pega ponto do GPS', () async {
    await loc.verificar();
    expect(await loc.pontoAtual(), isNull);
  });
}
