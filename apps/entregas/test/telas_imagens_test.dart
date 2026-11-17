@Tags(['imagens'])
library;

import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:fluxo_entregas/app_servicos.dart';
import 'package:fluxo_entregas/core/tema.dart';
import 'package:fluxo_entregas/core/token_store.dart';
import 'package:fluxo_entregas/features/bloqueio_localizacao_page.dart';
import 'package:fluxo_entregas/features/comprovante_page.dart';
import 'package:fluxo_entregas/features/home_shell.dart';
import 'package:fluxo_entregas/features/login_page.dart';
import 'package:fluxo_entregas/features/nao_entregue_page.dart';
import 'package:fluxo_entregas/features/ocorrencia_page.dart';
import 'package:fluxo_entregas/features/parada_page.dart';
import 'package:fluxo_entregas/services/fotos.dart';
import 'package:geolocator/geolocator.dart';
import 'package:intl/date_symbol_data_local.dart';

import 'apoio.dart';

/// IMAGENS DAS TELAS (390 x 844 dp, densidade 2, fontes reais), renderizadas fora da tela pelo flutter_test.
/// Dados fictícios. Pulado por padrão; para gerar:
///
///     flutter test test/telas_imagens_test.dart --run-skipped
///
/// Saída: pasta da variável de ambiente IMAGENS_DIR (padrão: build/telas).
void main() {
  final pasta = Directory(Platform.environment['IMAGENS_DIR'] ?? 'build/telas');

  setUpAll(() async {
    pasta.createSync(recursive: true);
    await _carregarFontes();
    await initializeDateFormatting('pt_BR');
  });

  Future<void> tela(
    WidgetTester t,
    String arquivo,
    Widget Function() construir, {
    Map<String, dynamic>? Function()? carga,
    LocationPermission permissao = LocationPermission.always,
    bool gps = true,
    bool logado = true,
    bool semSinal = false,
    Future<void> Function(AppServicos s)? preparar,
  }) async {
    t.view.physicalSize = const Size(780, 1688);
    t.view.devicePixelRatio = 2;
    addTearDown(t.view.resetPhysicalSize);
    addTearDown(t.view.resetDevicePixelRatio);
    late AppServicos s;
    final cargaAtual = carga ?? () => cargaJson(status: 'em_rota', n: 5);
    final servidor = ServidorFalso((p) {
      if (p.caminho == '/motorista/login') {
        return (200, {'accessToken': 'a', 'refreshToken': 'r', 'motorista': {'id': 'm1', 'nome': 'Edson da Silva'}, 'distribuidora': 'CAHU Distribuidora'});
      }
      if (p.caminho == '/motorista/carga') return (200, {'carga': cargaAtual()});
      return (200, {'ok': true});
    });
    final plataforma = PlataformaFalsa()
      ..perm = permissao
      ..gps = gps;
    await t.runAsync(() async {
      s = AppServicos.criar(
        banco: await bancoEmMemoria(),
        tokens: MemoriaTokenStore(),
        conectividade: RedeFalsa(),
        plataforma: plataforma,
        fotos: Fotos(),
        httpClient: servidor,
        baseUrl: 'http://x/v1',
      );
      if (logado) {
        await s.sessao.entrar('edson', 'senha');
        await s.carga.iniciar();
        await s.localizacao.verificar();
      }
      if (preparar != null) await preparar(s);
      if (semSinal) {
        servidor.semSinal = true;
        await s.carga.sincronizar();
      }
    });
    final chave = GlobalKey();
    await t.pumpWidget(RepaintBoundary(
      key: chave,
      child: Servicos(
        servicos: s,
        child: MaterialApp(
          debugShowCheckedModeBanner: false,
          theme: construirTema(familia: 'Roboto'),
          locale: const Locale('pt', 'BR'),
          supportedLocales: const [Locale('pt', 'BR')],
          localizationsDelegates: const [GlobalMaterialLocalizations.delegate, GlobalWidgetsLocalizations.delegate, GlobalCupertinoLocalizations.delegate],
          home: construir(),
        ),
      ),
    ));
    for (var i = 0; i < 6; i++) {
      await t.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 50)));
      await t.pump(const Duration(milliseconds: 60));
    }
    await t.runAsync(() async {
      final limite = chave.currentContext!.findRenderObject()! as RenderRepaintBoundary;
      final imagem = await limite.toImage(pixelRatio: 2);
      final bytes = (await imagem.toByteData(format: ui.ImageByteFormat.png))!;
      File('${pasta.path}/$arquivo').writeAsBytesSync(bytes.buffer.asUint8List());
      await s.carga.parar();
      s.localizacao.dispose();
    });
  }

  /// Carga em rota: 1 entregue, 1 não entregue, a 3ª com "Cheguei", 2 a fazer.
  Map<String, dynamic> emAndamento() {
    final c = cargaJson(status: 'em_rota', n: 5);
    final agora = DateTime.now().toUtc();
    c['saidaEm'] = agora.subtract(const Duration(hours: 2)).toIso8601String();
    final ps = c['paradas'] as List;
    const nomes = ['Mercadinho Santa Luzia', 'Mercearia do Zé', 'Supermercado Litoral', 'Lanchonete Ponto Certo', 'Padaria Estrela do Mar'];
    const ruas = ['Rua do Sol', 'Rua Santo Elias', 'Av. Bernardo Vieira de Melo', 'Rua Dez', 'Av. Barreto de Menezes'];
    const bairros = ['Prazeres', 'Cajueiro Seco', 'Candeias', 'Piedade', 'Prazeres'];
    for (var i = 0; i < ps.length; i++) {
      final p = ps[i] as Map<String, dynamic>;
      p['cliente'] = nomes[i];
      (p['endereco'] as Map)['logradouro'] = ruas[i];
      (p['endereco'] as Map)['numero'] = '${120 + i * 37}';
      (p['endereco'] as Map)['bairro'] = bairros[i];
      (p['endereco'] as Map)['cidade'] = 'Jaboatão dos Guararapes';
    }
    ps[0]['status'] = 'entregue';
    ps[0]['chegadaEm'] = agora.subtract(const Duration(minutes: 95)).toIso8601String();
    ps[0]['concluidaEm'] = agora.subtract(const Duration(minutes: 84)).toIso8601String();
    ps[1]['status'] = 'nao_entregue';
    ps[1]['concluidaEm'] = agora.subtract(const Duration(minutes: 52)).toIso8601String();
    // A 3ª tem duas notas (uma parada, uma assinatura).
    ps[2]['linhaIds'] = ['linha-3', 'linha-3b'];
    ps[2]['notas'] = [
      {'numero': '48220', 'origem': 'televendas', 'pedidoNumero': '123456', 'volumes': 26},
      {'numero': '48221', 'origem': 'televendas', 'pedidoNumero': '123457', 'volumes': 12},
    ];
    ps[2]['volumes'] = 38;
    ps[2]['status'] = 'no_cliente';
    ps[2]['chegadaEm'] = agora.subtract(const Duration(minutes: 14)).toIso8601String();
    (ps[2]['endereco'] as Map)['complemento'] = 'Entrega pela doca lateral, procurar Luciana.';
    return c;
  }

  testWidgets('01 login', (t) async {
    await tela(t, '01-login.png', () => const LoginPage(), logado: false);
  });

  testWidgets('02 bloqueio: só durante o uso', (t) async {
    await tela(t, '02-bloqueio-durante-uso.png', () => const BloqueioLocalizacaoPage(), permissao: LocationPermission.whileInUse);
  });

  testWidgets('03 bloqueio: GPS desligado', (t) async {
    await tela(t, '03-bloqueio-gps.png', () => const BloqueioLocalizacaoPage(), gps: false);
  });

  testWidgets('04 início: carga liberada, ainda no CD', (t) async {
    await tela(t, '04-inicio-no-cd.png', () => const HomeShell(), carga: () => cargaJson(status: 'autorizada', n: 5));
  });

  testWidgets('05 início em rota, sem sinal', (t) async {
    await tela(t, '05-inicio-em-rota.png', () => const HomeShell(), carga: emAndamento, semSinal: true);
  });

  testWidgets('06 parada a caminho', (t) async {
    await tela(t, '06-parada-a-caminho.png', () => const ParadaPage(chave: 'linha-4'), carga: emAndamento);
  });

  testWidgets('07 parada no cliente', (t) async {
    await tela(t, '07-parada-no-cliente.png', () => const ParadaPage(chave: 'linha-3'), carga: emAndamento);
  });

  testWidgets('08 comprovante', (t) async {
    await tela(t, '08-comprovante.png', () => const ComprovantePage(chave: 'linha-3'), carga: emAndamento);
  });

  testWidgets('09 ocorrência', (t) async {
    await tela(t, '09-ocorrencia.png', () => const OcorrenciaPage(chave: 'linha-3'), carga: emAndamento);
  });

  testWidgets('10 não entregue', (t) async {
    await tela(t, '10-nao-entregue.png', () => const NaoEntreguePage(chave: 'linha-4'), carga: emAndamento);
  });

  testWidgets('11 entrega confirmada', (t) async {
    await tela(t, '11-confirmada.png', () => const EntregaConfirmadaPage(chave: 'linha-1'), carga: emAndamento);
  });

  testWidgets('12 sem carga', (t) async {
    await tela(t, '12-sem-carga.png', () => const HomeShell(), carga: () => null);
  });
}

Future<void> _carregarFontes() async {
  final raiz = Platform.environment['FLUTTER_ROOT'] ?? 'C:/Users/Administrador/flutter';
  final dir = '$raiz/bin/cache/artifacts/material_fonts';
  Future<ByteData> ler(String nome) async => ByteData.view(Uint8List.fromList(File('$dir/$nome').readAsBytesSync()).buffer);
  final roboto = FontLoader('Roboto')
    ..addFont(ler('roboto-regular.ttf'))
    ..addFont(ler('roboto-medium.ttf'))
    ..addFont(ler('roboto-bold.ttf'))
    ..addFont(ler('roboto-black.ttf'));
  await roboto.load();
  final icones = FontLoader('MaterialIcons')..addFont(ler('materialicons-regular.otf'));
  await icones.load();
}
