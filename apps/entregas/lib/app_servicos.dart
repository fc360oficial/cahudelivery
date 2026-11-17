import 'package:flutter/widgets.dart';
import 'package:http/http.dart' as http;

import 'core/api_client.dart';
import 'core/token_store.dart';
import 'data/banco_local.dart';
import 'services/carga_service.dart';
import 'services/conectividade.dart';
import 'services/fotos.dart';
import 'services/localizacao_service.dart';
import 'services/sessao_service.dart';

/// Contêiner de dependências (sem singletons: os testes montam o seu com banco em memória e HTTP falso).
class AppServicos {
  AppServicos({required this.banco, required this.api, required this.sessao, required this.carga, required this.localizacao, required this.fotos});

  final BancoLocal banco;
  final ApiClient api;
  final SessaoService sessao;
  final CargaService carga;
  final LocalizacaoService localizacao;
  final Fotos fotos;

  factory AppServicos.criar({
    required BancoLocal banco,
    required TokenStore tokens,
    required FonteConectividade conectividade,
    required PlataformaLocalizacao plataforma,
    required Fotos fotos,
    http.Client? httpClient,
    String? baseUrl,
  }) {
    final api = ApiClient(tokens: tokens, client: httpClient, baseUrl: baseUrl);
    final carga = CargaService(api: api, banco: banco, conectividade: conectividade, lerArquivo: fotos.ler, apagarArquivo: fotos.apagar);
    final localizacao = LocalizacaoService(plataforma: plataforma, api: api, banco: banco);
    final sessao = SessaoService(api: api, banco: banco);
    // Com a carga em rota e a localização liberada, o celular manda a posição; fora disso, não.
    void ajustarAcompanhamento() {
      final c = carga.carga;
      if (sessao.estado == EstadoSessao.logado && c != null && c.emRota && localizacao.liberado) {
        localizacao.acompanhar();
      } else if (localizacao.acompanhando) {
        localizacao.pararAcompanhamento();
      }
    }

    carga.addListener(ajustarAcompanhamento);
    localizacao.addListener(ajustarAcompanhamento);
    sessao.aoLogar = () {
      carga.iniciar().catchError((Object e) => debugPrint('carga: $e'));
      localizacao.verificar();
      localizacao.vigiar();
    };
    sessao.aoDeslogar = () async {
      await carga.parar();
      await localizacao.pararAcompanhamento();
    };
    return AppServicos(banco: banco, api: api, sessao: sessao, carga: carga, localizacao: localizacao, fotos: fotos);
  }
}

/// Acesso aos serviços pela árvore de widgets: `Servicos.of(context).carga`.
class Servicos extends InheritedWidget {
  const Servicos({super.key, required this.servicos, required super.child});
  final AppServicos servicos;

  static AppServicos of(BuildContext context) {
    final s = context.dependOnInheritedWidgetOfExactType<Servicos>();
    assert(s != null, 'Servicos não encontrado: envolva o app em Servicos(...)');
    return s!.servicos;
  }

  @override
  bool updateShouldNotify(Servicos old) => servicos != old.servicos;
}
