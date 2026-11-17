import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:fluxo_vendas/app_servicos.dart';
import 'package:fluxo_vendas/core/api_exception.dart';
import 'package:fluxo_vendas/core/token_store.dart';
import 'package:fluxo_vendas/data/banco_local.dart';
import 'package:fluxo_vendas/data/meta_repository.dart';
import 'package:fluxo_vendas/services/conectividade.dart';
import 'package:fluxo_vendas/services/sessao_service.dart';

import 'suporte/banco_teste.dart';
import 'suporte/http_falso.dart';

class _RedeFalsa implements FonteConectividade {
  final _c = StreamController<bool>.broadcast();
  bool tem = true;
  @override
  Future<bool> temRede() async => tem;
  @override
  Stream<bool> get mudancas => _c.stream;
  void mudar(bool v) {
    tem = v;
    _c.add(v);
  }
}

void main() {
  late BancoLocal banco;
  late MemoriaTokenStore tokens;
  late _RedeFalsa rede;

  setUp(() async {
    banco = await bancoEmMemoria();
    tokens = MemoriaTokenStore();
    rede = _RedeFalsa();
  });
  tearDown(() => banco.fechar());

  AppServicos montar(ServidorFalso srv) => _semSync(AppServicos.criar(
        banco: banco,
        tokens: tokens,
        conectividade: rede,
        httpClient: srv.cliente,
        baseUrl: 'http://api.teste/v1',
        tenant: 'cahu',
      ));

  final login = {
    'accessToken': 'AT1',
    'refreshToken': 'RT1',
    'vendedor': {'id': 'v1', 'nome': 'ANA PAULA (TESTE)'},
    'distribuidora': 'CAHU Distribuidora',
  };

  group('login', () {
    test('guarda tokens e vendedor, manda X-Tenant e fica logado', () async {
      final srv = ServidorFalso((c) async {
        if (c.caminho == '/vendas/login') return (200, login);
        return (404, {'message': 'x'});
      });
      final s = montar(srv);
      await s.sessao.restaurar();
      expect(s.sessao.estado, EstadoSessao.deslogado);
      await s.sessao.entrar(' demo1 ', 'Senha@12345');
      expect(s.sessao.logado, isTrue);
      expect(s.sessao.vendedor!.nome, 'ANA PAULA (TESTE)');
      expect(srv.chamadas.single.cabecalhos['X-Tenant'], 'cahu');
      expect(srv.chamadas.single.cabecalhos.containsKey('Authorization'), isFalse);
      expect(srv.chamadas.single.corpo, contains('"login":"demo1"'));
      expect((await tokens.ler())!.refresh, 'RT1');
      expect(await MetaRepository(banco).distribuidora(), 'CAHU Distribuidora');
      
    });

    test('credenciais erradas viram ApiException com a mensagem do servidor', () async {
      final srv = ServidorFalso((c) async => (401, {'statusCode': 401, 'message': 'Usuário ou senha inválidos'}));
      final s = montar(srv);
      await s.sessao.restaurar();
      await expectLater(
          s.sessao.entrar('demo1', 'errada'),
          throwsA(isA<ApiException>().having((e) => e.message, 'message', 'Usuário ou senha inválidos').having((e) => e.statusCode, 'status', 401)));
      expect(s.sessao.logado, isFalse);
      expect(await tokens.ler(), isNull);
    });

    test('sem internet: SemConexao distinto', () async {
      final srv = ServidorFalso((c) async => throw Exception('socket'));
      final s = montar(srv);
      await expectLater(s.sessao.entrar('a', 'b'), throwsA(isA<SemConexao>()));
    });

    test('restaura a sessão offline ao reabrir o app (tokens + vendedor guardados)', () async {
      final srv = ServidorFalso((c) async => (200, login));
      final s1 = montar(srv);
      await s1.sessao.restaurar();
      await s1.sessao.entrar('demo1', 'x');
      

      final semRede = ServidorFalso((c) async => throw Exception('offline'));
      final s2 = montar(semRede);
      await s2.sessao.restaurar();
      expect(s2.sessao.logado, isTrue);
      expect(s2.sessao.vendedor!.id, 'v1');
      
    });
  });

  group('renovação de token', () {
    /// Servidor onde o access token AT1 está vencido e o refresh RT1 vale uma vez.
    ServidorFalso servidor({required Completer<void> segura, int Function()? contador, bool refreshRecusado = false}) {
      return ServidorFalso((c) async {
        if (c.caminho == '/vendas/login') return (200, login);
        if (c.caminho == '/vendas/refresh') {
          await segura.future;
          if (refreshRecusado) return (401, {'statusCode': 401, 'message': 'Sessão expirada. Entre novamente.'});
          return (200, {'accessToken': 'AT2', 'refreshToken': 'RT2'});
        }
        if (c.cabecalhos['Authorization'] == 'Bearer AT2') return (200, {'ok': true});
        return (401, {'statusCode': 401, 'message': 'Unauthorized'});
      });
    }

    test('várias chamadas com 401 ao mesmo tempo gastam UM refresh (single-flight)', () async {
      final segura = Completer<void>();
      final srv = servidor(segura: segura);
      final s = montar(srv);
      await s.sessao.restaurar();
      await s.sessao.entrar('demo1', 'x');
      

      final f = [for (var i = 0; i < 5; i++) s.api.get('/vendas/resumo')];
      await Future<void>.delayed(const Duration(milliseconds: 50));
      segura.complete();
      final r = await Future.wait(f);
      expect(r, everyElement({'ok': true}));
      expect(srv.contar('POST', '/vendas/refresh'), 1);
      expect((await tokens.ler())!.refresh, 'RT2');
      expect(s.sessao.logado, isTrue);
    });

    test('refresh recusado (401) => sessão encerrada com a mensagem de bloqueio, tokens apagados', () async {
      final segura = Completer<void>()..complete();
      final srv = servidor(segura: segura, refreshRecusado: true);
      final s = montar(srv);
      await s.sessao.restaurar();
      await s.sessao.entrar('demo1', 'x');
      

      await expectLater(s.api.get('/vendas/resumo'), throwsA(isA<ApiException>().having((e) => e.statusCode, 'status', 401)));
      await s.sessao.aguardarEncerramento();
      expect(s.sessao.estado, EstadoSessao.deslogado);
      expect(s.sessao.mensagem, mensagemAcessoBloqueado);
      expect(await tokens.ler(), isNull);
      expect(await MetaRepository(banco).vendedor(), isNull, reason: 'espelho/meta apagados');
    });

    test('sem rede durante o refresh NÃO derruba a sessão', () async {
      var offline = false;
      final srv = ServidorFalso((c) async {
        if (c.caminho == '/vendas/login') return (200, login);
        if (offline) throw Exception('sem rede');
        return (401, {'message': 'Unauthorized'});
      });
      final s = montar(srv);
      await s.sessao.restaurar();
      await s.sessao.entrar('demo1', 'x');
      
      offline = true;
      await expectLater(s.api.get('/vendas/resumo'), throwsA(isA<SemConexao>()));
      expect(s.sessao.logado, isTrue);
      expect((await tokens.ler())!.refresh, 'RT1');
    });

    test('depois de renovar, a repetição ainda 401 (vendedor desativado) encerra a sessão', () async {
      final srv = ServidorFalso((c) async {
        if (c.caminho == '/vendas/login') return (200, login);
        if (c.caminho == '/vendas/refresh') return (200, {'accessToken': 'AT2', 'refreshToken': 'RT2'});
        return (401, {'statusCode': 401, 'message': 'Acesso desativado', 'codigo': 'VENDEDOR_DESATIVADO'});
      });
      final s = montar(srv);
      await s.sessao.restaurar();
      await s.sessao.entrar('demo1', 'x');
      
      await expectLater(s.api.get('/vendas/sync'), throwsA(isA<ApiException>()));
      await s.sessao.aguardarEncerramento();
      expect(s.sessao.estado, EstadoSessao.deslogado);
      expect(s.sessao.mensagem, mensagemAcessoBloqueado);
    });
  });

  group('sair', () {
    test('limpa tokens e espelho local', () async {
      final srv = ServidorFalso((c) async {
        if (c.caminho == '/vendas/login') return (200, login);
        if (c.caminho == '/vendas/sync') return (200, fixtureJson('sync'));
        if (c.caminho == '/vendas/resumo') return (200, fixtureJson('resumo'));
        return (404, {});
      });
      final s = montar(srv);
      await s.sessao.restaurar();
      await s.sessao.entrar('demo1', 'x');
      await s.sincronizacao.sincronizar();
      expect(await s.clientes.contar(), 4);
      await s.sessao.sair();
      expect(s.sessao.estado, EstadoSessao.deslogado);
      expect(s.sessao.mensagem, isNull);
      expect(await tokens.ler(), isNull);
      expect(await s.clientes.contar(), 0);
      expect(await s.meta.vendedor(), isNull);
    });
  });
}

/// Nos testes de sessão a sincronização automática fica desligada (ela tem testes próprios).
AppServicos _semSync(AppServicos s) {
  s.sessao.aoLogar = null;
  s.sessao.aoDeslogar = null;
  return s;
}
