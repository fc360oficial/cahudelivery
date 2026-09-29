import 'package:flutter/foundation.dart' show kIsWeb;

/// Configuração de build do white label.
/// Cada cliente (flavor) compila com seus próprios valores via --dart-define:
///   flutter run --dart-define=TENANT=cahu --dart-define=API_URL=http://10.0.2.2:3000/v1
/// Os valores visuais (cores, logo) vêm em runtime de GET /v1/config.
class AppBuildConfig {
  static const tenant = String.fromEnvironment('TENANT', defaultValue: 'cahu');

  static const _apiUrlDefine = String.fromEnvironment('API_URL');

  /// Sem API_URL explícita: no web usa a mesma origem que serviu o app
  /// (em produção https://cahudelivery.duckdns.org/app/ → .../v1, via Caddy;
  /// em dev local, servido de localhost:3000, também cai na API). Porta 3000
  /// fixa quebrava em produção: https→http:3000 é bloqueado pelo navegador
  /// (achado 29/09/26). No Android usa 10.0.2.2 (localhost do emulador).
  static String get apiUrl {
    if (_apiUrlDefine.isNotEmpty) return _apiUrlDefine;
    if (kIsWeb) return '${Uri.base.origin}/v1';
    return 'http://10.0.2.2:3000/v1';
  }

  /// Nome exibido antes do tema remoto carregar (fallback embutido do flavor).
  static const appNome = String.fromEnvironment('APP_NOME', defaultValue: 'Cahu');

  /// Logo embutido do flavor (fallback quando o tema remoto não tem logo_url).
  static const logoAsset =
      String.fromEnvironment('LOGO_ASSET', defaultValue: 'assets/logo/cahu.png');
}
