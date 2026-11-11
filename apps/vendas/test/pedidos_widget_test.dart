import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:fluxo_vendas/app_servicos.dart';
import 'package:fluxo_vendas/core/tema.dart';
import 'package:fluxo_vendas/core/token_store.dart';
import 'package:fluxo_vendas/data/banco_local.dart';
import 'package:fluxo_vendas/data/pedido_local.dart';
import 'package:fluxo_vendas/data/situacao_pedido.dart';
import 'package:fluxo_vendas/features/catalogo/catalogo_page.dart';
import 'package:fluxo_vendas/features/mais/mais_page.dart';
import 'package:fluxo_vendas/features/orcamentos/orcamentos_page.dart';
import 'package:fluxo_vendas/features/pedidos/painel_retido.dart';
import 'package:fluxo_vendas/features/pedidos/pedido_detalhe_page.dart';
import 'package:fluxo_vendas/features/pedidos/pedidos_page.dart';
import 'package:fluxo_vendas/features/shell/home_shell.dart';
import 'package:fluxo_vendas/services/conectividade.dart';
import 'package:http/http.dart' as http;
import 'package:intl/date_symbol_data_local.dart';

import 'suporte/banco_teste.dart';
import 'suporte/http_falso.dart';
import 'suporte/pedido_teste.dart';

class _Rede implements FonteConectividade {
  @override
  Future<bool> temRede() async => true;
  @override
  Stream<bool> get mudancas => const Stream.empty();
}

/// Telas de Pedidos, retidos, Orçamentos, Catálogo e Mais a 360 dp de largura, em fonte normal e 1,3x.
/// O flutter_test falha sozinho se algo estourar a tela (overflow).
void main() {
  late AppServicos s;
  late BancoLocal banco;
  late ServidorFalso srv;

  /// O que o servidor falso responde além das listas vazias (cada teste troca).
  late Future<(int, Object?)> Function(Chamada c) rota;

  Future<void> assentar(WidgetTester t) async {
    for (var i = 0; i < 5; i++) {
      await t.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 40)));
      await t.pump(const Duration(milliseconds: 50));
    }
    await t.pump(const Duration(milliseconds: 400)); // termina a animação de rota (senão o toque cai no IgnorePointer)
  }

  tearDown(() async {
    await banco.fechar();
  });

  Widget arvore(Widget tela, double escala) => Servicos(
        servicos: s,
        child: MaterialApp(
          theme: construirTema(),
          locale: const Locale('pt', 'BR'),
          supportedLocales: const [Locale('pt', 'BR')],
          localizationsDelegates: const [
            GlobalMaterialLocalizations.delegate,
            GlobalWidgetsLocalizations.delegate,
            GlobalCupertinoLocalizations.delegate,
          ],
          builder: (ctx, child) => MediaQuery(data: MediaQuery.of(ctx).copyWith(textScaler: TextScaler.linear(escala)), child: child!),
          home: tela,
        ),
      );

  Future<void> montar(WidgetTester t, Widget tela, {double escala = 1.0}) async {
    t.view.physicalSize = const Size(360, 740);
    t.view.devicePixelRatio = 1;
    addTearDown(t.view.resetPhysicalSize);
    addTearDown(t.view.resetDevicePixelRatio);
    rota = (c) async => (404, {'statusCode': 404, 'message': 'Não encontrado'});
    await t.runAsync(() async {
      await initializeDateFormatting('pt_BR');
      banco = await bancoEmMemoria();
      await semear(banco);
      srv = ServidorFalso((c) async {
        if (c.metodo == 'GET' && (c.caminho == '/vendas/pedidos' || c.caminho == '/vendas/orcamentos')) return (200, <Object?>[]);
        return rota(c);
      });
      s = AppServicos.criar(
          banco: banco, tokens: MemoriaTokenStore(const Tokens('AT', 'RT')), conectividade: _Rede(), httpClient: srv.cliente, baseUrl: 'http://x/v1', tenant: 'cahu');
      s.sessao.aoLogar = null; // sem sincronização automática: os testes controlam o servidor falso
      await s.sessao.restaurar();
    });
    await t.pumpWidget(arvore(tela, escala));
    await assentar(t);
  }

  /// Rola a faixa de chips até o chip aparecer (os de fora da tela só são criados ao rolar) e toca nele.
  Future<void> tocarChip(WidgetTester t, String rotulo, {String chave = 'filtros-pedidos'}) async {
    final faixa = find.descendant(of: find.byKey(Key(chave)), matching: find.byType(Scrollable)).first;
    for (var i = 0; i < 8; i++) {
      if (find.text(rotulo).evaluate().isNotEmpty && t.getCenter(find.text(rotulo)).dx < 300) break;
      await t.drag(faixa, const Offset(-120, 0));
      await t.pump(const Duration(milliseconds: 100));
    }
    await t.tap(find.text(rotulo));
    await assentar(t);
  }

  /// Rola a tela de detalhe (ListView lazy): [dy] negativo desce, positivo sobe.
  Future<void> rolar(WidgetTester t, double dy, {Finder? lista}) async {
    await t.drag(lista ?? find.byKey(const Key('detalhe-lista')), Offset(0, dy));
    await assentar(t);
  }

  /// Rola o detalhe até o [alvo] ficar dentro da tela (o ensureVisible não alcança itens ainda não criados).
  Future<void> trazer(WidgetTester t, Finder alvo) async {
    for (var i = 0; i < 10; i++) {
      if (alvo.evaluate().isNotEmpty && t.getCenter(alvo).dy < 660) return;
      await rolar(t, -250);
    }
  }

  var seq = 0;
  PedidoLocal pedidoLocal(
    String estado, {
    String? id,
    String? status,
    int? numero,
    double total = 30.23,
    List<Map<String, Object?>>? divergencias,
    String? motivo,
    String? orcamentoId,
    DateTime? criadoEm,
  }) {
    final n = ++seq;
    final pid = id ?? '00000000-0000-4000-8000-${n.toString().padLeft(12, '0')}';
    final quando = criadoEm ?? DateTime.utc(2026, 11, 10, 15, n);
    return PedidoLocal(
      id: pid,
      vendedorId: Ids.vendedor,
      clienteId: Ids.clienteOk,
      tabelaId: Ids.tabEntrega,
      formaId: Ids.boleto,
      total: total,
      estado: estado,
      corpo: {
        'idDispositivo': pid,
        'clienteId': Ids.clienteOk,
        'tabelaPrecoId': Ids.tabEntrega,
        'formaPagamentoId': Ids.boleto,
        'observacoes': 'Entregar de manhã',
        'orcamentoId': ?orcamentoId,
        'itens': [
          {'produtoId': Ids.p1, 'quantidade': 3, 'precoUnit': 10.075},
        ],
      },
      resposta: status == null
          ? null
          : {'id': 'srv-$pid', 'numero': numero ?? 100 + n, 'status': status, 'total': total, 'divergencias': divergencias ?? const []},
      motivo: motivo,
      servidorNumero: status == null ? null : (numero ?? 100 + n),
      criadoEm: quando,
      atualizadoEm: quando,
      enviadoEm: status == null ? null : quando,
    );
  }

  Future<void> inserir(WidgetTester t, List<PedidoLocal> lista) async {
    await t.runAsync(() async {
      for (final p in lista) {
        await s.pedidosLocais.inserir(p);
      }
      await s.fila.atualizarContadores();
    });
  }

  const divergPreco = [
    {'tipo': 'preco', 'produtoId': Ids.p1, 'nome': 'Arroz 5kg', 'enviado': 10, 'atual': 11},
  ];

  for (final escala in [1.0, 1.3]) {
    final sufixo = escala == 1.0 ? '' : ' (fonte 1,3x)';

    testWidgets('lista de Pedidos: pílulas, número, filtros e vazio por filtro$sufixo', (t) async {
      await montar(t, const Scaffold(body: PedidosPage()), escala: escala);
      expect(find.byKey(const Key('vazio-pedidos')), findsOneWidget);
      expect(find.text('Nenhum pedido ainda'), findsOneWidget);

      await inserir(t, [
        pedidoLocal(EstadoPedido.aguardandoEnvio),
        pedidoLocal(EstadoPedido.retido, status: 'AGUARDANDO_VENDEDOR', numero: 41, divergencias: divergPreco),
        pedidoLocal(EstadoPedido.enviado, status: 'RECEBIDO', numero: 42),
        pedidoLocal(EstadoPedido.enviado, status: 'FATURADO', numero: 43, total: 12345.67),
        pedidoLocal(EstadoPedido.recusado, motivo: 'Cliente bloqueado. Fale com o supervisor.'),
        pedidoLocal(EstadoPedido.cancelado, status: 'CANCELADO', numero: 44),
      ]);
      await t.runAsync(() => s.pedidos.reconciliar()); // só para a lista recarregar
      await assentar(t);

      for (final f in FiltroPedido.values) {
        if (f.index < 2) expect(find.text(f.rotulo), findsWidgets, reason: 'chip ${f.rotulo}');
      }
      expect(find.text('Mercado Bom'), findsNWidgets(6));
      expect(find.textContaining('Pedido nº 43'), findsOneWidget);
      expect(find.text('Faturado'), findsOneWidget);
      expect(find.text('Aguardando o ERP'), findsOneWidget);
      expect(find.text('Retido'), findsOneWidget);
      expect(find.text('Na fila'), findsWidgets);
      expect(find.text('Recusado'), findsOneWidget);
      expect(find.text('Cancelado'), findsOneWidget);

      // filtro Retidos: só o retido
      await tocarChip(t, 'Retidos');
      expect(find.text('Mercado Bom'), findsOneWidget);
      expect(find.text('Retido'), findsWidgets);
      expect(find.text('Faturado'), findsNothing);

      // filtro Faturados / Cancelados e recusados
      await tocarChip(t, 'Faturados');
      expect(find.text('Mercado Bom'), findsOneWidget);
      await tocarChip(t, 'Cancelados e recusados');
      expect(find.text('Mercado Bom'), findsNWidgets(2));
    });

    testWidgets('filtro sem resultado mostra o estado vazio do filtro$sufixo', (t) async {
      await montar(t, const Scaffold(body: PedidosPage()), escala: escala);
      await inserir(t, [pedidoLocal(EstadoPedido.enviado, status: 'RECEBIDO')]);
      await t.runAsync(() => s.pedidos.reconciliar());
      await assentar(t);
      await tocarChip(t, 'Retidos');
      expect(find.byKey(const Key('vazio-filtro')), findsOneWidget);
      expect(find.text('Nenhum pedido retido'), findsOneWidget);
    });

    testWidgets('painel de pedido retido: motivos em palavras, enviado → atual e novo total$sufixo', (t) async {
      final p = pedidoLocal(EstadoPedido.retido, status: 'AGUARDANDO_VENDEDOR', numero: 50, divergencias: [
        ...divergPreco,
        {'tipo': 'sem_preco', 'produtoId': Ids.p3, 'nome': 'Açúcar 1kg'},
        {'tipo': 'estoque', 'produtoId': Ids.p2, 'nome': 'Feijão 1kg', 'enviado': 5, 'atual': 2},
        {'tipo': 'credito', 'enviado': 33, 'atual': 20},
      ]);
      var confirmou = 0, cancelou = 0;
      Widget painel({required bool online, bool ocupado = false}) => Scaffold(
            body: SingleChildScrollView(
              padding: const EdgeInsets.all(16),
              child: PainelRetido(pedido: p, online: online, ocupado: ocupado, aoConfirmar: () => confirmou++, aoCancelar: () => cancelou++),
            ),
          );
      await montar(t, painel(online: true), escala: escala);
      expect(find.text('Este pedido está retido'), findsOneWidget);
      expect(find.text('Preço mudou'), findsOneWidget);
      expect(find.text('Produto sem preço'), findsOneWidget);
      expect(find.text('Sem estoque suficiente'), findsOneWidget);
      expect(find.text('Limite de crédito'), findsOneWidget);
      expect(find.textContaining('o preço mudou de R\$ 10,00 para R\$ 11,00'), findsOneWidget);
      expect(find.text('Enviado R\$ 10,00 → atual R\$ 11,00'), findsOneWidget);
      expect(find.text('Pedido 5 → estoque 2'), findsOneWidget);
      expect(find.text('Novo total se confirmar'), findsOneWidget);
      expect(find.text('R\$ 33,00'), findsOneWidget, reason: '3 x 11,00');
      expect(find.byKey(const Key('aviso-nao-confirma')), findsOneWidget);
      expect(find.byKey(const Key('aviso-offline')), findsNothing);
      await t.ensureVisible(find.byKey(const Key('confirmar-valores')));
      await t.tap(find.byKey(const Key('confirmar-valores')));
      await t.ensureVisible(find.byKey(const Key('cancelar-pedido')));
      await t.tap(find.byKey(const Key('cancelar-pedido')));
      expect((confirmou, cancelou), (1, 1));
      expect(t.getSize(find.byKey(const Key('confirmar-valores'))).height, greaterThanOrEqualTo(48));
      expect(t.getSize(find.byKey(const Key('cancelar-pedido'))).height, greaterThanOrEqualTo(48));

      await t.pumpWidget(arvore(painel(online: false), escala));
      await assentar(t);
      expect(find.text('Conecte-se à internet para confirmar ou cancelar.'), findsOneWidget);
      expect(t.widget<FilledButton>(find.byKey(const Key('confirmar-valores'))).onPressed, isNull);
      expect(t.widget<OutlinedButton>(find.byKey(const Key('cancelar-pedido'))).onPressed, isNull);
    });
  }

  testWidgets('detalhe do retido: confirmar com os valores atuais mostra o resultado e tira o painel', (t) async {
    await montar(t, const Scaffold(body: PedidosPage()), escala: 1.3);
    final p = pedidoLocal(EstadoPedido.retido, status: 'AGUARDANDO_VENDEDOR', numero: 50, divergencias: divergPreco);
    await inserir(t, [p]);
    rota = (c) async => c.caminho == '/vendas/pedidos/srv-${p.id}/confirmar'
        ? (200, {'id': 'srv-${p.id}', 'numero': 50, 'status': 'RECEBIDO', 'total': 33, 'divergencias': const []})
        : (404, {});
    await t.runAsync(() => s.pedidos.reconciliar());
    await assentar(t);

    await t.tap(find.text('Mercado Bom'));
    await assentar(t);
    expect(find.byType(PedidoDetalhePage), findsOneWidget);
    expect(find.byKey(const Key('painel-retido')), findsOneWidget);
    expect(find.text('Pedido nº 50'), findsOneWidget);
    await rolar(t, -900);
    expect(find.text('Arroz 5kg'), findsOneWidget);
    await trazer(t, find.byKey(const Key('confirmar-valores')));
    await t.tap(find.byKey(const Key('confirmar-valores')));
    await assentar(t);

    await rolar(t, 1500);
    expect(find.byKey(const Key('painel-retido')), findsNothing);
    expect(find.byKey(const Key('aviso-confirmado')), findsOneWidget);
    expect(find.textContaining('Novo total: R\$ 33,00'), findsOneWidget);
    expect(find.text('Aguardando o ERP'), findsOneWidget);
    await rolar(t, -2500);
    expect(find.textContaining('Confirmado com os valores atuais'), findsOneWidget);
    expect(srv.contar('POST', '/vendas/pedidos/srv-${p.id}/confirmar'), 1);
  });

  testWidgets('detalhe do retido: divergência que sobrou mantém o painel e mostra o que ainda barra', (t) async {
    await montar(t, const Scaffold(body: PedidosPage()));
    final p = pedidoLocal(EstadoPedido.retido, status: 'AGUARDANDO_VENDEDOR', numero: 51, divergencias: divergPreco);
    await inserir(t, [p]);
    rota = (c) async => (
          409,
          {
            'statusCode': 409,
            'message': 'x',
            'codigo': 'AINDA_DIVERGENTE',
            'divergencias': [
              {'tipo': 'estoque', 'produtoId': Ids.p1, 'nome': 'Arroz 5kg', 'enviado': 3, 'atual': 1},
            ],
          }
        );
    await t.runAsync(() => s.pedidos.reconciliar());
    await assentar(t);
    await t.tap(find.text('Mercado Bom'));
    await assentar(t);
    await trazer(t, find.byKey(const Key('confirmar-valores')));
    await t.tap(find.byKey(const Key('confirmar-valores')));
    await assentar(t);

    await rolar(t, 1500);
    expect(find.byKey(const Key('ainda-bloqueado')), findsOneWidget);
    expect(find.text('Ainda não dá para confirmar'), findsOneWidget);
    expect(find.byKey(const Key('painel-retido')), findsOneWidget, reason: 'continua retido');
    expect(find.text('Sem estoque suficiente'), findsOneWidget);
    expect((await t.runAsync(() => s.pedidosLocais.porId(p.id)))!.estado, EstadoPedido.retido);
  });

  testWidgets('detalhe do retido: cancelar pede confirmação e cancela', (t) async {
    await montar(t, const Scaffold(body: PedidosPage()));
    final p = pedidoLocal(EstadoPedido.retido, status: 'AGUARDANDO_VENDEDOR', numero: 52, divergencias: divergPreco);
    await inserir(t, [p]);
    rota = (c) async => c.metodo == 'POST' ? (200, {'ok': true}) : (404, {});
    await t.runAsync(() => s.pedidos.reconciliar());
    await assentar(t);
    await t.tap(find.text('Mercado Bom'));
    await assentar(t);
    await trazer(t, find.byKey(const Key('cancelar-pedido')));
    await t.tap(find.byKey(const Key('cancelar-pedido')));
    await assentar(t);
    expect(find.text('Cancelar este pedido?'), findsOneWidget);
    await t.tap(find.text('Voltar'));
    await assentar(t);
    expect(srv.contar('POST', '/vendas/pedidos/srv-${p.id}/cancelar'), 0);

    await trazer(t, find.byKey(const Key('cancelar-pedido')));
    await t.tap(find.byKey(const Key('cancelar-pedido')));
    await assentar(t);
    await t.tap(find.widgetWithText(FilledButton, 'Cancelar pedido'));
    await assentar(t);
    expect(srv.contar('POST', '/vendas/pedidos/srv-${p.id}/cancelar'), 1);
    expect(find.byKey(const Key('painel-retido')), findsNothing);
    expect(find.text('Cancelado'), findsWidgets);
  });

  testWidgets('detalhe do retido sem internet: avisa e desliga confirmar e cancelar', (t) async {
    await montar(t, const Scaffold(body: PedidosPage()));
    final p = pedidoLocal(EstadoPedido.retido, status: 'AGUARDANDO_VENDEDOR', numero: 53, divergencias: divergPreco);
    await inserir(t, [p]);
    rota = (c) async => throw http.ClientException('sem rede');
    await t.runAsync(() => s.sincronizacao.sincronizar());
    expect(s.sincronizacao.online, isFalse);
    await t.runAsync(() => s.pedidos.reconciliar());
    await assentar(t);
    await t.tap(find.text('Mercado Bom'));
    await assentar(t);
    expect(find.text('Conecte-se à internet para confirmar ou cancelar.', skipOffstage: false), findsOneWidget);
    await t.ensureVisible(find.byKey(const Key('confirmar-valores')));
    expect(t.widget<FilledButton>(find.byKey(const Key('confirmar-valores'))).onPressed, isNull);
    expect(t.widget<OutlinedButton>(find.byKey(const Key('cancelar-pedido'))).onPressed, isNull);
  });

  testWidgets('detalhe do recusado: motivo, Editar e reenviar abre a revisão com os itens e tira o recusado da lista', (t) async {
    await montar(t, const Scaffold(body: PedidosPage()), escala: 1.3);
    final p = pedidoLocal(EstadoPedido.recusado, motivo: 'Cliente bloqueado. Fale com o supervisor.');
    await inserir(t, [p]);
    await t.runAsync(() => s.pedidos.reconciliar());
    await assentar(t);
    await t.tap(find.text('Mercado Bom'));
    await assentar(t);
    expect(find.byKey(const Key('motivo-recusa')), findsOneWidget);
    expect(find.text('Cliente bloqueado. Fale com o supervisor.'), findsOneWidget);
    await trazer(t, find.byKey(const Key('editar-reenviar')));
    await t.tap(find.byKey(const Key('editar-reenviar')));
    await assentar(t);

    expect(find.text('Revisar pedido'), findsOneWidget);
    await rolar(t, -900, lista: find.byType(ListView).last);
    expect(find.text('Arroz 5kg'), findsOneWidget);
    expect(s.carrinho.itens.single.quantidade, 3);
    expect(s.carrinho.cliente!.id, Ids.clienteOk);
    expect(s.carrinho.observacoes, 'Entregar de manhã');
    expect(await t.runAsync(() => s.pedidosLocais.porId(p.id)), isNull, reason: 'o recusado virou rascunho');
    await t.runAsync(() => s.carrinho.aguardarGravacao());
  });

  testWidgets('detalhe do pedido na fila: Cancelar envio tira da fila e nunca envia', (t) async {
    await montar(t, const Scaffold(body: PedidosPage()));
    final p = pedidoLocal(EstadoPedido.aguardandoEnvio);
    await inserir(t, [p]);
    await t.runAsync(() => s.pedidos.reconciliar());
    await assentar(t);
    await t.tap(find.text('Mercado Bom'));
    await assentar(t);
    expect(find.byKey(const Key('tentar-enviar')), findsOneWidget);
    await trazer(t, find.byKey(const Key('cancelar-envio')));
    await t.tap(find.byKey(const Key('cancelar-envio')));
    await assentar(t);
    await t.tap(find.widgetWithText(FilledButton, 'Cancelar envio'));
    await assentar(t);
    expect(find.byKey(const Key('tentar-enviar')), findsNothing);
    expect(find.text('Cancelado'), findsWidgets);
    expect(srv.contar('POST', '/vendas/pedidos'), 0);
  });

  Future<void> inserirOrcamento(WidgetTester t, {required String id, String estado = EstadoOrcamento.sincronizado, double total = 8, double preco = 4, String? pedidoId}) async {
    final quando = DateTime.utc(2026, 11, 10, 16);
    await t.runAsync(() async {
      await s.orcamentosLocais.inserir(OrcamentoLocal(
        id: id,
        vendedorId: Ids.vendedor,
        clienteId: Ids.clienteOk,
        tabelaId: Ids.tabEntrega,
        formaId: Ids.boleto,
        total: total,
        estado: estado,
        corpo: {
          'clienteId': Ids.clienteOk,
          'tabelaPrecoId': Ids.tabEntrega,
          'formaPagamentoId': Ids.boleto,
          'itens': [
            {'produtoId': Ids.p2, 'quantidade': 2, 'precoUnit': preco},
          ],
        },
        resposta: {'id': id, 'status': 'aberto', 'total': total, 'pedidoId': ?pedidoId},
        criadoEm: quando,
        atualizadoEm: quando,
      ));
    });
  }

  for (final escala in [1.0, 1.3]) {
    final sufixo = escala == 1.0 ? '' : ' (fonte 1,3x)';
    testWidgets('lista de Orçamentos e detalhe com Editar, Transformar em pedido e Cancelar$sufixo', (t) async {
      await montar(t, const OrcamentosPage(), escala: escala);
      expect(find.byKey(const Key('vazio-orcamentos')), findsOneWidget);
      await inserirOrcamento(t, id: 'orc-1');
      await inserirOrcamento(t, id: 'orc-2', estado: EstadoOrcamento.local);
      await inserirOrcamento(t, id: 'orc-3', estado: EstadoOrcamento.convertido, pedidoId: 'srv-x');
      await t.runAsync(() => s.pedidos.reconciliar());
      await assentar(t);
      expect(find.text('Aberto'), findsOneWidget);
      expect(find.text('Aguardando envio'), findsWidgets);
      expect(find.text('Convertido'), findsWidgets);
      await tocarChip(t, 'Abertos', chave: 'filtros-orcamentos');
      expect(find.text('Mercado Bom'), findsOneWidget);

      await t.tap(find.text('Mercado Bom'));
      await assentar(t);
      expect(find.text('Feijão 1kg'), findsOneWidget);
      expect(find.byKey(const Key('transformar-pedido')), findsOneWidget);
      expect(find.byKey(const Key('editar-orcamento')), findsOneWidget);
      await trazer(t, find.byKey(const Key('cancelar-orcamento')));
      expect(t.getSize(find.byKey(const Key('cancelar-orcamento'))).height, greaterThanOrEqualTo(48));
    });
  }

  testWidgets('orçamento: Transformar em pedido abre a revisão com preços atuais, aviso de total e orcamentoId', (t) async {
    await montar(t, const OrcamentosPage());
    await inserirOrcamento(t, id: 'orc-1', total: 8, preco: 4); // tabela hoje: 5,50
    await t.runAsync(() => s.pedidos.reconciliar());
    await assentar(t);
    await t.tap(find.text('Mercado Bom'));
    await assentar(t);
    await trazer(t, find.byKey(const Key('transformar-pedido')));
    await t.tap(find.byKey(const Key('transformar-pedido')));
    await assentar(t);
    expect(find.text('Revisar pedido'), findsOneWidget);
    expect(find.byKey(const Key('aviso-total-mudou')), findsOneWidget);
    expect(find.textContaining('era R\$ 8,00 e agora é R\$ 11,00'), findsWidgets);
    expect(s.carrinho.orcamentoId, 'orc-1');
    expect(s.carrinho.total, 11);
    await t.runAsync(() => s.carrinho.aguardarGravacao());
  });

  testWidgets('orçamento: Editar abre o catálogo e salvar de novo usa o mesmo id (PUT)', (t) async {
    await montar(t, const OrcamentosPage());
    await inserirOrcamento(t, id: 'orc-1', total: 11, preco: 5.5);
    rota = (c) async => c.metodo == 'PUT' ? (200, {'id': 'orc-1', 'status': 'aberto', 'total': 11}) : (404, {});
    await t.runAsync(() => s.pedidos.reconciliar());
    await assentar(t);
    await t.tap(find.text('Mercado Bom'));
    await assentar(t);
    await trazer(t, find.byKey(const Key('editar-orcamento')));
    await t.tap(find.byKey(const Key('editar-orcamento')));
    await assentar(t);
    expect(find.text('Itens do pedido'), findsOneWidget);
    expect(s.carrinho.orcamentoId, 'orc-1');
    await t.tap(find.byKey(const Key('revisar')));
    await assentar(t);
    await t.tap(find.byKey(const Key('salvar-orcamento')));
    for (var i = 0; i < 40 && srv.contar('PUT', '/vendas/orcamentos/orc-1') == 0; i++) {
      await t.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 50)));
      await t.pump(const Duration(milliseconds: 50));
    }
    expect(srv.contar('PUT', '/vendas/orcamentos/orc-1'), 1);
    expect(await t.runAsync(() async => (await s.orcamentosLocais.listar()).length), 1, reason: 'o mesmo orçamento, não um novo');
    await t.runAsync(() => s.carrinho.aguardarGravacao());
  });

  testWidgets('orçamento aberto: cancelar pede confirmação e cancela', (t) async {
    await montar(t, const OrcamentosPage());
    await inserirOrcamento(t, id: 'orc-1');
    rota = (c) async => c.metodo == 'POST' ? (200, {'ok': true}) : (404, {});
    await t.runAsync(() => s.pedidos.reconciliar());
    await assentar(t);
    await t.tap(find.text('Mercado Bom'));
    await assentar(t);
    await trazer(t, find.byKey(const Key('cancelar-orcamento')));
    await t.tap(find.byKey(const Key('cancelar-orcamento')));
    await assentar(t);
    expect(find.text('Cancelar este orçamento?'), findsOneWidget);
    await t.tap(find.widgetWithText(FilledButton, 'Cancelar orçamento'));
    await assentar(t);
    expect(srv.contar('POST', '/vendas/orcamentos/orc-1/cancelar'), 1);
    expect(find.byKey(const Key('cancelar-orcamento')), findsNothing);
    expect(find.text('Cancelado'), findsWidgets);
  });

  testWidgets('orçamento convertido leva ao pedido', (t) async {
    await montar(t, const OrcamentosPage());
    final p = pedidoLocal(EstadoPedido.enviado, status: 'RECEBIDO', numero: 77, orcamentoId: 'orc-9');
    await inserir(t, [p]);
    await inserirOrcamento(t, id: 'orc-9', estado: EstadoOrcamento.convertido, pedidoId: 'srv-${p.id}');
    await t.runAsync(() => s.pedidos.reconciliar());
    await assentar(t);
    await t.tap(find.text('Mercado Bom'));
    await assentar(t);
    expect(find.text('Este orçamento virou pedido.'), findsOneWidget);
    await trazer(t, find.byKey(const Key('ver-pedido')));
    await t.tap(find.byKey(const Key('ver-pedido')));
    await assentar(t);
    expect(find.byType(PedidoDetalhePage), findsOneWidget);
    expect(find.text('Pedido nº 77'), findsOneWidget);
  });

  for (final escala in [1.0, 1.3]) {
    final sufixo = escala == 1.0 ? '' : ' (fonte 1,3x)';
    testWidgets('Catálogo avulso: tabela no alto lembrada, preço da tabela, busca e somente leitura$sufixo', (t) async {
      await montar(t, const CatalogoPage(), escala: escala);
      expect(find.text('Catálogo'), findsOneWidget);
      expect(find.byKey(const Key('seletor-tabela')), findsOneWidget);
      expect(find.byKey(const Key('catalogo-novo-pedido')), findsOneWidget);
      expect(find.text('Arroz 5kg'), findsOneWidget);
      expect(find.text('Adicionar'), findsNothing, reason: 'catálogo avulso é só consulta');
      expect(find.byType(CircularProgressIndicator), findsNothing);

      // busca
      await t.enterText(find.byKey(const Key('busca-catalogo')), 'feij');
      await t.pump(const Duration(milliseconds: 300));
      await assentar(t);
      expect(find.text('Feijão 1kg'), findsOneWidget);
      expect(find.text('Arroz 5kg'), findsNothing);
      await t.enterText(find.byKey(const Key('busca-catalogo')), 'zzzz');
      await t.pump(const Duration(milliseconds: 300));
      await assentar(t);
      expect(find.byKey(const Key('catalogo-vazio')), findsOneWidget);
      await t.enterText(find.byKey(const Key('busca-catalogo')), '');
      await t.pump(const Duration(milliseconds: 300));
      await assentar(t);

      // trocar de tabela muda o preço e fica lembrado
      await t.tap(find.byKey(const Key('seletor-tabela')));
      await assentar(t);
      expect(find.textContaining('R\$ 11,00', findRichText: true), findsOneWidget, reason: 'a 1ª tabela por nome é a só-PIX');
      expect(find.text('sem preço nesta tabela'), findsOneWidget); // Açúcar
      await t.tap(find.text('Retirada 7 dias').last);
      await assentar(t);
      expect(find.textContaining('R\$ 9,00', findRichText: true), findsOneWidget); // Arroz na tabela de retirada
      expect(find.text('sem preço nesta tabela'), findsNothing);
      expect(await t.runAsync(() => s.meta.ler('catalogo_tabela')), Ids.tabRetirada);
    });
  }

  testWidgets('Catálogo avulso abre com a última tabela usada', (t) async {
    await montar(t, const SizedBox());
    await t.runAsync(() => s.meta.gravar('catalogo_tabela', Ids.tabEntrega));
    await t.pumpWidget(arvore(const CatalogoPage(), 1.0));
    await assentar(t);
    expect(find.text('Entrega boleto 14 dias'), findsWidgets);
    expect(find.textContaining('R\$ 5,50', findRichText: true), findsOneWidget); // Feijão na tabela de entrega com boleto
  });

  for (final escala in [1.0, 1.3]) {
    final sufixo = escala == 1.0 ? '' : ' (fonte 1,3x)';
    testWidgets('Mais: sincronizar agora, última sincronização, versão e Sair$sufixo', (t) async {
      await montar(t, const Scaffold(body: MaisPage()), escala: escala);
      expect(find.text('Orçamentos'), findsOneWidget);
      expect(find.text('Catálogo'), findsOneWidget);
      expect(find.text('Sincronizar agora'), findsOneWidget);
      expect(find.textContaining('Última sincronização'), findsOneWidget);
      expect(find.byKey(const Key('mais-versao')), findsOneWidget);
      expect(find.text('Sair'), findsOneWidget);
      expect(t.getSize(find.byKey(const Key('mais-sair'))).height, greaterThanOrEqualTo(48));
    });
  }

  testWidgets('Mais: sair com pedido na fila avisa e exige confirmação explícita', (t) async {
    await montar(t, const Scaffold(body: MaisPage()), escala: 1.3);
    await inserir(t, [pedidoLocal(EstadoPedido.aguardandoEnvio), pedidoLocal(EstadoPedido.aguardandoEnvio)]);

    await t.ensureVisible(find.byKey(const Key('mais-sair')));
    await t.tap(find.byKey(const Key('mais-sair')));
    await assentar(t);
    expect(find.text('Você tem 2 pedido(s) na fila. Se sair agora eles serão perdidos.'), findsOneWidget);
    // voltar: continua logado
    await t.tap(find.byKey(const Key('saida-voltar')));
    await assentar(t);
    expect(s.sessao.logado, isTrue);

    // confirmar explicitamente: sai
    await t.ensureVisible(find.byKey(const Key('mais-sair')));
    await t.tap(find.byKey(const Key('mais-sair')));
    await assentar(t);
    await t.tap(find.byKey(const Key('saida-confirmar')));
    await assentar(t);
    expect(s.sessao.logado, isFalse);
  });

  testWidgets('Mais: sair sem nada na fila só pergunta se quer sair', (t) async {
    await montar(t, const Scaffold(body: MaisPage()));
    await t.ensureVisible(find.byKey(const Key('mais-sair')));
    await t.tap(find.byKey(const Key('mais-sair')));
    await assentar(t);
    expect(find.text('Sair do aplicativo?'), findsOneWidget);
    expect(find.textContaining('na fila'), findsNothing);
    await t.tap(find.byKey(const Key('saida-voltar')));
    await assentar(t);
    expect(s.sessao.logado, isTrue);
  });

  testWidgets('Início: o cartão de retidos abre a aba Pedidos já filtrada em Retidos; a fila abre em Na fila', (t) async {
    await montar(t, const HomeShell());
    await inserir(t, [
      pedidoLocal(EstadoPedido.retido, status: 'AGUARDANDO_VENDEDOR', numero: 60, divergencias: divergPreco),
      pedidoLocal(EstadoPedido.enviado, status: 'FATURADO', numero: 61),
      pedidoLocal(EstadoPedido.aguardandoEnvio),
    ]);
    await t.runAsync(() => s.pedidos.reconciliar());
    await t.runAsync(() => s.fila.atualizarContadores());
    await assentar(t);
    expect(find.byKey(const Key('cartao-retidos')), findsOneWidget);
    expect(find.byKey(const Key('indicador-fila')), findsOneWidget);

    // a fila abre a aba Pedidos em "Na fila"
    await t.tap(find.byKey(const Key('indicador-fila')));
    await assentar(t);
    expect(s.pedidos.filtro.value, FiltroPedido.naFila);
    expect(find.byKey(const Key('filtros-pedidos')), findsOneWidget);
    expect(find.text('Faturado'), findsNothing);
    expect(find.text('Retido'), findsNothing);

    // volta ao Início: o cartão de retidos abre em "Retidos"
    await t.tap(find.text('Início'));
    await assentar(t);
    await t.ensureVisible(find.byKey(const Key('cartao-retidos')));
    await t.tap(find.byKey(const Key('cartao-retidos')));
    await assentar(t);
    expect(s.pedidos.filtro.value, FiltroPedido.retidos);
    expect(find.text('Faturado'), findsNothing);
    expect(find.text('Retido'), findsWidgets);
  });

  testWidgets('Início: Orçamentos e Catálogo abrem as telas', (t) async {
    await montar(t, const HomeShell());
    await t.scrollUntilVisible(find.text('Orçamentos'), 200, scrollable: find.byType(Scrollable).first);
    await t.ensureVisible(find.text('Orçamentos'));
    await t.tap(find.text('Orçamentos'));
    await assentar(t);
    expect(find.byKey(const Key('filtros-orcamentos')), findsOneWidget);
    await t.tap(find.byType(BackButton));
    await assentar(t);
    await t.scrollUntilVisible(find.text('Catálogo'), 200, scrollable: find.byType(Scrollable).first);
    await t.ensureVisible(find.text('Catálogo'));
    await t.tap(find.text('Catálogo'));
    await assentar(t);
    expect(find.byKey(const Key('seletor-tabela')), findsOneWidget);
  });

  test('o corpo do pedido recusado fica íntegro para a edição (sanidade do helper de teste)', () {
    final p = pedidoLocal(EstadoPedido.recusado);
    expect(jsonDecode(jsonEncode(p.corpo))['itens'], isNotEmpty);
  });
}
