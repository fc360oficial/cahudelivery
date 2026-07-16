import 'dart:convert';
import 'dart:math';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

import 'config.dart';

class ApiException implements Exception {
  ApiException(this.statusCode, this.message);
  final int statusCode;
  final String message;
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

  Future<void> carregarSessao() async {
    final prefs = await SharedPreferences.getInstance();
    _accessToken = prefs.getString('accessToken');
    _refreshToken = prefs.getString('refreshToken');
    _deviceId = prefs.getString('deviceId');
    if (_deviceId == null) {
      _deviceId = _uuidV4();
      await prefs.setString('deviceId', _deviceId!);
    }
  }

  bool get logado => _accessToken != null;

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
      throw ApiException(res.statusCode, msg);
    }
    return decoded;
  }

  Future<void> _renovar() async {
    final res = await http.post(
      Uri.parse('${AppBuildConfig.apiUrl}/auth/refresh'),
      headers: {'X-Tenant': AppBuildConfig.tenant, 'Content-Type': 'application/json'},
      body: jsonEncode({'refreshToken': _refreshToken}),
    );
    if (res.statusCode != 200) {
      await sair();
      throw ApiException(401, 'Sessão expirada — entre novamente');
    }
    final data = jsonDecode(res.body);
    await salvarTokens(data['accessToken'], data['refreshToken']);
  }
}
