import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import 'api_exception.dart';
import 'config.dart';
import 'token_store.dart';

/// Foto a enviar num formulário: campo, nome e bytes.
class ArquivoEnvio {
  const ArquivoEnvio(this.campo, this.nome, this.bytes);
  final String campo;
  final String nome;
  final List<int> bytes;
}

/// Cliente HTTP da API do motorista (mesmo comportamento do app do Fluxo Vendas):
///
/// - injeta `X-Tenant`, `X-App-Versao` e `Authorization: Bearer`;
/// - em 401 renova o token UMA vez (chamadas simultâneas compartilham a renovação) e repete;
/// - refresh recusado (401/403) ou repetição ainda 401 => sessão encerrada: apaga os tokens e
///   chama [onSessaoExpirada];
/// - falha de rede ou tempo esgotado => [SemConexao] (a sessão NÃO é tocada);
/// - erros HTTP viram [ApiException] com o `codigo` de negócio da API.
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

  Future<dynamic> get(String path) => _enviar('GET', path);

  Future<dynamic> post(String path, {Object? body, bool autenticado = true}) =>
      _enviar('POST', path, body: body, autenticado: autenticado);

  /// Formulário com fotos (multipart). Fotos maiores pedem mais tempo.
  Future<dynamic> multipart(String path, Map<String, String> campos, List<ArquivoEnvio> arquivos) =>
      _enviar('POST', path, campos: campos, arquivos: arquivos, timeout: const Duration(seconds: 90));

  Future<dynamic> _enviar(
    String method,
    String path, {
    Object? body,
    Map<String, String>? campos,
    List<ArquivoEnvio>? arquivos,
    bool autenticado = true,
    bool repetir = true,
    Duration? timeout,
  }) async {
    final t = autenticado ? await _tokensAtuais() : null;
    final res = await _chamar(method, path, body: body, campos: campos, arquivos: arquivos, access: t?.access, timeout: timeout);

    if (res.statusCode == 401 && autenticado && t != null) {
      if (!repetir) {
        await _encerrarSessao();
        throw ApiException(401, mensagemAcessoBloqueado, codigo: 'SESSAO_EXPIRADA');
      }
      await _renovar(t.refresh);
      return _enviar(method, path, body: body, campos: campos, arquivos: arquivos, autenticado: autenticado, repetir: false, timeout: timeout);
    }
    return _decodificar(res);
  }

  Future<http.Response> _chamar(
    String method,
    String path, {
    Object? body,
    Map<String, String>? campos,
    List<ArquivoEnvio>? arquivos,
    String? access,
    Duration? timeout,
  }) async {
    final uri = Uri.parse('$baseUrl$path');
    final cabecalhos = <String, String>{
      'X-Tenant': tenant,
      'X-App-Versao': appVersao,
      'Accept': 'application/json',
      'Authorization': ?(access == null ? null : 'Bearer $access'),
    };
    final http.BaseRequest req;
    if (campos != null || arquivos != null) {
      final m = http.MultipartRequest(method, uri)..headers.addAll(cabecalhos);
      m.fields.addAll(campos ?? const {});
      for (final a in arquivos ?? const <ArquivoEnvio>[]) {
        m.files.add(http.MultipartFile.fromBytes(a.campo, a.bytes, filename: a.nome));
      }
      req = m;
    } else {
      final r = http.Request(method, uri)..headers.addAll({...cabecalhos, 'Content-Type': 'application/json'});
      if (body != null) r.body = jsonEncode(body);
      req = r;
    }
    final limite = timeout ?? this.timeout;
    try {
      final streamed = await _http.send(req).timeout(limite);
      return await http.Response.fromStream(streamed).timeout(limite);
    } on TimeoutException {
      throw SemConexao('Sem resposta do servidor. Confira sua internet.');
    } on http.ClientException {
      throw SemConexao();
    } on Exception catch (e) {
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
    if (atual != null && atual.refresh != refreshUsado) return;
    final res = await _chamar('POST', '/motorista/refresh', body: {'refreshToken': refreshUsado});
    if (res.statusCode == 401 || res.statusCode == 403) {
      await _encerrarSessao();
      throw ApiException(401, mensagemAcessoBloqueado, codigo: 'SESSAO_EXPIRADA');
    }
    final dados = _decodificar(res);
    await salvarTokens(Tokens(dados['accessToken'] as String, dados['refreshToken'] as String));
  }

  Future<void> _encerrarSessao() async {
    if (_tokens == null && _carregado) return;
    await limparTokens();
    onSessaoExpirada?.call();
  }

  void close() => _http.close();
}
