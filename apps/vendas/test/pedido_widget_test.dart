import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:fluxo_vendas/app_servicos.dart';
import 'package:fluxo_vendas/core/tema.dart';
import 'package:fluxo_vendas/core/token_store.dart';
import 'package:fluxo_vendas/data/banco_local.dart';
import 'package:fluxo_vendas/features/clientes/clientes_page.dart';
import 'package:fluxo_vendas/features/inicio/inicio_page.dart';
import 'package:fluxo_vendas/features/pedido/novo_pedido_page.dart';
import 'package:fluxo_vendas/services/conectividade.dart';
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

/// Testes de tela a 360 dp de largura (celular pequeno): o flutter_test falha sozinho se algo
/// estourar a tela (overflow). O SQLite do teste roda fora do relógio falso: `runAsync`.
void main() {
  late AppServicos s;
  late BancoLocal banco;
  late ServidorFalso srv;

  Future<void> assentar(WidgetTester t) async {
    for (var i = 0; i < 4; i++) {
      await t.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 40)));
      await t.pump(const Duration(milliseconds: 50));
    }
  }

  tearDown(() async {
    await banco.fechar();
  });

  /// Espera (tempo real) até o [achado] aparecer: o envio faz várias idas ao SQLite.
  Future<void> esperar(WidgetTester t, Finder achado) async {
    for (var i = 0; i < 60 && achado.evaluate().isEmpty; i++) {
      await t.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 50)));
      await t.pump(const Duration(milliseconds: 50));
    }
  }

  Future<void> montar(WidgetTester t, Widget tela, {double escala = 1.0}) async {
    t.view.physicalSize = const Size(360, 700);
    t.view.devicePixelRatio = 1;
    addTearDown(t.view.resetPhysicalSize);
    addTearDown(t.view.resetDevicePixelRatio);
    await t.runAsync(() async {
      await initializeDateFormatting('pt_BR');
      banco = await bancoEmMemoria();
      await semear(banco);
      srv = ServidorFalso((c) async {
        if (c.caminho == '/vendas/pedidos') {
          final b = jsonDecode(c.corpo) as Map<String, dynamic>;
          return (200, {'id': 'srv-${b['idDispositivo']}', 'numero': 321, 'status': 'RECEBIDO', 'total': 41.23, 'divergencias': []});
        }
        return (404, {});
      });
      s = AppServicos.criar(
          banco: banco, tokens: MemoriaTokenStore(const Tokens('AT', 'RT')), conectividade: _Rede(), httpClient: srv.cliente, baseUrl: 'http://x/v1', tenant: 'cahu');
      await s.sessao.restaurar(); // sem vendedor/tokens completos no banco falso? (vendedor_id existe)
    });
    await t.pumpWidget(Servicos(
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
    ));
    await assentar(t);
  }

  testWidgets('fluxo completo a 360 dp: cliente, tabela (forma automática), itens, revisão e envio', (t) async {
    await montar(t, const NovoPedidoPage());
    expect(find.text('Mercado Bom'), findsOneWidget);
    // cliente bloqueado não avança
    await t.tap(find.text('Mercado Bloqueado'));
    await t.pump();
    expect(find.textContaining('Cliente bloqueado'), findsWidgets);
    expect(find.text('Tabela de preço'), findsNothing);

    await t.tap(find.text('Mercado Bom'));
    await assentar(t);
    expect(find.text('Entrega boleto 14 dias'), findsOneWidget);
    expect(find.text('Entrega'), findsWidgets);
    await t.tap(find.text('Entrega boleto 14 dias'));
    await assentar(t);
    // uma forma só: pulou a escolha e abriu o catálogo
    expect(find.text('Forma de pagamento'), findsNothing);
    expect(find.text('Arroz 5kg'), findsOneWidget);
    expect(find.byTooltip('Adicionar'), findsNWidgets(3));
    expect(find.text('Nenhum item'), findsOneWidget);

    await t.tap(find.byTooltip('Adicionar').first);
    await assentar(t);
    expect(find.text('1 item'), findsOneWidget);
    await t.tap(find.byTooltip('Aumentar').first);
    await t.pump();
    await t.tap(find.byTooltip('Aumentar').first);
    await t.pump();
    expect(t.widget<Text>(find.byKey(const Key('barra-total'))).data, 'R\$ 30,23'); // Arroz: 3 x 10,075 (preço da tabela; meio centavo sobe)
    await t.tap(find.byKey(const Key('revisar')));
    await assentar(t);

    expect(find.byKey(const Key('revisao-total')), findsOneWidget);
    expect(find.text('única forma desta tabela'), findsOneWidget);
    expect(find.byKey(const Key('aviso-credito')), findsOneWidget);
    expect(find.textContaining('passa do limite'), findsNothing); // 30,23 < 700

    await t.ensureVisible(find.byKey(const Key('enviar-pedido')));
    await t.tap(find.byKey(const Key('enviar-pedido')));
    await esperar(t, find.text('Pedido nº 321'));
    await assentar(t);
    expect(find.text('Pedido enviado'), findsWidgets);
    expect(find.text('Pedido nº 321'), findsOneWidget);
    expect(srv.contar('POST', '/vendas/pedidos'), 1);
    expect(s.carrinho.temRascunho, isFalse);
    final corpo = jsonDecode(srv.chamadas.last.corpo) as Map<String, dynamic>;
    expect(corpo.containsKey('tipoEntrega'), isFalse);
  });

  testWidgets('tabela com várias formas pergunta a forma; aviso de crédito acima do limite', (t) async {
    await montar(t, const NovoPedidoPage());
    await t.tap(find.text('Mercado Bom'));
    await assentar(t);
    await t.tap(find.text('Retirada 7 dias'));
    await assentar(t);
    expect(find.text('Forma de pagamento'), findsWidgets);
    expect(find.text('Boleto'), findsOneWidget);
    await t.tap(find.text('Boleto'));
    await assentar(t);
    // 700 de limite disponível; 9 x 78 = 702
    final arroz = (await t.runAsync(() => s.produtos.porId(Ids.p1, tabelaId: Ids.tabRetirada)));
    s.carrinho.definirQuantidade(arroz!, 78);
    await t.pump();
    await t.tap(find.byKey(const Key('revisar')));
    await assentar(t);
    expect(find.textContaining('Este pedido passa do limite disponível. Ele pode ficar retido para você confirmar.'), findsOneWidget);
    await t.scrollUntilVisible(find.text('Salvar como orçamento'), 300, scrollable: find.byType(Scrollable).last);
    expect(find.text('Salvar como orçamento'), findsOneWidget);
  });

  testWidgets('revisão com fonte grande (1,3x) não estoura a tela', (t) async {
    await montar(t, const NovoPedidoPage(), escala: 1.3);
    await t.scrollUntilVisible(find.text('Mercado Bom'), 200, scrollable: find.byType(Scrollable).last); // a fonte grande empurra o 2º cliente para baixo
    await t.tap(find.text('Mercado Bom'));
    await assentar(t);
    await t.drag(find.byType(Scrollable).last, const Offset(0, -300)); // com a fonte grande a 3ª tabela fica sob a barra de navegação
    await t.pump(const Duration(milliseconds: 100));
    await t.tap(find.text('Retirada 7 dias'));
    await assentar(t);
    await t.tap(find.text('PIX'));
    await assentar(t);
    await t.tap(find.byTooltip('Adicionar').first);
    await assentar(t);
    await t.tap(find.byKey(const Key('revisar')));
    await assentar(t);
    await t.scrollUntilVisible(find.byKey(const Key('enviar-pedido')), 300, scrollable: find.byType(Scrollable).last);
    expect(find.byKey(const Key('enviar-pedido')), findsOneWidget);
  });

  testWidgets('Clientes: lista com busca, filtros e detalhe com Histórico e Financeiro', (t) async {
    await montar(t, const Scaffold(body: ClientesPage()));
    expect(find.text('Mercado Bom'), findsOneWidget);
    expect(find.textContaining('Disponível: R\$ 700,00'), findsWidgets);
    expect(find.text('Sem compras'), findsWidgets);
    await t.enterText(find.byKey(const Key('busca-clientes')), 'bloq');
    await t.pump(const Duration(milliseconds: 300));
    await assentar(t);
    expect(find.text('Mercado Bom'), findsNothing);
    expect(find.text('Mercado Bloqueado'), findsOneWidget);
    await t.tap(find.text('Mercado Bloqueado'));
    await assentar(t);
    expect(find.byKey(const Key('cartao-cliente')), findsOneWidget);
    expect(find.text('Bloqueado'), findsWidgets);
    expect(find.textContaining('Cliente bloqueado: não é possível fazer pedido'), findsOneWidget);
    expect(t.widget<FilledButton>(find.byKey(const Key('novo-pedido-cliente'))).onPressed, isNull);
    await t.tap(find.text('Financeiro'));
    await assentar(t);
    expect(find.text('Disponível'), findsOneWidget);
    expect(find.text('Nenhum título em aberto'), findsOneWidget);
    await t.tap(find.text('Histórico'));
    await assentar(t);
    expect(find.text('Sem pedidos recentes'), findsOneWidget);
  });

  testWidgets('detalhe do cliente liberado abre o pedido já na tabela', (t) async {
    await montar(t, const Scaffold(body: ClientesPage()));
    await t.tap(find.text('Mercado Bom'));
    await assentar(t);
    await t.tap(find.byKey(const Key('novo-pedido-cliente')));
    await assentar(t);
    expect(find.text('Tabela de preço'), findsOneWidget);
    expect(s.carrinho.cliente!.nomeFantasia, 'Mercado Bom');
  });

  testWidgets('Início oferece continuar o pedido em andamento e mostra "Na fila"', (t) async {
    await montar(t, const Scaffold(body: InicioPage()));
    expect(find.byKey(const Key('cartao-rascunho')), findsNothing);
    await t.runAsync(() async {
      s.carrinho.iniciar((await s.clientes.porId(Ids.clienteOk))!);
      await s.carrinho.aguardarGravacao();
    });
    await t.pump();
    expect(find.text('Continuar pedido de Mercado Bom'), findsOneWidget);
    expect(find.text('Descartar'), findsOneWidget);
    expect(find.byKey(const Key('indicador-fila')), findsNothing);
  });
}
