import 'dart:async';

import 'package:flutter/foundation.dart';

import '../core/api_client.dart';
import '../core/api_exception.dart';
import '../data/carga_repository.dart';
import '../data/meta_repository.dart';
import '../data/modelos.dart';
import 'conectividade.dart';

enum SituacaoSync { ok, semConexao, sessaoExpirada, erro }

class ResultadoSincronizacao {
  const ResultadoSincronizacao(this.situacao, [this.mensagem]);
  final SituacaoSync situacao;
  final String? mensagem;
  bool get ok => situacao == SituacaoSync.ok;
}

/// Baixa a carga do servidor e substitui o espelho local numa transação.
///
/// Gatilhos: [iniciar] (ao abrir), conexão que volta, [sincronizar] manual
/// (pull-to-refresh / botão) e a cada [intervalo] (15 min) enquanto o app está em
/// primeiro plano ([pausar]/[retomar] seguem o ciclo de vida do app).
///
/// Várias chamadas simultâneas a [sincronizar] compartilham UMA execução.
/// Estados para a UI (ChangeNotifier): [sincronizando], [online], [ultimaSincronizacao],
/// [dadosAntigos], [ultimoErro].
class SincronizacaoService extends ChangeNotifier {
  SincronizacaoService({
    required ApiClient api,
    required CargaRepository carga,
    required MetaRepository meta,
    required FonteConectividade conectividade,
    DateTime Function()? agora,
    this.intervalo = const Duration(minutes: 15),
    this.limiteDadosAntigos = const Duration(hours: 12),
  })  : _api = api,
        _carga = carga,
        _meta = meta,
        _conectividade = conectividade,
        _agora = agora ?? DateTime.now;

  final ApiClient _api;
  final CargaRepository _carga;
  final MetaRepository _meta;
  final FonteConectividade _conectividade;
  final DateTime Function() _agora;
  final Duration intervalo;
  final Duration limiteDadosAntigos;

  /// Ponto de extensão (tarefa 7): envia a fila de pedidos/orçamentos ANTES de baixar a carga.
  /// Falhas aqui não impedem o download (a fila continua para a próxima vez).
  Future<void> Function()? enviarFila;

  /// Chamado depois que o espelho foi trocado com sucesso (telas recarregam).
  final ValueNotifier<int> cargaVersao = ValueNotifier(0);

  DateTime? _ultima;
  bool _sincronizando = false;
  bool _rede = true;
  bool _servidorOk = true;
  String? _ultimoErro;
  Future<ResultadoSincronizacao>? _emAndamento;
  StreamSubscription<bool>? _subRede;
  Timer? _timer;
  bool _ativo = false;
  bool _primeiroPlano = true;

  DateTime? get ultimaSincronizacao => _ultima;
  bool get sincronizando => _sincronizando;

  /// Aparelho com rede E o servidor respondeu na última tentativa.
  bool get online => _rede && _servidorOk;
  String? get ultimoErro => _ultimoErro;

  /// Nunca sincronizou neste aparelho (sem dados no espelho).
  bool get semDados => _ultima == null;

  /// Dados com mais de 12 h (estritamente maior). Sem sincronização nenhuma: falso
  /// (use [semDados]).
  bool get dadosAntigos => _ultima != null && _agora().difference(_ultima!) > limiteDadosAntigos;

  /// Lê a última sincronização gravada e liga os gatilhos automáticos. Chame depois do login/restauro da sessão.
  Future<void> iniciar() async {
    if (_ativo) return;
    _ativo = true;
    _ultima = await _meta.ultimaSincronizacao();
    _rede = await _conectividade.temRede();
    _subRede = _conectividade.mudancas.listen((tem) {
      final voltou = tem && !_rede;
      _rede = tem;
      if (!tem) {
        notifyListeners();
      } else if (voltou) {
        _servidorOk = true;
        notifyListeners();
        unawaited(sincronizar());
      }
    });
    _armarTimer();
    notifyListeners();
    unawaited(sincronizar());
  }

  /// Desliga tudo (logout). A próxima [iniciar] recomeça do zero.
  Future<void> parar() async {
    _ativo = false;
    _timer?.cancel();
    _timer = null;
    await _subRede?.cancel();
    _subRede = null;
    _ultima = null;
    _ultimoErro = null;
    _servidorOk = true;
    notifyListeners();
  }

  /// App foi para segundo plano: para o relógio de 15 min.
  void pausar() {
    _primeiroPlano = false;
    _timer?.cancel();
    _timer = null;
  }

  /// App voltou ao primeiro plano: religa o relógio e sincroniza se já passou o intervalo.
  void retomar() {
    _primeiroPlano = true;
    if (!_ativo) return;
    _armarTimer();
    if (_ultima == null || _agora().difference(_ultima!) >= intervalo) unawaited(sincronizar());
  }

  void _armarTimer() {
    _timer?.cancel();
    if (!_ativo || !_primeiroPlano) return;
    _timer = Timer.periodic(intervalo, (_) => unawaited(sincronizar()));
  }

  /// Logo da distribuidora (cliente): GET /v1/config é público (sem token; com token de vendedor a API
  /// recusa) e traz `tema.logo_url`. Melhor esforço: falha não atrapalha a sincronização.
  Future<void> _atualizarLogo() async {
    try {
      final cfg = await _api.get('/config', autenticado: false, timeout: const Duration(seconds: 8));
      if (cfg is! Map<String, dynamic>) return;
      final url = urlDaLogo(cfg, _api.baseUrl);
      await _meta.gravar(MetaRepository.chaveLogo, url);
    } catch (_) {}
  }

  /// Extrai a URL absoluta de `tema.logo_url` da resposta de /config (nulo se não houver logo).
  static String? urlDaLogo(Map<String, dynamic> cfg, String baseUrl) {
    final tema = cfg['tema'];
    final bruto = tema is Map ? tema['logo_url'] : null;
    if (bruto is! String || bruto.trim().isEmpty) return null;
    final u = Uri.tryParse(bruto.trim());
    if (u == null) return null;
    final abs = u.hasScheme ? u : Uri.tryParse(baseUrl)?.resolveUri(u);
    return abs?.toString();
  }

  /// Baixa carga + resumo e troca o espelho. Nunca lança: devolve o resultado.
  Future<ResultadoSincronizacao> sincronizar() {
    return _emAndamento ??= _executar().whenComplete(() => _emAndamento = null);
  }

  Future<ResultadoSincronizacao> _executar() async {
    _sincronizando = true;
    _ultimoErro = null;
    notifyListeners();
    try {
      if (!await _api.temSessao) return const ResultadoSincronizacao(SituacaoSync.sessaoExpirada);

      if (enviarFila != null) {
        try {
          await enviarFila!();
        } on ApiException catch (e) {
          if (e.sessaoExpirada) rethrow;
          // rede/recusa: a fila fica para a próxima vez
        } catch (_) {}
      }

      final json = await _api.get('/vendas/sync',
          headers: _api.cabecalhoVersao, timeout: const Duration(seconds: 90)) as Map<String, dynamic>;
      final carga = CargaVendedor.fromJson(json);

      ResumoVendedor? resumo;
      try {
        resumo = ResumoVendedor.fromJson(await _api.get('/vendas/resumo') as Map<String, dynamic>);
      } on ApiException catch (e) {
        if (e.sessaoExpirada) rethrow;
        // sem resumo novo: o Início mostra o último guardado
      }

      // Logout durante o download: descarta (não recria o espelho de quem saiu).
      if (!await _api.temSessao) return const ResultadoSincronizacao(SituacaoSync.sessaoExpirada);

      final agora = _agora();
      await _carga.substituir(carga, agora: agora, resumo: resumo);
      await _atualizarLogo();
      _ultima = agora;
      _servidorOk = true;
      _rede = true;
      if (!_disposto) cargaVersao.value++;
      return const ResultadoSincronizacao(SituacaoSync.ok);
    } on SemConexao catch (e) {
      _servidorOk = false;
      _ultimoErro = e.message;
      return ResultadoSincronizacao(SituacaoSync.semConexao, e.message);
    } on ApiException catch (e) {
      if (e.sessaoExpirada) return ResultadoSincronizacao(SituacaoSync.sessaoExpirada, e.message);
      _ultimoErro = e.message;
      return ResultadoSincronizacao(SituacaoSync.erro, e.message);
    } catch (e) {
      _ultimoErro = 'Não foi possível sincronizar. Tente de novo.';
      debugPrint('sincronizar: $e');
      return ResultadoSincronizacao(SituacaoSync.erro, _ultimoErro);
    } finally {
      _sincronizando = false;
      notifyListeners();
    }
  }

  bool _disposto = false;

  @override
  void notifyListeners() {
    if (!_disposto) super.notifyListeners();
  }

  @override
  void dispose() {
    _disposto = true;
    _timer?.cancel();
    _subRede?.cancel();
    cargaVersao.dispose();
    super.dispose();
  }
}
