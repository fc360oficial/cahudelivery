@Tags(['integracao'])
library;

import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:fluxo_vendas/data/pedido_local.dart';
import 'package:fluxo_vendas/data/situacao_pedido.dart';
import 'package:fluxo_vendas/services/fila_envio_service.dart';
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
/// O 1º teste só chama login, sync e resumo. O 2º cria 1 pedido e 1 orçamento (na cópia descartável).
/// O 3º cria 3 pedidos (2 retidos por preço) e 1 orçamento: confirmar, cancelar e converter.
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

  test('pedido e orçamento reais pela fila (demo2): envia, reenvio do mesmo id não duplica, orçamento por PUT', () async {
    final banco = await bancoEmMemoria();
    final s = AppServicos.criar(banco: banco, tokens: MemoriaTokenStore(), conectividade: _Rede(), baseUrl: url, tenant: 'cahu');
    s.sessao.aoLogar = null;
    await s.sessao.restaurar();
    await s.sessao.entrar('demo2', 'Senha@12345');
    expect((await s.sincronizacao.sincronizar()).ok, isTrue);

    final cliente = (await s.clientes.buscar()).firstWhere((c) => !c.bloqueado && c.temCadastroErp && c.endereco != null);
    final tabela = (await s.tabelas.listar()).firstWhere((t) => t.formas.isNotEmpty);
    final produtos = await s.produtos.buscar(tabelaId: tabela.tabela.id, somenteComPreco: true, somenteComEstoque: true, limite: 2);
    expect(produtos, isNotEmpty);

    s.carrinho.iniciar(cliente);
    await s.carrinho.escolherTabela(tabela);
    if (s.carrinho.forma == null) s.carrinho.escolherForma(tabela.formas.first);
    for (final p in produtos) {
      s.carrinho.definirQuantidade(p, 1);
    }
    final itens = s.carrinho.itens.map((i) => i.paraEnvio()).toList();

    final r = await s.fila.enviarPedido(NovoPedido(
      clienteId: cliente.id,
      tabelaId: tabela.tabela.id,
      formaId: s.carrinho.forma!.id,
      itens: itens,
      total: s.carrinho.total,
      observacoes: 'Teste de integração do app',
    ));
    // com o espelho recém-baixado nada diverge: aceito (ou retido, se o crédito do cliente de teste estourar)
    expect([DesfechoEnvio.enviado, DesfechoEnvio.retido], contains(r.desfecho), reason: r.mensagem);
    expect(r.numero, isNotNull);

    // reenvio do MESMO corpo (rede perdeu a resposta): o servidor devolve o mesmo pedido
    final local = (await s.pedidosLocais.porId(r.id))!;
    final reenvio = await s.api.post('/vendas/pedidos', body: local.corpo) as Map<String, dynamic>;
    expect((reenvio['numero'] as num).toInt(), r.numero);

    final o = await s.fila.salvarOrcamento(NovoOrcamento(
      clienteId: cliente.id, tabelaId: tabela.tabela.id, itens: itens, total: s.carrinho.total, formaId: s.carrinho.forma!.id));
    expect(o.desfecho, DesfechoEnvio.enviado, reason: o.mensagem);
    expect((await s.orcamentosLocais.porId(o.id))!.estado, EstadoOrcamento.sincronizado);

    await s.sessao.sair();
    await banco.fechar();
  }, skip: url == null ? 'defina VENDAS_API_INTEGRACAO para rodar' : false);

  test('retidos e orçamento reais (demo3): confirmar com valores atuais, cancelar retido e converter orçamento', () async {
    final banco = await bancoEmMemoria();
    final s = AppServicos.criar(banco: banco, tokens: MemoriaTokenStore(), conectividade: _Rede(), baseUrl: url, tenant: 'cahu');
    s.sessao.aoLogar = null;
    await s.sessao.restaurar();
    await s.sessao.entrar('demo3', 'Senha@12345');
    expect((await s.sincronizacao.sincronizar()).ok, isTrue);

    final cliente = (await s.clientes.buscar()).firstWhere((c) => !c.bloqueado && c.temCadastroErp && c.endereco != null);
    final tabelas = await s.tabelas.listar();
    // forma que não confere crédito: o único motivo de retenção do teste é o preço errado
    final tabela = tabelas.firstWhere((t) => t.formas.any((f) => !f.exigeCredito), orElse: () => tabelas.firstWhere((t) => t.formas.isNotEmpty));
    final forma = tabela.formas.firstWhere((f) => !f.exigeCredito, orElse: () => tabela.formas.first);
    final produtos = await s.produtos.buscar(tabelaId: tabela.tabela.id, somenteComPreco: true, somenteComEstoque: true, limite: 1);
    final p = produtos.single;
    final preco = p.preco!;

    Future<ResultadoEnvio> enviar(double precoEnviado, {String? orcamentoId}) {
      final i = ItemEnvio(produtoId: p.produto.id, quantidade: 1, precoUnit: precoEnviado);
      return s.fila.enviarPedido(NovoPedido(
        clienteId: cliente.id,
        tabelaId: tabela.tabela.id,
        formaId: forma.id,
        itens: [i],
        total: precoEnviado,
        observacoes: 'Teste de integração (retidos)',
        orcamentoId: orcamentoId,
      ));
    }

    // 1) preço errado: retido por preço; aparece na lista do servidor; confirmar -> RECEBIDO com o preço do servidor
    final retido = await enviar(preco + 1);
    expect(retido.desfecho, DesfechoEnvio.retido, reason: retido.mensagem);
    expect(retido.divergencias.map((d) => d.tipo), contains('preco'));
    expect(await s.pedidos.reconciliar(), isTrue);
    var local = (await s.pedidosLocais.porId(retido.id))!;
    expect(local.estado, EstadoPedido.retido);
    expect((await s.pedidosLocais.listar()).where((x) => x.id == retido.id).length, 1, reason: 'sem duplicar');
    final r1 = await s.pedidos.confirmar(local);
    expect(r1.confirmado, isTrue, reason: r1.mensagem);
    local = (await s.pedidosLocais.porId(retido.id))!;
    expect(local.estado, EstadoPedido.enviado);
    expect(local.statusServidor, 'RECEBIDO');
    expect(local.totalServidor, preco, reason: 'o servidor confirmou com o preço atual da tabela');
    expect(local.itens.single.precoUnit, preco);
    await s.pedidos.reconciliar();
    expect((await s.pedidosLocais.porId(retido.id))!.statusServidor, 'RECEBIDO');

    // 2) outro retido por preço: cancelar
    final retido2 = await enviar(preco + 2);
    expect(retido2.desfecho, DesfechoEnvio.retido, reason: retido2.mensagem);
    expect(await s.pedidos.cancelarRetido((await s.pedidosLocais.porId(retido2.id))!), isTrue);
    await s.pedidos.reconciliar();
    final cancelado = (await s.pedidosLocais.porId(retido2.id))!;
    expect(cancelado.estado, EstadoPedido.cancelado);
    expect(cancelado.statusServidor, 'CANCELADO');
    expect(situacaoDe(cancelado), SituacaoPedido.cancelado);

    // 3) orçamento -> pedido (preço certo): o servidor marca o orçamento como convertido
    final o = await s.fila.salvarOrcamento(NovoOrcamento(
        clienteId: cliente.id,
        tabelaId: tabela.tabela.id,
        formaId: forma.id,
        total: preco,
        itens: [ItemEnvio(produtoId: p.produto.id, quantidade: 1, precoUnit: preco)]));
    expect(o.desfecho, DesfechoEnvio.enviado, reason: o.mensagem);
    final convertido = await enviar(preco, orcamentoId: o.id);
    expect([DesfechoEnvio.enviado, DesfechoEnvio.retido], contains(convertido.desfecho), reason: convertido.mensagem);
    expect((await s.orcamentosLocais.porId(o.id))!.estado, EstadoOrcamento.convertido);
    await s.pedidos.reconciliar();
    final q = (await s.orcamentosLocais.porId(o.id))!;
    expect(q.estado, EstadoOrcamento.convertido);
    expect(q.pedidoId, isNotNull);
    expect((await s.pedidosLocais.porServidorId(q.pedidoId!))!.id, convertido.id);

    await s.sessao.sair();
    await banco.fechar();
  }, skip: url == null ? 'defina VENDAS_API_INTEGRACAO para rodar' : false);
}
