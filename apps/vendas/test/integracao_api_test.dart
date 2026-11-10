@Tags(['integracao'])
library;

import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:fluxo_vendas/app_servicos.dart';
import 'package:fluxo_vendas/core/token_store.dart';
import 'package:fluxo_vendas/services/conectividade.dart';

import 'suporte/banco_teste.dart';

class _Rede implements FonteConectividade {
  @override
  Future<bool> temRede() async => true;
  @override
  Stream<bool> get mudancas => const Stream.empty();
}

/// Teste de INTEGRACAO contra a API de teste local (cópia descartável do banco).
/// Pulado por padrão. Para rodar:
///   VENDAS_API_INTEGRACAO=http://localhost:3099/v1 flutter test test/integracao_api_test.dart
/// Só chama login, sync e resumo (nada que crie pedido ou orçamento).
void main() {
  final url = Platform.environment['VENDAS_API_INTEGRACAO'];
  test('login + sync + resumo reais (demo1)', () async {
    final banco = await bancoEmMemoria();
    final s = AppServicos.criar(banco: banco, tokens: MemoriaTokenStore(), conectividade: _Rede(), baseUrl: url, tenant: 'cahu');
    s.sessao.aoLogar = null;
    await s.sessao.restaurar();
    await s.sessao.entrar('demo1', 'Senha@12345');
    final r = await s.sincronizacao.sincronizar();
    expect(r.ok, isTrue, reason: r.mensagem);
    expect(await s.clientes.contar(), greaterThan(0));
    expect(await s.produtos.contar(), greaterThan(100));
    final tabelas = await s.tabelas.listar();
    expect(tabelas, isNotEmpty);
    final p = await s.produtos.buscar(tabelaId: tabelas.first.tabela.id, limite: 5);
    expect(p.every((x) => x.preco != null), isTrue);
    expect((await s.meta.resumo())!.clientesCarteira, greaterThan(0));
    await s.sessao.sair();
    await banco.fechar();
  }, skip: url == null ? 'defina VENDAS_API_INTEGRACAO para rodar' : false);
}
