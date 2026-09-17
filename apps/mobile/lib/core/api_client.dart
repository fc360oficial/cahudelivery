import 'dart:convert';
import 'dart:math';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

import 'config.dart';

class ApiException implements Exception {
  ApiException(this.statusCode, this.message, {this.codigo});
  final int statusCode;
  final String message;
  final String? codigo;
  @override
  String toString() => message;
}

/// Cliente HTTP central: injeta X-Tenant e Bearer, renova o access token
/// automaticamente com o refresh token e padroniza erros (RFC 7807 do backend).
/// ChangeNotifier: telas que checam `logado` (Pedidos, Perfil) escutam via
/// ListenableBuilder — sem isso, logar dentro do checkout (empilhado por
/// cima) não avisava essas abas, que já tinham sido desenhadas como visitante.
class ApiClient extends ChangeNotifier {
  ApiClient._();
  static final ApiClient instance = ApiClient._();

  String? _accessToken;
  String? _refreshToken;
  String? _deviceId;
  bool _senhaProvisoria = false;
  bool get senhaProvisoria => _senhaProvisoria;

  Future<void> carregarSessao() async {
    final prefs = await SharedPreferences.getInstance();
    _accessToken = prefs.getString('accessToken');
    _refreshToken = prefs.getString('refreshToken');
    _deviceId = prefs.getString('deviceId');
    _senhaProvisoria = prefs.getBool('senhaProvisoria') ?? false;
    if (_deviceId == null) {
      _deviceId = _uuidV4();
      await prefs.setString('deviceId', _deviceId!);
    }
  }

  bool get logado => _accessToken != null;

  Future<void> marcarSenhaProvisoria(bool valor) async {
    _senhaProvisoria = valor;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool('senhaProvisoria', valor);
    notifyListeners();
  }

  Future<void> salvarTokens(String access, String refresh) async {
    _accessToken = access;
    _refreshToken = refresh;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('accessToken', access);
    await prefs.setString('refreshToken', refresh);
    notifyListeners();
  }

  Future<void> sair() async {
    _accessToken = null;
    _refreshToken = null;
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove('accessToken');
    await prefs.remove('refreshToken');
    _senhaProvisoria = false;
    await prefs.remove('senhaProvisoria');
    notifyListeners();
  }

  /// UUID v4 sem dependência externa.
  static String _uuidV4() {
    final r = Random.secure();
    String hex(int n) => List.generate(n, (_) => r.nextInt(16).toRadixString(16)).join();
    return '${hex(8)}-${hex(4)}-4${hex(3)}-${'89ab'[r.nextInt(4)]}${hex(3)}-${hex(12)}';
  }

  Future<dynamic> get(String path) => _send('GET', path);
  Future<dynamic> post(String path, [Object? body]) => _send('POST', path, body);
  Future<dynamic> put(String path, [Object? body]) => _send('PUT', path, body);
  Future<dynamic> delete(String path) => _send('DELETE', path);

  Future<dynamic> _send(String method, String path, [Object? body, bool retry = true]) async {
    final uri = Uri.parse('${AppBuildConfig.apiUrl}$path');
    final headers = <String, String>{
      'X-Tenant': AppBuildConfig.tenant,
      'Content-Type': 'application/json',
      if (_accessToken != null) 'Authorization': 'Bearer $_accessToken',
      'X-Device-Id': ?_deviceId,
    };
    final req = http.Request(method, uri)..headers.addAll(headers);
    if (body != null) req.body = jsonEncode(body);
    final res = await http.Response.fromStream(await req.send());

    if (res.statusCode == 401 && retry && _refreshToken != null) {
      await _renovar();
      return _send(method, path, body, false);
    }
    final decoded = res.body.isEmpty ? null : jsonDecode(utf8.decode(res.bodyBytes));
    if (res.statusCode >= 400) {
      final msg = decoded is Map
          ? (decoded['message'] is List ? (decoded['message'] as List).join('\n') : '${decoded['message']}')
          : 'Erro ${res.statusCode}';
      throw ApiException(res.statusCode, msg, codigo: decoded is Map ? decoded['codigo'] as String? : null);
    }
    return decoded;
  }

  /// Renovação em andamento — várias chamadas que tomam 401 ao mesmo tempo
  /// (carrinho + favoritos + home na abertura) compartilham UMA renovação.
  /// Sem isso, a 1ª renovava e invalidava o refresh token, as outras falhavam
  /// e o app apagava a sessão: o cliente caía no login depois de 15 min fora.
  Future<void>? _renovando;

  Future<void> _renovar() {
    return _renovando ??= _renovarDeVerdade().whenComplete(() => _renovando = null);
  }

  Future<void> _renovarDeVerdade() async {
    final token = _refreshToken;
    if (token == null) throw ApiException(401, 'Sessão expirada — entre novamente');
    late final http.Response res;
    try {
      res = await http
          .post(
            Uri.parse('${AppBuildConfig.apiUrl}/auth/refresh'),
            headers: {
              'X-Tenant': AppBuildConfig.tenant,
              'Content-Type': 'application/json',
              // Deixa a API mesclar um carrinho anônimo que tenha ficado no aparelho.
              'X-Device-Id': ?_deviceId,
            },
            body: jsonEncode({'refreshToken': token}),
          )
          .timeout(const Duration(seconds: 15));
    } catch (_) {
      // Sem rede / servidor fora: NÃO derruba a sessão — tenta de novo na próxima chamada.
      throw ApiException(0, 'Sem conexão — tente novamente');
    }
    if (res.statusCode == 401 || res.statusCode == 403) {
      // Refresh token realmente inválido/expirado (30+ dias sem abrir, ou revogado).
      await sair();
      throw ApiException(401, 'Sessão expirada — entre novamente');
    }
    if (res.statusCode != 200) {
      throw ApiException(res.statusCode, 'Falha ao renovar a sessão (${res.statusCode})');
    }
    final data = jsonDecode(res.body);
    await salvarTokens(data['accessToken'], data['refreshToken']);
  }
}
