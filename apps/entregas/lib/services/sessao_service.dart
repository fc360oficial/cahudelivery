import 'package:flutter/foundation.dart';

import '../core/api_client.dart';
import '../core/api_exception.dart';
import '../core/token_store.dart';
import '../data/banco_local.dart';

enum EstadoSessao { iniciando, deslogado, logado }

/// Sessão do motorista: login, restauro ao abrir o app (30 dias, funciona sem sinal), sair e
/// encerramento forçado (motorista bloqueado na retaguarda).
class SessaoService extends ChangeNotifier {
  SessaoService({required ApiClient api, required BancoLocal banco, this.aoLogar, this.aoDeslogar})
      : _api = api,
        _banco = banco {
    _api.onSessaoExpirada = _expirou;
  }

  final ApiClient _api;
  final BancoLocal _banco;
  VoidCallback? aoLogar;
  Future<void> Function()? aoDeslogar;

  EstadoSessao _estado = EstadoSessao.iniciando;
  String? _nome;
  String? _distribuidora;
  String? _mensagem;

  EstadoSessao get estado => _estado;
  String? get nome => _nome;
  String? get distribuidora => _distribuidora;

  /// "Edson" de "Edson da Silva".
  String get primeiroNome => (_nome ?? '').trim().split(RegExp(r'\s+')).first;

  /// Mensagem para a tela de login depois de um encerramento forçado (uma vez só).
  String? get mensagem => _mensagem;
  void limparMensagem() => _mensagem = null;

  Future<void> restaurar() async {
    final temTokens = await _api.temSessao;
    final id = await _banco.ler('motorista_id');
    if (temTokens && id != null) {
      _nome = await _banco.ler('motorista_nome');
      _distribuidora = await _banco.ler('distribuidora');
      _estado = EstadoSessao.logado;
      notifyListeners();
      aoLogar?.call();
    } else {
      if (temTokens) await _api.limparTokens();
      _estado = EstadoSessao.deslogado;
      notifyListeners();
    }
  }

  Future<void> entrar(String login, String senha) async {
    final r = await _api.post('/motorista/login', autenticado: false, body: {'login': login.trim(), 'senha': senha}) as Map<String, dynamic>;
    await _api.salvarTokens(Tokens(r['accessToken'] as String, r['refreshToken'] as String));
    final m = r['motorista'] as Map<String, dynamic>;
    // Outro motorista no mesmo aparelho: a carga e a fila do anterior não podem sobrar.
    final anterior = await _banco.ler('motorista_id');
    if (anterior != null && anterior != m['id']) await _banco.limparTudo();
    await _banco.gravar('motorista_id', m['id'] as String);
    await _banco.gravar('motorista_nome', '${m['nome']}');
    await _banco.gravar('distribuidora', r['distribuidora'] as String?);
    _nome = '${m['nome']}';
    _distribuidora = r['distribuidora'] as String?;
    _mensagem = null;
    _estado = EstadoSessao.logado;
    notifyListeners();
    aoLogar?.call();
  }

  /// Sair: apaga os tokens. A fila fica no aparelho e sobe quando o mesmo motorista entrar de novo.
  Future<void> sair() async {
    await _api.limparTokens();
    await _encerrar(null);
  }

  void _expirou() => _encerrar(mensagemAcessoBloqueado);

  Future<void> _encerrar(String? mensagem) async {
    if (_estado == EstadoSessao.deslogado) return;
    _estado = EstadoSessao.deslogado;
    _mensagem = mensagem;
    _nome = null;
    _distribuidora = null;
    notifyListeners();
    await aoDeslogar?.call();
  }
}
