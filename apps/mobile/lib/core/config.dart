/// Configuração de build do white label.
/// Cada cliente (flavor) compila com seus próprios valores via --dart-define:
///   flutter run --dart-define=TENANT=cahu --dart-define=API_URL=http://10.0.2.2:3000/v1
/// Os valores visuais (cores, logo) vêm em runtime de GET /v1/config.
class AppBuildConfig {
  static const tenant = String.fromEnvironment('TENANT', defaultValue: 'cahu');
  static const apiUrl = String.fromEnvironment(
    'API_URL',
    // 10.0.2.2 = localhost visto de dentro do emulador Android
    defaultValue: 'http://10.0.2.2:3000/v1',
  );

  /// Nome exibido antes do tema remoto carregar (fallback embutido do flavor).
  static const appNome = String.fromEnvironment('APP_NOME', defaultValue: 'CAHU Delivery');
}
