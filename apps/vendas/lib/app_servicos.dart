import 'package:flutter/widgets.dart';
import 'package:http/http.dart' as http;

import 'core/api_client.dart';
import 'core/token_store.dart';
import 'data/banco_local.dart';
import 'data/carga_repository.dart';
import 'data/meta_repository.dart';
import 'data/locais_repository.dart';
import 'data/rascunho.dart';
import 'data/repositorios.dart';
import 'services/carrinho_service.dart';
import 'services/conectividade.dart';
import 'services/fila_envio_service.dart';
import 'services/sessao_service.dart';
import 'services/sincronizacao_service.dart';

/// Contêiner de dependências do app (sem singletons globais: testes montam o
/// seu com banco em memória, tokens em memória e HTTP falso).
class AppServicos {
  AppServicos({
    required this.banco,
    required this.api,
    required this.sessao,
    required this.sincronizacao,
    required this.clientes,
    required this.produtos,
    required this.tabelas,
    required this.titulos,
    required this.historico,
    required this.meta,
    required this.pedidosLocais,
    required this.orcamentosLocais,
    required this.carrinho,
    required this.fila,
    required this.agora,
  });

  final BancoLocal banco;
  final ApiClient api;
  final SessaoService sessao;
  final SincronizacaoService sincronizacao;
  final ClientesRepository clientes;
  final ProdutosRepository produtos;
  final TabelasRepository tabelas;
  final TitulosRepository titulos;
  final HistoricoRepository historico;
  final MetaRepository meta;
  final PedidosLocaisRepository pedidosLocais;
  final OrcamentosLocaisRepository orcamentosLocais;
  final CarrinhoService carrinho;
  final FilaEnvioService fila;
  final DateTime Function() agora;

  /// Monta tudo e liga a sincronização ao login/logout.
  factory AppServicos.criar({
    required BancoLocal banco,
    required TokenStore tokens,
    required FonteConectividade conectividade,
    http.Client? httpClient,
    String? baseUrl,
    String? tenant,
    DateTime Function()? agora,
    Duration intervaloSync = const Duration(minutes: 15),
  }) {
    final relogio = agora ?? DateTime.now;
    final meta = MetaRepository(banco);
    final carga = CargaRepository(banco);
    final api = ApiClient(tokens: tokens, client: httpClient, baseUrl: baseUrl, tenant: tenant);
    final sync = SincronizacaoService(
      api: api,
      carga: carga,
      meta: meta,
      conectividade: conectividade,
      agora: relogio,
      intervalo: intervaloSync,
    );
    final sessao = SessaoService(api: api, carga: carga, meta: meta);
    final clientes = ClientesRepository(banco);
    final produtos = ProdutosRepository(banco);
    final tabelas = TabelasRepository(banco);
    final pedidosLocais = PedidosLocaisRepository(banco, meta);
    final orcamentosLocais = OrcamentosLocaisRepository(banco, meta);
    final fila = FilaEnvioService(api: api, pedidos: pedidosLocais, orcamentos: orcamentosLocais, agora: relogio);
    final carrinho = CarrinhoService(
        produtos: produtos, tabelas: tabelas, clientes: clientes, rascunhos: RascunhoRepository(banco, meta), agora: relogio);
    // Sincronizar = enviar a fila primeiro e só depois baixar a carga.
    sync.enviarFila = fila.enviarFila;
    sessao.aoLogar = () async {
      try {
        await fila.recuperarInterrompidos();
        await carrinho.restaurar();
      } catch (e) {
        debugPrint('ao logar: $e');
      }
      await sync.iniciar();
    };
    sessao.aoDeslogar = () async {
      carrinho.soltarMemoria();
      await sync.parar();
    };
    return AppServicos(
      banco: banco,
      api: api,
      sessao: sessao,
      sincronizacao: sync,
      clientes: clientes,
      produtos: produtos,
      tabelas: tabelas,
      titulos: TitulosRepository(banco),
      historico: HistoricoRepository(banco),
      meta: meta,
      pedidosLocais: pedidosLocais,
      orcamentosLocais: orcamentosLocais,
      carrinho: carrinho,
      fila: fila,
      agora: relogio,
    );
  }
}

/// Acesso aos serviços pela árvore de widgets: `Servicos.of(context).sincronizacao`.
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
