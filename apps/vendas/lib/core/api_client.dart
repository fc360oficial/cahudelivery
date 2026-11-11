import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import 'api_exception.dart';
import 'config.dart';
import 'token_store.dart';

/// Cliente HTTP da API de Vendas.
///
/// - injeta `X-Tenant` e `Authorization: Bearer`;
/// - em 401 renova o token UMA vez (single-flight: chamadas simultâneas
///   compartilham a mesma renovação) e repete a chamada;
/// - refresh recusado (401/403) ou repetição ainda 401 => sessão encerrada:
///   apaga os tokens e chama [onSessaoExpirada];
/// - falha de rede/tempo esgotado => [SemConexao] (a sessão NÃO é tocada);
/// - erros HTTP viram [ApiException] com o `codigo` de negócio da API.
///
/// Sem singleton: construa e injete (testes passam um `http.Client` falso).
class ApiClient {
  ApiClient({
    required this.tokens,
    http.Client? client,
    String? baseUrl,
    String? tenant,
    String? appVersao,
    this.timeout = const Duration(seconds: 20),
    this.onSessaoExpirada,
  })  : _http = client ?? http.Client(),
        baseUrl = (baseUrl ?? AppConfig.apiUrl).replaceAll(RegExp(r'/+$'), ''),
        tenant = tenant ?? AppConfig.tenant,
        appVersao = appVersao ?? AppConfig.versao;

  final TokenStore tokens;
  final http.Client _http;
  final String baseUrl;
  final String tenant;
  final String appVersao;
  final Duration timeout;

  /// Chamado (uma vez por encerramento) quando o servidor recusa a sessão de vez.
  void Function()? onSessaoExpirada;

  Tokens? _tokens;
  bool _carregado = false;
  Future<void>? _renovando;

  /// Há tokens guardados (sessão presumida válida até o servidor dizer que não).
  Future<bool> get temSessao async => (await _tokensAtuais()) != null;

  Future<Tokens?> _tokensAtuais() async {
    if (!_carregado) {
      _tokens = await tokens.ler();
      _carregado = true;
    }
    return _tokens;
  }

  Future<void> salvarTokens(Tokens t) async {
    _tokens = t;
    _carregado = true;
    await tokens.salvar(t);
  }

  Future<void> limparTokens() async {
    _tokens = null;
    _carregado = true;
    await tokens.limpar();
  }

  Future<dynamic> get(String path, {Duration? timeout, Map<String, String>? headers}) =>
      _enviar('GET', path, timeout: timeout, headers: headers);

  Future<dynamic> post(String path, {Object? body, bool autenticado = true, Duration? timeout}) =>
      _enviar('POST', path, body: body, autenticado: autenticado, timeout: timeout);

  Future<dynamic> put(String path, {Object? body, Duration? timeout}) =>
      _enviar('PUT', path, body: body, timeout: timeout);

  /// Cabeçalho que a API usa para registrar a versão do app (só na sincronização).
  Map<String, String> get cabecalhoVersao => {'X-App-Versao': appVersao};

  Future<dynamic> _enviar(
    String method,
    String path, {
    Object? body,
    bool autenticado = true,
    bool repetir = true,
    Duration? timeout,
    Map<String, String>? headers,
  }) async {
    final t = autenticado ? await _tokensAtuais() : null;
    final res = await _chamar(method, path, body: body, access: t?.access, timeout: timeout, headers: headers);

    if (res.statusCode == 401 && autenticado && t != null) {
      if (!repetir) {
        await _encerrarSessao();
        throw ApiException(401, mensagemAcessoBloqueado, codigo: 'SESSAO_EXPIRADA');
      }
      await _renovar(t.refresh);
      return _enviar(method, path, body: body, autenticado: autenticado, repetir: false, timeout: timeout, headers: headers);
    }
    return _decodificar(res);
  }

  Future<http.Response> _chamar(
    String method,
    String path, {
    Object? body,
    String? access,
    Duration? timeout,
    Map<String, String>? headers,
  }) async {
    final req = http.Request(method, Uri.parse('$baseUrl$path'))
      ..headers.addAll({
        'X-Tenant': tenant,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': ?(access == null ? null : 'Bearer $access'),
        ...?headers,
      });
    if (body != null) req.body = jsonEncode(body);
    try {
      final streamed = await _http.send(req).timeout(timeout ?? this.timeout);
      return await http.Response.fromStream(streamed).timeout(timeout ?? this.timeout);
    } on TimeoutException {
      throw SemConexao('Sem resposta do servidor. Confira sua internet.');
    } on http.ClientException {
      throw SemConexao();
    } on Exception catch (e) {
      // SocketException, HandshakeException, TlsException... (dart:io não é importável na web)
      if (e is ApiException) rethrow;
      throw SemConexao();
    }
  }

  dynamic _decodificar(http.Response res) {
    dynamic corpo;
    if (res.body.isNotEmpty) {
      try {
        corpo = jsonDecode(utf8.decode(res.bodyBytes));
      } on FormatException {
        corpo = null;
      }
    }
    if (res.statusCode >= 400) {
      throw ApiException(res.statusCode, _mensagem(corpo, res.statusCode), codigo: corpo is Map ? corpo['codigo'] as String? : null, corpo: corpo);
    }
    return corpo;
  }

  static String _mensagem(dynamic corpo, int status) {
    if (corpo is Map && corpo['message'] != null) {
      final m = corpo['message'];
      return m is List ? m.join('\n') : '$m';
    }
    if (status >= 500) return 'O servidor está com problemas. Tente de novo em instantes.';
    return 'Erro $status';
  }

  Future<void> _renovar(String refreshUsado) {
    return _renovando ??= _renovarDeVerdade(refreshUsado).whenComplete(() => _renovando = null);
  }

  Future<void> _renovarDeVerdade(String refreshUsado) async {
    final atual = await _tokensAtuais();
    // Outra chamada já renovou enquanto esta esperava: não gasta o refresh de novo.
    if (atual != null && atual.refresh != refreshUsado) return;
    final http.Response res;
    try {
      res = await _chamar('POST', '/vendas/refresh', body: {'refreshToken': refreshUsado});
    } on SemConexao {
      rethrow; // sem rede: mantém a sessão, tenta na próxima chamada
    }
    if (res.statusCode == 401 || res.statusCode == 403) {
      await _encerrarSessao();
      throw ApiException(401, mensagemAcessoBloqueado, codigo: 'SESSAO_EXPIRADA');
    }
    final dados = _decodificar(res);
    await salvarTokens(Tokens(dados['accessToken'] as String, dados['refreshToken'] as String));
  }

  Future<void> _encerrarSessao() async {
    if (_tokens == null && _carregado) return; // já encerrada por outra chamada
    await limparTokens();
    onSessaoExpirada?.call();
  }

  void close() => _http.close();
}
