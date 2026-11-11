@Tags(['imagens'])
library;

import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:fluxo_vendas/app_servicos.dart';
import 'package:fluxo_vendas/core/tema.dart';
import 'package:fluxo_vendas/core/token_store.dart';
import 'package:fluxo_vendas/data/banco_local.dart';
import 'package:fluxo_vendas/data/pedido_local.dart';
import 'package:fluxo_vendas/features/catalogo/catalogo_page.dart';
import 'package:fluxo_vendas/features/clientes/cliente_page.dart';
import 'package:fluxo_vendas/features/login/login_page.dart';
import 'package:fluxo_vendas/features/orcamentos/orcamento_detalhe_page.dart';
import 'package:fluxo_vendas/features/orcamentos/orcamentos_page.dart';
import 'package:fluxo_vendas/features/pedido/novo_pedido_page.dart';
import 'package:fluxo_vendas/features/pedido/resultado_envio_page.dart';
import 'package:fluxo_vendas/features/pedidos/pedido_detalhe_page.dart';
import 'package:fluxo_vendas/features/shell/home_shell.dart';
import 'package:fluxo_vendas/services/conectividade.dart';
import 'package:fluxo_vendas/services/fila_envio_service.dart';
import 'package:fluxo_vendas/widgets/foto_produto.dart';
import 'package:fluxo_vendas/widgets/logo_cliente.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:intl/date_symbol_data_local.dart';

import 'suporte/banco_teste.dart';

/// IMAGENS DAS TELAS (390 x 844 dp, densidade 2, fontes reais), renderizadas fora da tela pelo flutter_test.
/// Não abre janela nem tira print do computador. Os dados são fictícios (clientes e produtos em português),
/// montados como a resposta da API e gravados no banco em memória pelo caminho normal da sincronização.
///
/// Por padrão ficam PULADOS (são lentos e dependem das fontes do SDK). Para gerar tudo:
///
///     cd apps/vendas
///     flutter test test/telas_imagens_test.dart --run-skipped
///
/// Saída: `../../.superpowers/sdd/telas/*.png` (ou a pasta da variável de ambiente IMAGENS_DIR).
void main() {
  final pasta = Directory(Platform.environment['IMAGENS_DIR'] ?? '../../.superpowers/sdd/telas');

  setUpAll(() async {
    pasta.createSync(recursive: true);
    await _carregarFontes();
    await initializeDateFormatting('pt_BR');
    for (var i = 1; i <= 8; i++) {
      _fotos['https://fotos.exemplo/p$i.jpg'] = MemoryImage(File('test/fixtures/fotos/p$i.jpg').readAsBytesSync());
    }
    FotoProduto.provedor = (url) => _fotos[url];
    final logo = MemoryImage(File('test/fixtures/logo_cliente.png').readAsBytesSync());
    LogoCliente.provedor = (url) => url.endsWith('/logo-cahu.png') ? logo : null;
  });
  tearDownAll(() {
    FotoProduto.provedor = null;
    LogoCliente.provedor = null;
  });

  late AppServicos s;
  late BancoLocal banco;
  late _Mundo mundo;

  tearDown(() async => banco.fechar());

  /// Monta o aplicativo com os dados fictícios, já "logado e sincronizado", e renderiza [tela] em [arquivo].
  Future<void> tela(
    WidgetTester t,
    String arquivo,
    Widget Function() tela, {
    Future<void> Function(WidgetTester t)? preparar,
    Future<void> Function(WidgetTester t)? depois,
    bool logado = true,
    bool semMeta = false,
    bool offline = false,
    bool empilhada = true,
  }) async {
    t.view.physicalSize = const Size(780, 1688);
    t.view.devicePixelRatio = 2;
    addTearDown(t.view.resetPhysicalSize);
    addTearDown(t.view.resetDevicePixelRatio);
    mundo = _Mundo(semMeta: semMeta);
    await t.runAsync(() async {
      banco = await bancoEmMemoria();
      s = AppServicos.criar(
        banco: banco,
        tokens: MemoriaTokenStore(),
        conectividade: _Rede(),
        httpClient: mundo.cliente,
        baseUrl: 'http://x/v1',
        tenant: 'cahu',
        agora: () => mundo.agora,
        intervaloSync: const Duration(days: 1),
      );
      s.sessao.aoLogar = null;
      if (logado) {
        await s.sessao.entrar('joao', 'senha');
        mundo.agora = DateTime(2026, 11, offline ? 10 : 11, offline ? 22 : 9, offline ? 30 : 38);
        await s.sincronizacao.iniciar();
        await s.sincronizacao.sincronizar();
        if (offline) {
          mundo.offline = true;
          mundo.agora = DateTime(2026, 11, 11, 9, 41);
          await s.sincronizacao.sincronizar();
        }
      }
    });
    if (preparar != null) await preparar(t);
    final chave = GlobalKey();
    final navegador = GlobalKey<NavigatorState>();
    await t.pumpWidget(RepaintBoundary(
      key: chave,
      child: Servicos(
        servicos: s,
        child: MaterialApp(
          debugShowCheckedModeBanner: false,
          navigatorKey: navegador,
          theme: construirTema(familia: 'Roboto'),
          locale: const Locale('pt', 'BR'),
          supportedLocales: const [Locale('pt', 'BR')],
          localizationsDelegates: const [GlobalMaterialLocalizations.delegate, GlobalWidgetsLocalizations.delegate, GlobalCupertinoLocalizations.delegate],
          home: empilhada ? const SizedBox.shrink() : tela(),
        ),
      ),
    ));
    await _assentar(t);
    if (empilhada) {
      // Telas que no aplicativo abrem por cima de outra: empilha, para a seta de voltar aparecer como de verdade.
      unawaited(navegador.currentState!.push(MaterialPageRoute<void>(builder: (_) => tela())));
      await _assentar(t);
    }
    await t.runAsync(() async {
      // As fotos decodificam fora do relógio falso: aquece o cache antes de pintar.
      final ctx = t.element(find.byType(MaterialApp));
      for (final f in _fotos.values) {
        await precacheImage(f, ctx);
      }
    });
    await _assentar(t);
    if (depois != null) {
      await depois(t);
      await _assentar(t);
    }
    await t.runAsync(() async {
      final limite = chave.currentContext!.findRenderObject()! as RenderRepaintBoundary;
      final imagem = await limite.toImage(pixelRatio: 2);
      final bytes = (await imagem.toByteData(format: ui.ImageByteFormat.png))!;
      File('${pasta.path}/$arquivo').writeAsBytesSync(bytes.buffer.asUint8List());
    });
  }

  /// Prepara o carrinho como o vendedor deixaria no passo escolhido.
  Future<void> carrinho(WidgetTester t, {required String tabela, String? forma, Map<String, double> itens = const {}}) async {
    await t.runAsync(() async {
      final cliente = (await s.clientes.porId('cli-1'))!;
      s.carrinho.iniciar(cliente);
      final tabelas = await s.tabelas.listar();
      final tb = tabelas.firstWhere((x) => x.tabela.id == tabela);
      await s.carrinho.escolherTabela(tb);
      if (forma != null) s.carrinho.escolherForma(tb.formas.firstWhere((f) => f.id == forma));
      for (final e in itens.entries) {
        final p = (await s.produtos.porId(e.key, tabelaId: tabela))!;
        s.carrinho.definirQuantidade(p, e.value);
      }
      await s.carrinho.aguardarGravacao();
    });
  }

  Future<void> pedidos(WidgetTester t, List<PedidoLocal> lista) async {
    await t.runAsync(() async {
      for (final p in lista) {
        await s.pedidosLocais.inserir(p);
      }
      await s.fila.atualizarContadores();
    });
  }

  Future<void> orcamentos(WidgetTester t, List<OrcamentoLocal> lista) async {
    await t.runAsync(() async {
      for (final o in lista) {
        await s.orcamentosLocais.inserir(o);
      }
    });
  }

  PedidoLocal retido() => _pedido('ped-retido', 'cli-1', EstadoPedido.retido,
      total: 1842.6,
      numero: 417,
      status: 'AGUARDANDO_VENDEDOR',
      quando: DateTime.utc(2026, 11, 11, 11, 20),
      itens: {'p1': 40, 'p2': 20, 'p4': 30},
      divergencias: [
        {'tipo': 'preco', 'produtoId': 'p1', 'nome': 'Arroz branco Namorado 1kg', 'enviado': 24.9, 'atual': 25.9},
        {'tipo': 'estoque', 'produtoId': 'p6', 'nome': 'Refrigerante Goob cola 230ml', 'enviado': 12, 'atual': 0},
      ]);

  List<PedidoLocal> variados() => [
        retido(),
        _pedido('ped-fila', 'cli-2', EstadoPedido.aguardandoEnvio, total: 936.4, quando: DateTime.utc(2026, 11, 11, 11, 5), itens: {'p3': 60, 'p7': 24}),
        _pedido('ped-1', 'cli-3', EstadoPedido.enviado,
            total: 2115, numero: 412, status: 'RECEBIDO', quando: DateTime.utc(2026, 11, 11, 10, 30), itens: {'p1': 50, 'p5': 40}),
        _pedido('ped-2', 'cli-5', EstadoPedido.enviado,
            total: 780.25, numero: 398, status: 'FATURADO', quando: DateTime.utc(2026, 11, 10, 14, 2), itens: {'p8': 30, 'p4': 10}),
        _pedido('ped-3', 'cli-6', EstadoPedido.recusado,
            total: 540, quando: DateTime.utc(2026, 11, 10, 9, 15), itens: {'p2': 30}, motivo: 'Cliente bloqueado. Fale com o supervisor.'),
        _pedido('ped-4', 'cli-1', EstadoPedido.cancelado,
            total: 310.9, numero: 380, status: 'CANCELADO', quando: DateTime.utc(2026, 11, 9, 16, 40), itens: {'p7': 20}),
      ];

  List<OrcamentoLocal> variadosOrc() => [
        _orcamento('orc-1', 'cli-1', EstadoOrcamento.sincronizado, 1120.4, DateTime.utc(2026, 11, 11, 10, 12), {'p1': 20, 'p3': 40, 'p5': 24}),
        _orcamento('orc-2', 'cli-2', EstadoOrcamento.local, 684.9, DateTime.utc(2026, 11, 11, 9, 40), {'p4': 24, 'p8': 12}),
        _orcamento('orc-3', 'cli-3', EstadoOrcamento.convertido, 2115, DateTime.utc(2026, 11, 10, 15, 0), {'p1': 50, 'p5': 40}, pedidoId: 'srv-ped-1'),
        _orcamento('orc-4', 'cli-5', EstadoOrcamento.sincronizado, 455.5, DateTime.utc(2026, 11, 9, 13, 30), {'p7': 36}),
      ];

  testWidgets('01 login', (t) async {
    await tela(t, '01-login.png', () => const LoginPage(), logado: false, empilhada: false);
  });

  testWidgets('02 início com meta e pedido retido', (t) async {
    await tela(t, '02-inicio.png', () => const HomeShell(), empilhada: false, preparar: (t) => pedidos(t, [retido()]));
  });

  testWidgets('02b início sem meta, sem internet e com fila', (t) async {
    await tela(t, '02b-inicio-sem-meta-offline.png', () => const HomeShell(),
        empilhada: false,
        semMeta: true,
        offline: true,
        preparar: (t) => pedidos(t, [
              _pedido('f1', 'cli-2', EstadoPedido.aguardandoEnvio, total: 936.4, quando: DateTime.utc(2026, 11, 11, 11, 5), itens: {'p3': 60}),
              _pedido('f2', 'cli-3', EstadoPedido.aguardandoEnvio, total: 412.8, quando: DateTime.utc(2026, 11, 11, 11, 8), itens: {'p7': 24}),
            ]));
  });

  testWidgets('03 minha carteira', (t) async {
    await tela(t, '03-minha-carteira.png', () => const HomeShell(abaInicial: AbaVendas.clientes), empilhada: false);
  });

  testWidgets('04 cliente: histórico', (t) async {
    await tela(t, '04-cliente-historico.png', () => const ClientePage(clienteId: 'cli-1'));
  });

  testWidgets('04b cliente: financeiro', (t) async {
    await tela(t, '04b-cliente-financeiro.png', () => const ClientePage(clienteId: 'cli-1'), depois: (t) async {
      await t.tap(find.text('Financeiro'));
    });
  });

  testWidgets('05 novo pedido: tabela de preço', (t) async {
    await tela(t, '05-novo-pedido-tabela.png', () => const NovoPedidoPage(etapaInicial: EtapaPedido.tabela),
        preparar: (t) => t.runAsync(() async => s.carrinho.iniciar((await s.clientes.porId('cli-1'))!)));
  });

  testWidgets('05b novo pedido: forma de pagamento', (t) async {
    await tela(t, '05b-novo-pedido-forma.png', () => const NovoPedidoPage(etapaInicial: EtapaPedido.forma),
        preparar: (t) async {
      await t.runAsync(() async {
        s.carrinho.iniciar((await s.clientes.porId('cli-1'))!);
        final tb = (await s.tabelas.listar()).firstWhere((x) => x.tabela.id == 'tab-vista');
        await s.carrinho.escolherTabela(tb);
      });
    });
  });

  testWidgets('06 novo pedido: catálogo', (t) async {
    await tela(t, '06-novo-pedido-catalogo.png', () => const NovoPedidoPage(etapaInicial: EtapaPedido.catalogo),
        preparar: (t) => carrinho(t, tabela: 'tab-vista', forma: 'f-pix', itens: {'p1': 2, 'p5': 1}));
  });

  testWidgets('07 pedido: revisão', (t) async {
    await tela(t, '07-pedido-revisao.png', () => const NovoPedidoPage(etapaInicial: EtapaPedido.revisao),
        preparar: (t) => carrinho(t, tabela: 'tab-vista', forma: 'f-pix', itens: {'p1': 2, 'p2': 1, 'p5': 2}));
  });

  testWidgets('08 resultado: enviado', (t) async {
    await tela(
        t,
        '08-resultado-enviado.png',
        () => const ResultadoEnvioPage(
            resultado: ResultadoEnvio(id: 'x', orcamento: false, desfecho: DesfechoEnvio.enviado, numero: 421, total: 112.31),
            cliente: 'Supermercado Boa Compra'));
  });

  testWidgets('08b resultado: retido', (t) async {
    await tela(
        t,
        '08b-resultado-retido.png',
        () => const ResultadoEnvioPage(
              resultado: ResultadoEnvio(id: 'x', orcamento: false, desfecho: DesfechoEnvio.retido, numero: 422, total: 1842.6, divergencias: [
                Divergencia(tipo: 'preco', nome: 'Arroz branco Namorado 1kg', enviado: 24.9, atual: 25.9),
                Divergencia(tipo: 'estoque', nome: 'Refrigerante Goob cola 230ml', enviado: 12, atual: 0),
              ]),
              cliente: 'Supermercado Boa Compra',
            ));
  });

  testWidgets('09 pedidos', (t) async {
    await tela(t, '09-pedidos.png', () => const HomeShell(abaInicial: AbaVendas.pedidos), empilhada: false, preparar: (t) async {
      await pedidos(t, variados());
      await t.runAsync(() => s.pedidos.reconciliar());
    });
  });

  testWidgets('10 pedido retido', (t) async {
    await tela(t, '10-pedido-retido.png', () => const PedidoDetalhePage(pedidoId: 'ped-retido'), preparar: (t) => pedidos(t, [retido()]));
  });

  testWidgets('11 orçamentos', (t) async {
    await tela(t, '11-orcamentos.png', () => const OrcamentosPage(), preparar: (t) async {
      await orcamentos(t, variadosOrc());
      await t.runAsync(() => s.pedidos.reconciliar());
    });
  });

  testWidgets('12 orçamento: detalhe', (t) async {
    await tela(t, '12-orcamento-detalhe.png', () => const OrcamentoDetalhePage(orcamentoId: 'orc-1'), preparar: (t) => orcamentos(t, variadosOrc()));
  });

  testWidgets('13 catálogo', (t) async {
    await tela(t, '13-catalogo.png', () => const CatalogoPage());
  });

  testWidgets('14 mais', (t) async {
    await tela(t, '14-mais.png', () => const HomeShell(abaInicial: AbaVendas.mais), empilhada: false);
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Infra das imagens

final _fotos = <String, MemoryImage>{};

Future<void> _assentar(WidgetTester t) async {
  for (var i = 0; i < 6; i++) {
    await t.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 50)));
    await t.pump(const Duration(milliseconds: 60));
  }
  await t.pump(const Duration(milliseconds: 500));
}

/// Fontes reais do SDK (Roboto e MaterialIcons), no lugar da Ahem do flutter_test.
Future<void> _carregarFontes() async {
  final raiz = Platform.environment['FLUTTER_ROOT'] ?? 'C:/dev/flutter';
  final dir = '$raiz/bin/cache/artifacts/material_fonts';
  Future<ByteData> ler(String nome) async => ByteData.view(Uint8List.fromList(File('$dir/$nome').readAsBytesSync()).buffer);
  final roboto = FontLoader('Roboto')
    ..addFont(ler('roboto-regular.ttf'))
    ..addFont(ler('roboto-medium.ttf'))
    ..addFont(ler('roboto-bold.ttf'));
  await roboto.load();
  final icones = FontLoader('MaterialIcons')..addFont(ler('materialicons-regular.otf'));
  await icones.load();
}

class _Rede implements FonteConectividade {
  @override
  Future<bool> temRede() async => true;
  @override
  Stream<bool> get mudancas => const Stream.empty();
}

/// A "API": login, carga e resumo com dados fictícios; listas do servidor vazias.
class _Mundo {
  _Mundo({this.semMeta = false});
  final bool semMeta;
  bool offline = false;
  DateTime agora = DateTime(2026, 11, 11, 9, 38);

  late final http.Client cliente = MockClient((req) async {
    if (offline) throw const SocketException('sem rede');
    final caminho = req.url.path.replaceFirst('/v1', '');
    Object? corpo;
    if (caminho == '/vendas/login') {
      corpo = {
        'accessToken': 'AT',
        'refreshToken': 'RT',
        'vendedor': {'id': 'ven-1', 'nome': 'JOÃO SILVA'},
        'distribuidora': 'CAHU Distribuidora',
      };
    } else if (caminho == '/config') {
      corpo = {
        'tema': {'logo_url': 'https://logos.exemplo/logo-cahu.png'},
      };
    } else if (caminho == '/vendas/sync') {
      corpo = _carga();
    } else if (caminho == '/vendas/resumo') {
      corpo = {
        'vendidoHoje': 1245.3,
        'pedidosHoje': 4,
        'ticketMedioHoje': 311.33,
        'vendidoMes': 8450,
        'pedidosMes': 31,
        'pedidosFaturadosMes': 22,
        'clientesCarteira': 40,
        'clientesPositivadosMes': 27,
        'pedidosRetidos': 0,
        'orcamentosAbertos': 2,
        'meta': semMeta
            ? {'percentual': 5, 'vendidoMesAnterior': 0, 'origemBase': 'erp', 'metaMes': null, 'atingidoPct': null, 'faltam': null}
            : {'percentual': 5, 'vendidoMesAnterior': 11800, 'origemBase': 'erp', 'metaMes': 12426.5, 'atingidoPct': 68.0, 'faltam': 3976.5},
      };
    } else if (caminho == '/vendas/pedidos' || caminho == '/vendas/orcamentos') {
      corpo = <Object?>[];
    } else {
      return http.Response('{}', 404, headers: {'content-type': 'application/json'});
    }
    return http.Response(jsonEncode(corpo), 200, headers: {'content-type': 'application/json; charset=utf-8'});
  });
}

Map<String, Object?> _carga() {
  Map<String, Object?> cli(String id, String cod, String nome, String doc, String status, num limite, num aberto, num transito, String rua, String bairro, String cidade, {String? tel}) => {
        'id': id,
        'erpClienteId': cod,
        'documento': doc,
        'razaoSocial': nome,
        'nomeFantasia': nome,
        'telefone': tel,
        'status': status,
        'limiteCredito': limite,
        'emAberto': aberto,
        'pedidosEmTransito': transito,
        'endereco': {'logradouro': rua, 'numero': '123', 'complemento': null, 'bairro': bairro, 'cidade': cidade, 'uf': 'PE', 'cep': '50000000'},
      };
  Map<String, Object?> prod(String id, String nome, String un, int emb, String cat, num estoque, int n) => {
        'id': id,
        'sku': '789000$n',
        'ean': '789000$n',
        'nome': nome,
        'unidade': un,
        'qtdPorEmbalagem': emb,
        'categoriaId': cat,
        'estoque': estoque,
        'imagemUrl': 'https://fotos.exemplo/p$n.jpg',
      };
  Map<String, Object?> hist(String id, int numero, String cliente, String quando, num total, Map<String, double> itens, {String status = 'FATURADO'}) => {
        'pedidoId': id,
        'numero': numero,
        'clienteId': cliente,
        'criadoEm': quando,
        'total': total,
        'status': status,
        'origem': 'vendedor',
        'itens': [for (final e in itens.entries) {'produtoId': e.key, 'quantidade': e.value, 'precoUnit': 10.0}],
      };
  return {
    'geradoEm': '2026-11-11T12:38:00.000Z',
    'vendedor': {'id': 'ven-1', 'nome': 'JOÃO SILVA', 'erpVendedorId': 'D01'},
    'clientes': [
      cli('cli-1', '1021', 'Supermercado Boa Compra', '12345678000190', 'aprovado', 20000, 3500, 1500, 'Rua das Flores', 'Centro', 'Recife', tel: '(81) 98765-4321'),
      cli('cli-2', '1034', 'Mercadinho da Família', '23456789000101', 'aprovado', 12000, 4000, 0, 'Avenida Boa Viagem', 'Boa Viagem', 'Recife', tel: '(81) 99876-1100'),
      cli('cli-3', '1058', 'Supermercado Central', '34567890000112', 'aprovado', 15000, 2000, 1000, 'Rua do Comércio', 'Centro', 'Olinda', tel: '(81) 3456-7788'),
      cli('cli-4', '1077', 'Mercado do Povo', '45678901000123', 'pendente', 10000, 0, 0, 'Rua da Paz', 'Varadouro', 'Olinda'),
      cli('cli-5', '1090', 'Mini Mercado Estrela', '56789012000134', 'aprovado', 9000, 1200, 300, 'Rua Nova', 'Casa Amarela', 'Recife', tel: '(81) 98811-2233'),
      cli('cli-6', '1102', 'Atacarejo Pernambuco', '67890123000145', 'bloqueado', 30000, 31000, 0, 'Rodovia BR-232', 'Curado', 'Jaboatão dos Guararapes'),
    ],
    'titulos': [
      {'clienteId': 'cli-1', 'numero': 'TIT-4410', 'valor': 624.5, 'vencimento': '2026-11-15', 'status': 'ABERTO'},
      {'clienteId': 'cli-1', 'numero': 'TIT-4388', 'valor': 980.0, 'vencimento': '2026-11-02', 'status': 'ABERTO'},
      {'clienteId': 'cli-2', 'numero': 'TIT-4402', 'valor': 4000.0, 'vencimento': '2026-11-20', 'status': 'ABERTO'},
    ],
    'tabelas': [
      {'id': 'tab-boleto', 'nome': 'Entrega boleto 14 dias', 'erpTabelaId': '5', 'tipoEntrega': 'entrega'},
      {'id': 'tab-vista', 'nome': 'Entrega à vista', 'erpTabelaId': '6', 'tipoEntrega': 'entrega'},
      {'id': 'tab-retirada', 'nome': 'Retirada no balcão', 'erpTabelaId': '7', 'tipoEntrega': 'retirada'},
    ],
    'formas': [
      {'id': 'f-boleto', 'descricao': 'Boleto', 'exigeCredito': true},
      {'id': 'f-pix', 'descricao': 'PIX', 'exigeCredito': false},
      {'id': 'f-dinheiro', 'descricao': 'Dinheiro', 'exigeCredito': false},
      {'id': 'f-debito', 'descricao': 'Cartão de débito', 'exigeCredito': false},
    ],
    'tabelaFormas': [
      {'tabelaId': 'tab-boleto', 'formaId': 'f-boleto'},
      {'tabelaId': 'tab-vista', 'formaId': 'f-pix'},
      {'tabelaId': 'tab-vista', 'formaId': 'f-dinheiro'},
      {'tabelaId': 'tab-vista', 'formaId': 'f-debito'},
      {'tabelaId': 'tab-retirada', 'formaId': 'f-pix'},
      {'tabelaId': 'tab-retirada', 'formaId': 'f-dinheiro'},
    ],
    'categorias': [
      {'id': 'c-mercearia', 'nome': 'Mercearia'},
      {'id': 'c-limpeza', 'nome': 'Limpeza'},
      {'id': 'c-bebidas', 'nome': 'Bebidas'},
    ],
    'produtos': [
      prod('p1', 'Arroz branco Namorado 1kg', 'FD', 10, 'c-mercearia', 120, 1),
      prod('p2', 'Óleo de soja Siol 500ml', 'CX', 20, 'c-mercearia', 250, 2),
      prod('p3', 'Açúcar cristal Olho d\'Água 1kg', 'FD', 10, 'c-mercearia', 180, 3),
      prod('p4', 'Café União tradicional 250g', 'CX', 20, 'c-mercearia', 96, 4),
      prod('p5', 'Sabão em barra Minuano neutro 800g', 'CX', 10, 'c-limpeza', 300, 5),
      prod('p6', 'Refrigerante Goob cola 230ml', 'CX', 27, 'c-bebidas', 0, 6),
      prod('p7', 'Água sanitária Clorito 1l', 'CX', 12, 'c-limpeza', 420, 7),
      prod('p8', 'Biscoito amanteigado Capricche 24g', 'CX', 30, 'c-mercearia', 64, 8),
    ],
    'precos': [
      for (final (tab, fator) in [('tab-boleto', 1.0), ('tab-vista', 0.97), ('tab-retirada', 0.94)])
        for (final (p, v) in [('p1', 24.9), ('p2', 8.9), ('p3', 4.99), ('p4', 12.49), ('p5', 2.49), ('p6', 3.99), ('p7', 3.29), ('p8', 14.9)])
          {'produtoId': p, 'tabelaId': tab, 'preco': double.parse((v * fator).toStringAsFixed(2))},
    ],
    'historico': [
      hist('h1', 380, 'cli-1', '2026-11-02T13:10:00.000Z', 2850, {'p1': 40, 'p5': 30}),
      hist('h2', 351, 'cli-1', '2026-10-20T14:00:00.000Z', 1930, {'p2': 50, 'p4': 20}),
      hist('h3', 322, 'cli-1', '2026-10-10T12:30:00.000Z', 2120, {'p3': 60, 'p7': 24}),
      hist('h4', 390, 'cli-2', '2026-11-08T15:00:00.000Z', 1920, {'p1': 30}),
      hist('h5', 391, 'cli-3', '2026-11-07T15:00:00.000Z', 1780, {'p4': 20}),
      hist('h6', 392, 'cli-5', '2026-11-06T15:00:00.000Z', 1450, {'p7': 30}),
    ],
  };
}

PedidoLocal _pedido(
  String id,
  String cliente,
  String estado, {
  required double total,
  required DateTime quando,
  required Map<String, double> itens,
  int? numero,
  String? status,
  String? motivo,
  List<Map<String, Object?>>? divergencias,
}) {
  return PedidoLocal(
    id: id,
    vendedorId: 'ven-1',
    clienteId: cliente,
    tabelaId: 'tab-boleto',
    formaId: 'f-boleto',
    total: total,
    estado: estado,
    corpo: {
      'idDispositivo': id,
      'clienteId': cliente,
      'tabelaPrecoId': 'tab-boleto',
      'formaPagamentoId': 'f-boleto',
      'observacoes': 'Entregar pela manhã',
      'itens': [for (final e in itens.entries) {'produtoId': e.key, 'quantidade': e.value, 'precoUnit': 10.0}],
    },
    resposta: status == null ? null : {'id': 'srv-$id', 'numero': numero, 'status': status, 'total': total, 'divergencias': divergencias ?? const []},
    motivo: motivo,
    servidorNumero: status == null ? null : numero,
    criadoEm: quando,
    atualizadoEm: quando,
    enviadoEm: status == null ? null : quando,
  );
}

OrcamentoLocal _orcamento(String id, String cliente, String estado, double total, DateTime quando, Map<String, double> itens, {String? pedidoId}) {
  return OrcamentoLocal(
    id: id,
    vendedorId: 'ven-1',
    clienteId: cliente,
    tabelaId: 'tab-boleto',
    formaId: 'f-boleto',
    total: total,
    estado: estado,
    corpo: {
      'clienteId': cliente,
      'tabelaPrecoId': 'tab-boleto',
      'formaPagamentoId': 'f-boleto',
      'itens': [for (final e in itens.entries) {'produtoId': e.key, 'quantidade': e.value, 'precoUnit': 10.0}],
    },
    resposta: {'id': id, 'status': 'aberto', 'total': total, 'pedidoId': ?pedidoId},
    criadoEm: quando,
    atualizadoEm: quando,
  );
}
