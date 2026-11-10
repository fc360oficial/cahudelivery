import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:fluxo_vendas/core/api_client.dart';
import 'package:fluxo_vendas/core/api_exception.dart';
import 'package:fluxo_vendas/core/token_store.dart';
import 'package:fluxo_vendas/data/banco_local.dart';
import 'package:fluxo_vendas/data/carga_repository.dart';
import 'package:fluxo_vendas/data/meta_repository.dart';
import 'package:fluxo_vendas/services/conectividade.dart';
import 'package:fluxo_vendas/services/sincronizacao_service.dart';
import 'package:sqflite/sqflite.dart' show Sqflite;

import 'suporte/banco_teste.dart';
import 'suporte/http_falso.dart';

class _Rede implements FonteConectividade {
  final _c = StreamController<bool>.broadcast();
  @override
  Future<bool> temRede() async => true;
  @override
  Stream<bool> get mudancas => _c.stream;
  void emitir(bool v) => _c.add(v);
}

void main() {
  late BancoLocal banco;
  late DateTime relogio;
  late _Rede rede;
  late ServidorFalso srv;
  late SincronizacaoService sync;

  setUp(() async {
    banco = await bancoEmMemoria();
    relogio = DateTime.utc(2026, 11, 10, 12);
    rede = _Rede();
    srv = ServidorFalso((c) async {
      if (c.caminho == '/vendas/sync') return (200, fixtureJson('sync'));
      if (c.caminho == '/vendas/resumo') return (200, fixtureJson('resumo'));
      return (404, {});
    });
    final api = ApiClient(
        tokens: MemoriaTokenStore(const Tokens('AT', 'RT')), client: srv.cliente, baseUrl: 'http://x/v1', tenant: 'cahu', appVersao: '9.9.9+1');
    sync = SincronizacaoService(
      api: api,
      carga: CargaRepository(banco),
      meta: MetaRepository(banco),
      conectividade: rede,
      agora: () => relogio,
    );
  });
  tearDown(() async {
    sync.dispose();
    await banco.fechar();
  });

  test('sincroniza: baixa carga e resumo, manda cabeçalho de versão, grava o espelho', () async {
    final r = await sync.sincronizar();
    expect(r.ok, isTrue);
    expect(srv.contar('GET', '/vendas/sync'), 1);
    final c = srv.chamadas.firstWhere((x) => x.caminho == '/vendas/sync');
    expect(c.cabecalhos['X-App-Versao'], '9.9.9+1');
    expect(c.cabecalhos['Authorization'], 'Bearer AT');
    expect(Sqflite.firstIntValue(await banco.db.rawQuery('SELECT COUNT(*) FROM clientes')), 4);
    expect(sync.ultimaSincronizacao, relogio);
    expect(sync.sincronizando, isFalse);
    expect(sync.online, isTrue);
    expect((await MetaRepository(banco).resumo())!.pedidosHoje, 7);
  });

  test('duas chamadas simultâneas compartilham uma sincronização', () async {
    final a = sync.sincronizar();
    final b = sync.sincronizar();
    await Future.wait([a, b]);
    expect(srv.contar('GET', '/vendas/sync'), 1);
  });

  test('sem internet: resultado semConexao, offline, espelho antigo preservado', () async {
    await sync.sincronizar();
    final api2 = ApiClient(
        tokens: MemoriaTokenStore(const Tokens('AT', 'RT')),
        client: ServidorFalso((c) async => throw Exception('sem rede')).cliente,
        baseUrl: 'http://x/v1',
        tenant: 'cahu');
    final off = SincronizacaoService(api: api2, carga: CargaRepository(banco), meta: MetaRepository(banco), conectividade: rede, agora: () => relogio);
    final r = await off.sincronizar();
    expect(r.situacao, SituacaoSync.semConexao);
    expect(off.online, isFalse);
    expect(off.ultimoErro, isNotNull);
    expect(Sqflite.firstIntValue(await banco.db.rawQuery('SELECT COUNT(*) FROM clientes')), 4);
    off.dispose();
  });

  test('falha no resumo não impede a carga', () async {
    final api = ApiClient(
        tokens: MemoriaTokenStore(const Tokens('AT', 'RT')),
        client: ServidorFalso((c) async {
          if (c.caminho == '/vendas/sync') return (200, fixtureJson('sync'));
          return (500, {'message': 'boom'});
        }).cliente,
        baseUrl: 'http://x/v1',
        tenant: 'cahu');
    final s = SincronizacaoService(api: api, carga: CargaRepository(banco), meta: MetaRepository(banco), conectividade: rede, agora: () => relogio);
    expect((await s.sincronizar()).ok, isTrue);
    expect(await MetaRepository(banco).resumo(), isNull);
    s.dispose();
  });

  test('sem sessão: não chama o servidor', () async {
    final s = SincronizacaoService(
        api: ApiClient(tokens: MemoriaTokenStore(), client: srv.cliente, baseUrl: 'http://x/v1', tenant: 'cahu'),
        carga: CargaRepository(banco),
        meta: MetaRepository(banco),
        conectividade: rede,
        agora: () => relogio);
    expect((await s.sincronizar()).situacao, SituacaoSync.sessaoExpirada);
    expect(srv.chamadas, isEmpty);
    s.dispose();
  });

  test('fila de envio (gancho da tarefa 7) roda antes da carga e falha dela não bloqueia', () async {
    final ordem = <String>[];
    sync.enviarFila = () async {
      ordem.add('fila');
      throw SemConexao();
    };
    await sync.sincronizar();
    expect(ordem, ['fila']);
    expect(srv.contar('GET', '/vendas/sync'), 1);
  });

  test('conexão que volta dispara sincronização', () async {
    await sync.iniciar();
    await Future<void>.delayed(const Duration(milliseconds: 100));
    final antes = srv.contar('GET', '/vendas/sync');
    rede.emitir(false);
    await Future<void>.delayed(Duration.zero);
    expect(sync.online, isFalse);
    rede.emitir(true);
    await Future<void>.delayed(const Duration(milliseconds: 200));
    expect(srv.contar('GET', '/vendas/sync'), antes + 1);
    expect(sync.online, isTrue);
  });

  group('dadosAntigos (limite de 12 h)', () {
    test('sem sincronização: semDados e não "antigos"', () {
      expect(sync.semDados, isTrue);
      expect(sync.dadosAntigos, isFalse);
    });

    test('fronteira: exatamente 12 h ainda vale; 12 h e 1 s é antigo', () async {
      await sync.sincronizar();
      expect(sync.semDados, isFalse);
      relogio = relogio.add(const Duration(hours: 11, minutes: 59, seconds: 59));
      expect(sync.dadosAntigos, isFalse);
      relogio = DateTime.utc(2026, 11, 10, 12).add(const Duration(hours: 12));
      expect(sync.dadosAntigos, isFalse);
      relogio = DateTime.utc(2026, 11, 10, 12).add(const Duration(hours: 12, seconds: 1));
      expect(sync.dadosAntigos, isTrue);
    });

    test('nova sincronização zera o aviso', () async {
      await sync.sincronizar();
      relogio = relogio.add(const Duration(hours: 13));
      expect(sync.dadosAntigos, isTrue);
      await sync.sincronizar();
      expect(sync.dadosAntigos, isFalse);
    });

    test('iniciar lê a última sincronização gravada (reabrir o app)', () async {
      await sync.sincronizar();
      final api = ApiClient(tokens: MemoriaTokenStore(), client: srv.cliente, baseUrl: 'http://x/v1', tenant: 'cahu');
      relogio = relogio.add(const Duration(hours: 20));
      final novo = SincronizacaoService(api: api, carga: CargaRepository(banco), meta: MetaRepository(banco), conectividade: rede, agora: () => relogio);
      await novo.iniciar();
      expect(novo.ultimaSincronizacao, DateTime.utc(2026, 11, 10, 12));
      expect(novo.dadosAntigos, isTrue);
      novo.dispose();
    });
  });
}
