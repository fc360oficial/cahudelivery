import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';

import '../core/api_client.dart';
import '../core/api_exception.dart';
import '../data/locais_repository.dart';
import '../data/pedido_local.dart';
import '../data/situacao_pedido.dart';
import 'fila_envio_service.dart';

/// Como terminou "Confirmar com os valores atuais".
class ResultadoConfirmacao {
  const ResultadoConfirmacao({required this.confirmado, this.divergencias = const [], this.mensagem, this.jaResolvido = false});

  /// O servidor aceitou: o pedido segue para o ERP.
  final bool confirmado;

  /// O que ainda barra (estoque, crédito, produto sem preço). O pedido continua retido.
  final List<Divergencia> divergencias;
  final String? mensagem;

  /// O pedido já tinha sido resolvido em outro aparelho (a lista foi atualizada).
  final bool jaResolvido;
}

/// Pedidos e orçamentos do vendedor: reconciliação do que está no aparelho com o servidor
/// (`GET /vendas/pedidos` e `GET /vendas/orcamentos`), confirmar/cancelar pedido retido e
/// cancelar orçamento. As telas leem das tabelas locais; este serviço só as mantém em dia.
///
/// Chave da reconciliação: o `idDispositivo` do pedido (= `pedidos_locais.id`) e o id do orçamento.
/// Pedido que só existe no servidor (outro aparelho) entra em `pedidos_locais` com `doServidor`.
class PedidosService extends ChangeNotifier {
  PedidosService({
    required ApiClient api,
    required PedidosLocaisRepository pedidos,
    required OrcamentosLocaisRepository orcamentos,
    required FilaEnvioService fila,
    DateTime Function()? agora,
  })  : _api = api,
        _pedidos = pedidos,
        _orcamentos = orcamentos,
        _fila = fila,
        _agora = agora ?? DateTime.now;

  final ApiClient _api;
  final PedidosLocaisRepository _pedidos;
  final OrcamentosLocaisRepository _orcamentos;
  final FilaEnvioService _fila;
  final DateTime Function() _agora;

  /// Filtro escolhido na aba Pedidos (o Início muda para "Retidos" ou "Na fila" antes de abrir a aba).
  final ValueNotifier<FiltroPedido> filtro = ValueNotifier(FiltroPedido.todos);

  int _versao = 0;

  /// Sobe a cada mudança nas tabelas locais feita por este serviço (as telas recarregam).
  int get versao => _versao;

  Future<bool>? _reconciliando;
  bool _disposto = false;

  void _mudou() {
    _versao++;
    if (!_disposto) notifyListeners();
  }

  /// Reconcilia pedidos e orçamentos com o servidor. Uma execução por vez (chamadas
  /// simultâneas compartilham a mesma). Nunca lança: devolve false se não deu (sem rede...).
  Future<bool> reconciliar() => _reconciliando ??= _reconciliarDeVerdade().whenComplete(() => _reconciliando = null);

  Future<bool> _reconciliarDeVerdade() async {
    var ok = true;
    try {
      await reconciliarPedidos();
    } catch (e) {
      ok = false;
      debugPrint('reconciliar pedidos: $e');
    }
    try {
      await reconciliarOrcamentos();
    } catch (e) {
      ok = false;
      debugPrint('reconciliar orçamentos: $e');
    }
    try {
      await _fila.atualizarContadores();
    } catch (e) {
      debugPrint('contadores: $e');
    }
    _mudou();
    return ok;
  }

  static Map<String, dynamic> _resposta(Map item) => {
        'id': item['id'],
        'numero': item['numero'],
        'status': item['status'],
        'total': item['total'],
        'divergencias': item['divergencias'] ?? const [],
      };

  /// `GET /vendas/pedidos`: atualiza o status dos pedidos do aparelho e traz os de outros aparelhos.
  Future<void> reconciliarPedidos() async {
    final lista = await _api.get('/vendas/pedidos');
    if (lista is! List) return;
    final vendedor = await _pedidos.vendedorObrigatorio();
    final locais = {for (final p in await _pedidos.listar()) p.id: p};
    for (final bruto in lista) {
      final item = Map<String, dynamic>.from(bruto as Map);
      final status = '${item['status']}'.toUpperCase();
      final chave = (item['idDispositivo'] as String?) ?? 'srv-${item['id']}';
      final estado = switch (status) {
        'AGUARDANDO_VENDEDOR' => EstadoPedido.retido,
        'CANCELADO' => EstadoPedido.cancelado,
        _ => EstadoPedido.enviado,
      };
      final total = (item['total'] as num).toDouble();
      final criadoEm = DateTime.parse(item['criadoEm'] as String);
      final local = locais[chave];
      if (local == null) {
        await _pedidos.inserir(PedidoLocal(
          id: chave,
          vendedorId: vendedor,
          clienteId: item['clienteId'] as String,
          total: total,
          estado: estado,
          corpo: {'doServidor': true, 'clienteId': item['clienteId'], 'itens': const []},
          resposta: _resposta(item),
          servidorNumero: (item['numero'] as num?)?.toInt(),
          criadoEm: criadoEm,
          atualizadoEm: _agora(),
          enviadoEm: criadoEm,
        ));
        continue;
      }
      if (local.estado == EstadoPedido.enviando) continue; // envio em curso: a resposta dele manda
      final resposta = {...?local.resposta, ..._resposta(item)};
      final mudou = local.estado != estado ||
          local.statusServidor != item['status'] ||
          local.resposta?['total'] != item['total'] ||
          local.servidorNumero != (item['numero'] as num?)?.toInt();
      if (!mudou) continue;
      await _pedidos.atualizar(
          chave,
          {
            'estado': estado,
            'resposta_json': jsonEncode(resposta),
            'servidor_numero': (item['numero'] as num?)?.toInt(),
            if (local.enviadoEm == null) 'enviado_em': criadoEm.toUtc().toIso8601String(),
            'motivo': null,
          },
          _agora());
    }
  }

  /// `GET /vendas/orcamentos`: status (aberto, convertido, cancelado) e orçamentos de outros aparelhos.
  /// Orçamento com alteração ainda não enviada (`local`) não é sobrescrito.
  Future<void> reconciliarOrcamentos() async {
    final lista = await _api.get('/vendas/orcamentos');
    if (lista is! List) return;
    final vendedor = await _orcamentos.vendedorObrigatorio();
    final locais = {for (final o in await _orcamentos.listar()) o.id: o};
    for (final bruto in lista) {
      final item = Map<String, dynamic>.from(bruto as Map);
      final id = item['id'] as String;
      final estado = switch ('${item['status']}') {
        'convertido' => EstadoOrcamento.convertido,
        'cancelado' => EstadoOrcamento.cancelado,
        _ => EstadoOrcamento.sincronizado,
      };
      final observacoes = item['observacoes'] as String?;
      final corpo = {
        'clienteId': item['clienteId'],
        'tabelaPrecoId': item['tabelaPrecoId'],
        if (item['formaPagamentoId'] != null) 'formaPagamentoId': item['formaPagamentoId'],
        if (observacoes != null && observacoes.trim().isNotEmpty) 'observacoes': observacoes,
        'itens': item['itens'] ?? const [],
      };
      final resposta = {'id': id, 'status': item['status'], 'total': item['total'], 'pedidoId': item['pedidoId']};
      final total = (item['total'] as num).toDouble();
      final local = locais[id];
      if (local == null) {
        await _orcamentos.inserir(OrcamentoLocal(
          id: id,
          vendedorId: vendedor,
          clienteId: item['clienteId'] as String,
          tabelaId: item['tabelaPrecoId'] as String?,
          formaId: item['formaPagamentoId'] as String?,
          total: total,
          estado: estado,
          corpo: corpo,
          resposta: resposta,
          criadoEm: DateTime.parse(item['criadoEm'] as String),
          atualizadoEm: DateTime.parse(item['atualizadoEm'] as String),
          sincronizadoEm: _agora(),
        ));
        continue;
      }
      if (local.estado == EstadoOrcamento.local || local.estado == EstadoOrcamento.recusado) continue;
      await _orcamentos.atualizar(
          id,
          {
            'estado': estado,
            'total': total,
            'tabela_id': item['tabelaPrecoId'],
            'forma_id': item['formaPagamentoId'],
            'corpo_json': jsonEncode(corpo),
            'resposta_json': jsonEncode(resposta),
          },
          _agora());
    }
  }

  // ---- pedido retido ----

  /// "Confirmar com os valores atuais". Precisa de internet (lança [SemConexao] sem ela).
  /// O servidor devolve só número, status e total; os itens guardam o preço atual das divergências de preço.
  Future<ResultadoConfirmacao> confirmar(PedidoLocal p) async {
    final sid = p.servidorId;
    if (sid == null) throw StateError('Pedido sem id do servidor.');
    try {
      final resp = Map<String, dynamic>.from(await _api.post('/vendas/pedidos/$sid/confirmar') as Map);
      final itens = itensComPrecoAtual(p);
      final corpo = {...p.corpo, if (itens.isNotEmpty) 'itens': itens.map((i) => i.toJson()).toList()};
      await _pedidos.atualizar(
          p.id,
          {
            'estado': EstadoPedido.enviado,
            'total': (resp['total'] as num).toDouble(),
            'corpo_json': jsonEncode(corpo),
            'resposta_json': jsonEncode({...?p.resposta, ...resp, 'divergencias': const [], 'confirmadoEm': _agora().toUtc().toIso8601String()}),
            'servidor_numero': (resp['numero'] as num?)?.toInt() ?? p.servidorNumero,
            'motivo': null,
          },
          _agora());
      await _fila.atualizarContadores();
      _mudou();
      return const ResultadoConfirmacao(confirmado: true);
    } on SemConexao {
      rethrow;
    } on ApiException catch (e) {
      if (e.codigo == 'AINDA_DIVERGENTE') {
        final divs = divergenciasDe(e.corpo);
        await _pedidos.atualizar(
            p.id, {'resposta_json': jsonEncode({...?p.resposta, 'divergencias': divs.map((d) => d.toJson()).toList()})}, _agora());
        _mudou();
        return ResultadoConfirmacao(confirmado: false, divergencias: divs, mensagem: e.message);
      }
      if (e.statusCode == 404) {
        await reconciliar();
        return const ResultadoConfirmacao(
            confirmado: false, jaResolvido: true, mensagem: 'Este pedido já foi resolvido. A lista foi atualizada.');
      }
      rethrow;
    }
  }

  /// "Cancelar pedido" retido. Precisa de internet. Devolve false se o pedido já tinha sido resolvido.
  Future<bool> cancelarRetido(PedidoLocal p) async {
    final sid = p.servidorId;
    if (sid == null) throw StateError('Pedido sem id do servidor.');
    try {
      await _api.post('/vendas/pedidos/$sid/cancelar');
    } on SemConexao {
      rethrow;
    } on ApiException catch (e) {
      if (e.statusCode == 404) {
        await reconciliar();
        return false;
      }
      rethrow;
    }
    await _pedidos.atualizar(
        p.id,
        {
          'estado': EstadoPedido.cancelado,
          'resposta_json': jsonEncode({...?p.resposta, 'status': 'CANCELADO', 'canceladoEm': _agora().toUtc().toIso8601String()}),
        },
        _agora());
    // Orçamento que virou este pedido volta a ficar aberto no servidor.
    try {
      await reconciliarOrcamentos();
    } catch (e) {
      debugPrint('orçamentos depois de cancelar: $e');
    }
    await _fila.atualizarContadores();
    _mudou();
    return true;
  }

  /// "Descartar" um pedido recusado (some da lista).
  Future<void> descartar(String id) async {
    await _pedidos.remover(id);
    await _fila.atualizarContadores();
    _mudou();
  }

  // ---- orçamento ----

  /// "Cancelar orçamento" aberto. Precisa de internet. Devolve false se já estava fechado.
  Future<bool> cancelarOrcamento(OrcamentoLocal o) async {
    try {
      await _api.post('/vendas/orcamentos/${o.id}/cancelar');
    } on SemConexao {
      rethrow;
    } on ApiException catch (e) {
      if (e.statusCode == 404) {
        await reconciliar();
        return false;
      }
      rethrow;
    }
    await _orcamentos.atualizar(
        o.id, {'estado': EstadoOrcamento.cancelado, 'resposta_json': jsonEncode({...?o.resposta, 'status': 'cancelado'})}, _agora());
    _mudou();
    return true;
  }

  Future<void> descartarOrcamento(String id) async {
    await _orcamentos.remover(id);
    await _fila.atualizarContadores();
    _mudou();
  }

  @override
  void dispose() {
    _disposto = true;
    filtro.dispose();
    super.dispose();
  }
}
