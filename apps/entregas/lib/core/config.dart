import 'package:flutter/foundation.dart' show kIsWeb;

/// Configuração de build. Valores vêm de `--dart-define`:
///
///   flutter build apk --dart-define=TENANT=cahu --dart-define=API_URL=https://cahudelivery.duckdns.org/v1
///
/// Produção aponta SEMPRE para a URL pública do cliente, nunca para IP local.
class AppConfig {
  AppConfig._();

  static const tenant = String.fromEnvironment('TENANT', defaultValue: 'cahu');
  static const _apiUrlDefine = String.fromEnvironment('API_URL');

  /// Versão enviada no cabeçalho `X-App-Versao` (acompanha o pubspec).
  static const versao = String.fromEnvironment('APP_VERSAO', defaultValue: '1.0.0+1');

  /// Sem `API_URL`: web usa a mesma origem; Android usa o localhost do emulador.
  static String get apiUrl {
    if (_apiUrlDefine.isNotEmpty) return _apiUrlDefine;
    if (kIsWeb) return '${Uri.base.origin}/v1';
    return 'http://10.0.2.2:3000/v1';
  }
}
