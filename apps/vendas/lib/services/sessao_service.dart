import 'package:flutter/foundation.dart';

import '../core/api_client.dart';
import '../core/api_exception.dart';
import '../core/token_store.dart';
import '../data/carga_repository.dart';
import '../data/meta_repository.dart';
import '../data/modelos.dart';

enum EstadoSessao { iniciando, deslogado, logado }

/// Sessão do vendedor: login, restauro ao abrir o app (30 dias por refresh token,
/// funciona offline), logout e encerramento forçado (vendedor bloqueado/removido).
class SessaoService extends ChangeNotifier {
  SessaoService({
    required ApiClient api,
    required CargaRepository carga,
    required MetaRepository meta,
    this.aoLogar,
    this.aoDeslogar,
  })  : _api = api,
        _carga = carga,
        _meta = meta {
    _api.onSessaoExpirada = _expirou;
  }

  final ApiClient _api;
  final CargaRepository _carga;
  final MetaRepository _meta;

  /// Disparados quando a sessão passa a existir / deixa de existir (ligam e desligam a sincronização).
  VoidCallback? aoLogar;
  Future<void> Function()? aoDeslogar;

  EstadoSessao _estado = EstadoSessao.iniciando;
  VendedorInfo? _vendedor;
  String? _distribuidora;
  String? _mensagem;

  EstadoSessao get estado => _estado;
  bool get logado => _estado == EstadoSessao.logado;
  VendedorInfo? get vendedor => _vendedor;
  String? get distribuidora => _distribuidora;

  /// Mensagem para a tela de login depois de um encerramento forçado (uma vez só).
  String? get mensagem => _mensagem;
  void limparMensagem() {
    _mensagem = null;
  }

  /// Ao abrir o app: há tokens E dados do vendedor guardados => logado, sem rede.
  Future<void> restaurar() async {
    final temTokens = await _api.temSessao;
    final v = await _meta.vendedor();
    if (temTokens && v != null) {
      _vendedor = v;
      _distribuidora = await _meta.distribuidora();
      _estado = EstadoSessao.logado;
      notifyListeners();
      aoLogar?.call();
    } else {
      if (temTokens) await _api.limparTokens();
      _estado = EstadoSessao.deslogado;
      notifyListeners();
    }
  }

  /// Entra com login/senha. Lança [ApiException] (401 = credenciais, 429 = limite
  /// de tentativas, etc.) ou [SemConexao]; use `mensagemDeErro` para mostrar.
  Future<void> entrar(String login, String senha) async {
    final r = await _api.post('/vendas/login', autenticado: false, body: {'login': login.trim(), 'senha': senha})
        as Map<String, dynamic>;
    await _api.salvarTokens(Tokens(r['accessToken'] as String, r['refreshToken'] as String));
    final v = r['vendedor'] as Map<String, dynamic>;
    // Troca de vendedor no mesmo aparelho: o espelho do anterior não pode sobrar.
    final anterior = await _meta.vendedor();
    if (anterior != null && anterior.id != v['id']) await _carga.limparEspelho();
    await _meta.gravar('vendedor_id', v['id'] as String);
    await _meta.gravar('vendedor_nome', '${v['nome']}');
    final dist = r['distribuidora'] as String?;
    await _meta.gravar('distribuidora', dist);
    _vendedor = VendedorInfo(id: v['id'] as String, nome: '${v['nome']}');
    _distribuidora = dist;
    _mensagem = null;
    _estado = EstadoSessao.logado;
    notifyListeners();
    aoLogar?.call();
  }

  /// Sair: apaga tokens e espelho local (pedidos/orçamentos locais ficam, ligados ao vendedor).
  Future<void> sair() async {
    await _api.limparTokens();
    await _encerrar(null);
  }

  /// O servidor recusou a sessão (refresh 401/403 ou vendedor desativado).
  void _expirou() {
    _encerrando = _encerrar(mensagemAcessoBloqueado);
  }

  Future<void>? _encerrando;

  /// Completa quando um encerramento forçado em andamento terminou de limpar o espelho (útil em testes).
  Future<void> aguardarEncerramento() => _encerrando ?? Future.value();

  Future<void> _encerrar(String? mensagem) async {
    if (_estado == EstadoSessao.deslogado) return;
    _estado = EstadoSessao.deslogado;
    _mensagem = mensagem;
    _vendedor = null;
    _distribuidora = null;
    notifyListeners();
    await aoDeslogar?.call();
    await _carga.limparEspelho();
  }
}
