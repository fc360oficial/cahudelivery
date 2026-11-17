import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:uuid/uuid.dart';

import '../core/api_client.dart';
import '../core/api_exception.dart';
import '../core/mensagens.dart';
import '../data/banco_local.dart';
import '../data/modelos.dart';
import '../data/sobreposicao.dart';
import 'conectividade.dart';

/// Ponto do GPS no momento da ação (pode faltar: a ação vale mesmo assim).
class PontoGps {
  const PontoGps(this.lat, this.lng, [this.precisaoM]);
  final double lat, lng;
  final double? precisaoM;
}

/// A carga do dia e tudo que o motorista registra nela.
///
/// Cada ação é gravada primeiro no aparelho (fila) e aparece na hora na tela; a fila sobe para o servidor
/// na ordem em que foi feita, assim que houver sinal. Sem sinal o motorista trabalha normalmente.
class CargaService extends ChangeNotifier {
  CargaService({
    required ApiClient api,
    required BancoLocal banco,
    required FonteConectividade conectividade,
    Future<List<int>> Function(String caminho)? lerArquivo,
    Future<void> Function(String caminho)? apagarArquivo,
    DateTime Function()? agora,
    this.intervalo = const Duration(minutes: 1),
  })  : _api = api,
        _banco = banco,
        _conectividade = conectividade,
        _lerArquivo = lerArquivo,
        _apagarArquivo = apagarArquivo,
        _agora = agora ?? DateTime.now;

  final ApiClient _api;
  final BancoLocal _banco;
  final FonteConectividade _conectividade;
  final Future<List<int>> Function(String caminho)? _lerArquivo;
  final Future<void> Function(String caminho)? _apagarArquivo;
  final DateTime Function() _agora;
  final Duration intervalo;
  static const _uuid = Uuid();

  Carga? _doServidor;
  List<Acao> _acoes = const [];
  bool _carregada = false;
  bool _semSinal = false;

  String? _erro;
  DateTime? _atualizadaEm;
  Timer? _relogio;
  StreamSubscription<bool>? _rede;

  /// A carga como deve aparecer: a do servidor com as ações ainda na fila aplicadas por cima.
  Carga? get carga {
    final c = _doServidor;
    if (c == null) return null;
    final vista = aplicarAcoes(c, _acoes);
    return vista.status == 'encerrada' ? null : vista;
  }

  bool get carregada => _carregada;
  bool get semSinal => _semSinal;
  String? get erro => _erro;
  DateTime? get atualizadaEm => _atualizadaEm;

  /// Ações feitas no aparelho e ainda não confirmadas pelo servidor.
  int get pendentes => _acoes.where((a) => a.recusa == null).length;

  /// Ações que o servidor recusou de vez (o motorista precisa avisar o CD).
  List<Acao> get recusadas => _acoes.where((a) => a.recusa != null).toList();

  /// Encerrou a rota no aparelho e ainda falta o servidor confirmar.
  bool get encerramentoPendente => _acoes.any((a) => a.tipo == TipoAcao.encerrar && a.recusa == null);

  Future<void> iniciar() async {
    _doServidor = await _banco.carga();
    _acoes = await _banco.acoes();
    _carregada = true;
    notifyListeners();
    _relogio?.cancel();
    _relogio = Timer.periodic(intervalo, (_) => sincronizar());
    _rede?.cancel();
    _rede = _conectividade.mudancas.listen((tem) {
      if (tem) sincronizar();
    });
    await sincronizar();
  }

  Future<void> parar() async {
    _relogio?.cancel();
    _rede?.cancel();
    _relogio = null;
    _rede = null;
  }

  Future<void>? _emAndamento;
  bool _repetir = false;

  /// Envia a fila e, com ela vazia, busca a carga do servidor. Sem sinal não faz nada (tenta de novo depois).
  /// Pedido no meio de um envio: espera e roda mais uma vez, para a ação nova não ficar para trás.
  Future<void> sincronizar() {
    if (_emAndamento != null) {
      _repetir = true;
      return _emAndamento!;
    }
    return _emAndamento = _rodar().whenComplete(() => _emAndamento = null);
  }

  Future<void> _rodar() async {
    do {
      _repetir = false;
      await _umaVez();
    } while (_repetir);
  }

  Future<void> _umaVez() async {

    try {
      final enviouTudo = await _enviarFila();
      if (enviouTudo) await _buscarCarga();
      _semSinal = false;
      _erro = null;
    } on SemConexao {
      _semSinal = true;
    } on ApiException catch (e) {
      _erro = mensagemDeErro(e);
    } finally {

      notifyListeners();
    }
  }

  Future<void> _buscarCarga() async {
    final r = await _api.get('/motorista/carga') as Map<String, dynamic>;
    final c = r['carga'] == null ? null : Carga.deJson(r['carga'] as Map<String, dynamic>);
    _doServidor = c;
    _atualizadaEm = _agora();
    await _banco.gravarCarga(c);
  }

  /// true = a fila ficou vazia (dá para confiar no que o servidor devolver).
  Future<bool> _enviarFila() async {
    for (final a in await _banco.acoes()) {
      if (a.recusa != null) continue;
      try {
        await _enviar(a);
        await _banco.removerAcao(a.id);
        for (final f in a.fotos.values) {
          await _apagarArquivo?.call(f);
        }
      } on SemConexao {
        _acoes = await _banco.acoes();
        rethrow;
      } catch (e) {
        if (!erroDefinitivo(e)) {
          await _banco.contarTentativa(a.id);
          _acoes = await _banco.acoes();
          rethrow;
        }
        await _banco.recusarAcao(a.id, mensagemDeErro(e));
      }
    }
    _acoes = await _banco.acoes();
    return _acoes.every((a) => a.recusa != null);
  }

  Future<void> _enviar(Acao a) async {
    final base = '/motorista/cargas/${a.cargaId}';
    final d = a.dados;
    Map<String, String> campos(Iterable<String> chaves) => {
          for (final k in chaves)
            if (d[k] != null && '${d[k]}'.isNotEmpty) k: d[k] is List ? (d[k] as List).join(',') : '${d[k]}',
        };
    Future<List<ArquivoEnvio>> arquivos() async => [
          for (final e in a.fotos.entries) ArquivoEnvio(e.key, '${e.key}.jpg', await (_lerArquivo ?? _semArquivo)(e.value)),
        ];
    switch (a.tipo) {
      case TipoAcao.iniciar:
        await _api.post('$base/iniciar', body: {'em': d['em']});
      case TipoAcao.encerrar:
        await _api.post('$base/encerrar', body: {'em': d['em']});
      case TipoAcao.chegada:
        await _api.post('$base/chegada', body: {'linhaIds': a.linhaIds, 'em': d['em'], 'lat': ?d['lat'], 'lng': ?d['lng']});
      case TipoAcao.entregue:
        await _api.multipart('$base/entregue', campos(['linhaIds', 'recebedorNome', 'recebedorDocumento', 'observacao', 'em', 'lat', 'lng']), await arquivos());
      case TipoAcao.naoEntregue:
        await _api.multipart('$base/nao-entregue', campos(['linhaIds', 'motivo', 'observacao', 'em', 'lat', 'lng']), await arquivos());
      case TipoAcao.ocorrencia:
        await _api.multipart('$base/ocorrencias',
            campos(['id', 'linhaId', 'tipo', 'produtoCodigo', 'produtoDescricao', 'quantidade', 'observacao', 'em']), await arquivos());
    }
  }

  static Future<List<int>> _semArquivo(String _) async => const [];

  // ---- o que o motorista faz --------------------------------------------------------------------

  Future<void> iniciarRota() => _registrar(TipoAcao.iniciar, {});

  Future<void> chegada(Parada p, PontoGps? gps) => _registrar(TipoAcao.chegada, {'linhaIds': p.linhaIds, ..._gps(gps)});

  Future<void> entregue(Parada p, {required String recebedorNome, String? recebedorDocumento, required String fotoAssinatura, String? fotoMercadoria, PontoGps? gps}) =>
      _registrar(
        TipoAcao.entregue,
        {'linhaIds': p.linhaIds, 'recebedorNome': recebedorNome.trim(), 'recebedorDocumento': recebedorDocumento?.trim(), ..._gps(gps)},
        fotos: {'assinatura': fotoAssinatura, 'mercadoria': ?fotoMercadoria},
      );

  Future<void> naoEntregue(Parada p, {required String motivo, String? observacao, String? fotoLocal, PontoGps? gps}) => _registrar(
        TipoAcao.naoEntregue,
        {'linhaIds': p.linhaIds, 'motivo': motivo, 'observacao': observacao?.trim(), ..._gps(gps)},
        fotos: {'foto': ?fotoLocal},
      );

  Future<void> ocorrencia(Parada p, {required String linhaId, required String tipo, ItemParada? item, double? quantidade, String? observacao, String? foto}) =>
      _registrar(
        TipoAcao.ocorrencia,
        {
          'id': _uuid.v4(),
          'linhaId': linhaId,
          'tipo': tipo,
          'produtoCodigo': item?.codigo,
          'produtoDescricao': item?.descricao,
          'quantidade': quantidade,
          'observacao': observacao?.trim(),
        },
        fotos: {'foto': ?foto},
      );

  Future<void> encerrar() => _registrar(TipoAcao.encerrar, {});

  Map<String, dynamic> _gps(PontoGps? g) => g == null ? {} : {'lat': g.lat, 'lng': g.lng};

  Future<void> _registrar(TipoAcao tipo, Map<String, dynamic> dados, {Map<String, String> fotos = const {}}) async {
    final c = _doServidor;
    if (c == null) throw StateError('Sem carga');
    final agora = _agora();
    await _banco.enfileirar(Acao(
      id: _uuid.v4(),
      tipo: tipo,
      cargaId: c.id,
      dados: {...dados, 'em': agora.toUtc().toIso8601String()},
      fotos: fotos,
      criadaEm: agora,
    ));
    _acoes = await _banco.acoes();
    notifyListeners();
    unawaited(sincronizar());
  }

  /// O motorista viu a recusa e avisou o CD: tira da lista.
  Future<void> dispensarRecusa(String id) async {
    await _banco.removerAcao(id);
    _acoes = await _banco.acoes();
    notifyListeners();
  }

  @override
  void dispose() {
    parar();
    super.dispose();
  }
}
