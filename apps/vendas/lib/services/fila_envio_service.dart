import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:uuid/uuid.dart';

import '../core/api_client.dart';
import '../core/api_exception.dart';
import '../core/mensagens.dart';
import '../data/locais_repository.dart';
import '../data/pedido_local.dart';

/// Como terminou uma tentativa de enviar (ou de enfileirar) um pedido/orçamento.
enum DesfechoEnvio {
  /// Pedido aceito (`RECEBIDO`) ou orçamento gravado no servidor.
  enviado,

  /// Sem internet (ou servidor fora do ar): ficou guardado e sobe sozinho depois.
  naFila,

  /// O servidor reteve o pedido (`AGUARDANDO_VENDEDOR`): preço, estoque ou crédito mudaram.
  retido,

  /// Recusa definitiva: nunca é reenviado sozinho.
  recusado,
}

class ResultadoEnvio {
  const ResultadoEnvio({
    required this.id,
    required this.orcamento,
    required this.desfecho,
    this.numero,
    this.total,
    this.divergencias = const [],
    this.mensagem,
  });

  /// UUID local (= `idDispositivo` do pedido ou id do orçamento).
  final String id;
  final bool orcamento;
  final DesfechoEnvio desfecho;

  /// Número do pedido no servidor (nulo na fila, no orçamento e na recusa).
  final int? numero;
  final double? total;
  final List<Divergencia> divergencias;

  /// Texto da recusa, em português.
  final String? mensagem;
}

/// Fila de envio de pedidos e orçamentos feitos no aparelho.
///
/// - [enviarPedido]/[salvarOrcamento] gravam em `pedidos_locais`/`orcamentos_locais` e
///   tentam enviar na hora; sem internet o item fica na fila.
/// - [enviarFila] manda tudo que está esperando, na ordem de criação, UMA execução por vez
///   (chamadas simultâneas esperam a anterior). É ligada à sincronização (envia antes de baixar).
/// - Rede caiu, tempo esgotado, 5xx e 429: continua na fila e a fila PARA (para manter a ordem).
/// - 4xx (exceto 401, 408, 429): recusa definitiva, com o motivo em português; não tenta de novo.
/// - O mesmo UUID vai em toda tentativa, então reenviar nunca duplica no servidor.
class FilaEnvioService extends ChangeNotifier {
  FilaEnvioService({
    required ApiClient api,
    required PedidosLocaisRepository pedidos,
    required OrcamentosLocaisRepository orcamentos,
    DateTime Function()? agora,
    String Function()? novoId,
  })  : _api = api,
        _pedidos = pedidos,
        _orcamentos = orcamentos,
        _agora = agora ?? DateTime.now,
        _novoId = novoId ?? (() => const Uuid().v4());

  final ApiClient _api;
  final PedidosLocaisRepository _pedidos;
  final OrcamentosLocaisRepository _orcamentos;
  final DateTime Function() _agora;
  final String Function() _novoId;

  Future<void> _trava = Future.value();
  bool _disposto = false;

  int _naFila = 0, _retidos = 0, _recusados = 0;

  /// Pedidos + orçamentos esperando para subir ("Na fila: N").
  int get naFila => _naFila;

  /// Pedidos retidos locais, esperando o vendedor confirmar ou cancelar.
  int get retidos => _retidos;

  /// Pedidos recusados de vez (o vendedor precisa olhar).
  int get recusados => _recusados;

  /// Recarrega os contadores das tabelas locais (chame ao abrir telas que os mostram).
  Future<void> atualizarContadores() async {
    try {
      final n = await _pedidos.contar(EstadoPedido.aguardandoEnvio) +
          await _pedidos.contar(EstadoPedido.enviando) +
          await _orcamentos.contar(EstadoOrcamento.local);
      final r = await _pedidos.contar(EstadoPedido.retido);
      final x = await _pedidos.contar(EstadoPedido.recusado);
      if (n != _naFila || r != _retidos || x != _recusados) {
        _naFila = n;
        _retidos = r;
        _recusados = x;
        notifyListeners();
      }
    } catch (e) {
      debugPrint('contadores da fila: $e');
    }
  }

  /// Ao abrir o app: o que ficou `enviando` (app morto no meio do envio) volta para a fila.
  Future<void> recuperarInterrompidos() async {
    await _pedidos.recolocarInterrompidos(_agora());
    await atualizarContadores();
  }

  /// Grava o pedido (estado `aguardando_envio`, UUID novo) e tenta enviar agora. Quem chama
  /// pode descartar o rascunho assim que este método começar: o pedido já está no banco.
  Future<ResultadoEnvio> enviarPedido(NovoPedido p) async {
    final agora = _agora();
    final id = _novoId();
    final vendedor = await _pedidos.vendedorObrigatorio();
    await _pedidos.inserir(PedidoLocal(
      id: id,
      vendedorId: vendedor,
      clienteId: p.clienteId,
      tabelaId: p.tabelaId,
      formaId: p.formaId,
      total: p.total,
      estado: EstadoPedido.aguardandoEnvio,
      corpo: corpoDoPedido(idDispositivo: id, pedido: p, criadoNoAparelhoEm: agora),
      criadoEm: agora,
      atualizadoEm: agora,
    ));
    await atualizarContadores();
    await enviarFila();
    final r = await _pedidos.porId(id);
    return _resultadoDoPedido(r!);
  }

  /// Grava o orçamento (estado `local`) e tenta enviar agora. [id] existente = nova versão do
  /// mesmo orçamento (o `PUT` é idempotente por id).
  Future<ResultadoEnvio> salvarOrcamento(NovoOrcamento o, {String? id}) async {
    final agora = _agora();
    final oid = id ?? _novoId();
    final vendedor = await _orcamentos.vendedorObrigatorio();
    final anterior = id == null ? null : await _orcamentos.porId(id);
    await _orcamentos.inserir(OrcamentoLocal(
      id: oid,
      vendedorId: vendedor,
      clienteId: o.clienteId,
      tabelaId: o.tabelaId,
      formaId: o.formaId,
      total: o.total,
      estado: EstadoOrcamento.local,
      corpo: corpoDoOrcamento(o),
      criadoEm: anterior?.criadoEm ?? agora,
      atualizadoEm: agora,
    ));
    await atualizarContadores();
    await enviarFila();
    final r = await _orcamentos.porId(oid);
    return _resultadoDoOrcamento(r!);
  }

  /// Envia tudo que espera, do mais antigo ao mais novo (pedidos e orçamentos juntos).
  /// Nunca lança: falhas ficam gravadas em cada item.
  Future<void> enviarFila() {
    final f = _trava.then((_) => _rodar());
    _trava = f.catchError((Object e) {
      debugPrint('fila de envio: $e');
    });
    return _trava;
  }

  Future<void> _rodar() async {
    final pedidos = await _pedidos.aguardandoEnvio();
    final orcamentos = await _orcamentos.aguardandoEnvio();
    final fila = <({DateTime criadoEm, PedidoLocal? p, OrcamentoLocal? o})>[
      for (final p in pedidos) (criadoEm: p.criadoEm, p: p, o: null),
      for (final o in orcamentos) (criadoEm: o.criadoEm, p: null, o: o),
    ]..sort((a, b) => a.criadoEm.compareTo(b.criadoEm));
    try {
      for (final item in fila) {
        final seguir = item.p != null ? await _enviarPedido(item.p!) : await _enviarOrcamento(item.o!);
        if (!seguir) break;
      }
    } finally {
      await atualizarContadores();
    }
  }

  /// true = pode seguir para o próximo; false = parar a fila (sem rede/servidor/sessão).
  Future<bool> _enviarPedido(PedidoLocal p) async {
    await _pedidos.atualizar(
        p.id, {'estado': EstadoPedido.enviando, 'tentativas': p.tentativas + 1}, _agora());
    try {
      final resp = Map<String, dynamic>.from(await _api.post('/vendas/pedidos', body: p.corpo) as Map);
      final retido = resp['status'] == 'AGUARDANDO_VENDEDOR';
      await _pedidos.atualizar(
          p.id,
          {
            'estado': retido ? EstadoPedido.retido : EstadoPedido.enviado,
            'resposta_json': _json(resp),
            'servidor_numero': (resp['numero'] as num?)?.toInt(),
            'enviado_em': _agora().toUtc().toIso8601String(),
            'motivo': null,
            'codigo_erro': null,
          },
          _agora());
      return true;
    } on SemConexao {
      await _voltarParaFila(p.id);
      return false;
    } on ApiException catch (e) {
      if (!_definitiva(e)) {
        await _voltarParaFila(p.id);
        return false;
      }
      await _pedidos.atualizar(
          p.id, {'estado': EstadoPedido.recusado, 'motivo': mensagemDaRecusa(e), 'codigo_erro': e.codigo}, _agora());
      return true;
    } catch (e) {
      debugPrint('enviar pedido ${p.id}: $e');
      await _voltarParaFila(p.id);
      return false;
    }
  }

  Future<void> _voltarParaFila(String id) =>
      _pedidos.atualizar(id, {'estado': EstadoPedido.aguardandoEnvio}, _agora());

  Future<bool> _enviarOrcamento(OrcamentoLocal o) async {
    await _orcamentos.atualizar(o.id, {'tentativas': o.tentativas + 1}, _agora());
    try {
      final resp = await _api.put('/vendas/orcamentos/${o.id}', body: o.corpo);
      await _orcamentos.atualizar(
          o.id,
          {
            'estado': EstadoOrcamento.sincronizado,
            'resposta_json': resp is Map ? _json(Map<String, dynamic>.from(resp)) : null,
            'sincronizado_em': _agora().toUtc().toIso8601String(),
            'motivo': null,
          },
          _agora());
      return true;
    } on SemConexao {
      return false;
    } on ApiException catch (e) {
      if (!_definitiva(e)) return false;
      await _orcamentos.atualizar(o.id, {'estado': EstadoOrcamento.recusado, 'motivo': mensagemDaRecusa(e)}, _agora());
      return true;
    } catch (e) {
      debugPrint('enviar orçamento ${o.id}: $e');
      return false;
    }
  }

  /// 4xx que repetir não resolve. 401 (sessão), 408 e 429 (limite de chamadas) são passageiros.
  static bool _definitiva(ApiException e) =>
      e.statusCode >= 400 && e.statusCode < 500 && e.statusCode != 401 && e.statusCode != 408 && e.statusCode != 429;

  /// Frase em português para uma recusa: texto próprio por código; sem código usa a do servidor.
  static String mensagemDaRecusa(ApiException e) {
    final m = mensagemDeErro(e);
    return m.trim().isEmpty ? 'O servidor recusou o envio.' : m;
  }

  static String _json(Map<String, dynamic> m) => jsonEncode(m);

  ResultadoEnvio _resultadoDoPedido(PedidoLocal r) {
    switch (r.estado) {
      case EstadoPedido.enviado:
        return ResultadoEnvio(
            id: r.id, orcamento: false, desfecho: DesfechoEnvio.enviado, numero: r.servidorNumero, total: r.totalServidor);
      case EstadoPedido.retido:
        return ResultadoEnvio(
            id: r.id,
            orcamento: false,
            desfecho: DesfechoEnvio.retido,
            numero: r.servidorNumero,
            total: r.totalServidor,
            divergencias: r.divergencias);
      case EstadoPedido.recusado:
        return ResultadoEnvio(id: r.id, orcamento: false, desfecho: DesfechoEnvio.recusado, mensagem: r.motivo);
      default:
        return ResultadoEnvio(id: r.id, orcamento: false, desfecho: DesfechoEnvio.naFila, total: r.total);
    }
  }

  ResultadoEnvio _resultadoDoOrcamento(OrcamentoLocal r) => switch (r.estado) {
        EstadoOrcamento.sincronizado =>
          ResultadoEnvio(id: r.id, orcamento: true, desfecho: DesfechoEnvio.enviado, total: r.total),
        EstadoOrcamento.recusado =>
          ResultadoEnvio(id: r.id, orcamento: true, desfecho: DesfechoEnvio.recusado, mensagem: r.motivo),
        _ => ResultadoEnvio(id: r.id, orcamento: true, desfecho: DesfechoEnvio.naFila, total: r.total),
      };

  @override
  void notifyListeners() {
    if (!_disposto) super.notifyListeners();
  }

  @override
  void dispose() {
    _disposto = true;
    super.dispose();
  }
}
