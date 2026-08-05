import 'package:flutter/foundation.dart' show kIsWeb;

/// Configuração de build do white label.
/// Cada cliente (flavor) compila com seus próprios valores via --dart-define:
///   flutter run --dart-define=TENANT=cahu --dart-define=API_URL=http://10.0.2.2:3000/v1
/// Os valores visuais (cores, logo) vêm em runtime de GET /v1/config.
class AppBuildConfig {
  static const tenant = String.fromEnvironment('TENANT', defaultValue: 'cahu');

  static const _apiUrlDefine = String.fromEnvironment('API_URL');

  /// Sem API_URL explícita: no web usa o mesmo host que serviu o app
  /// (funciona no notebook e no celular mesmo quando o IP da rede muda);
  /// no Android usa 10.0.2.2 (localhost visto de dentro do emulador).
  static String get apiUrl {
    if (_apiUrlDefine.isNotEmpty) return _apiUrlDefine;
    if (kIsWeb) return 'http://${Uri.base.host}:3000/v1';
    return 'http://10.0.2.2:3000/v1';
  }

  /// Nome exibido antes do tema remoto carregar (fallback embutido do flavor).
  static const appNome = String.fromEnvironment('APP_NOME', defaultValue: 'Cahu');

  /// Logo embutido do flavor (fallback quando o tema remoto não tem logo_url).
  static const logoAsset =
      String.fromEnvironment('LOGO_ASSET', defaultValue: 'assets/logo/cahu.png');
}
