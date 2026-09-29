import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_native_splash/flutter_native_splash.dart';

import 'core/api_client.dart';
import 'core/tenant_theme.dart';
import 'features/auth/nova_senha_screen.dart';
import 'features/shell/home_shell.dart';
import 'features/splash/video_splash_screen.dart';

/// Amarelo CIMED oficial — único amarelo que deve aparecer no app (não usar
/// as variações que o Material gera automaticamente a partir dele).
const corCimed = Color(0xFFFFD500);

Future<void> main() async {
  final binding = WidgetsFlutterBinding.ensureInitialized();
  // Segura a splash nativa (amarela com o logo) na tela até o app estar
  // pronto — splash única, sem o pulo de tamanho de uma segunda splash.
  FlutterNativeSplash.preserve(widgetsBinding: binding);
  // Barra de status/navegação sempre no amarelo exato — sem isso o Android
  // desenha um véu translúcido próprio por cima e o tom fica diferente do
  // resto do app (achado 21/09/26).
  SystemChrome.setSystemUIOverlayStyle(SystemUiOverlayStyle(
    statusBarColor: corCimed,
    statusBarIconBrightness: Brightness.dark,
    statusBarBrightness: Brightness.light,
    systemNavigationBarColor: corCimed,
    systemNavigationBarIconBrightness: Brightness.dark,
  ));
  await ApiClient.instance.carregarSessao();
  // Tema remoto do tenant; sem rede segue com o fallback embutido do flavor.
  await TenantTheme.instance
      .carregar()
      .timeout(const Duration(seconds: 6), onTimeout: () {});
  // Sessão salva com senha ainda provisória (app fechado antes de trocar):
  // força a troca antes de liberar o app, mesmo sem passar pelo login agora.
  final precisaTrocarSenha =
      ApiClient.instance.logado && ApiClient.instance.senhaProvisoria;
  final telaInicial = precisaTrocarSenha
      ? Builder(
          builder: (context) => NovaSenhaScreen(
            aoConcluir: () => Navigator.of(context).pushReplacement(
              MaterialPageRoute(builder: (_) => const HomeShell()),
            ),
          ),
        )
      : const HomeShell();
  runApp(FluxoCommerceApp(
    // Vídeo de abertura toda vez que o app é aberto (decisão do Tiago,
    // 21/09/26) — pode virar "só uma vez" mais pra frente se incomodar.
    inicio: VideoSplashScreen(next: telaInicial),
  ));
  FlutterNativeSplash.remove();
}

/// Casca white label: o mesmo código vira "CAHU Delivery" (ou qualquer outra
/// distribuidora) pelo flavor de build + tema remoto carregado no boot.
class FluxoCommerceApp extends StatelessWidget {
  const FluxoCommerceApp({super.key, required this.inicio});
  final Widget inicio;

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: TenantTheme.instance,
      builder: (context, _) => MaterialApp(
        title: TenantTheme.instance.appNome,
        debugShowCheckedModeBanner: false,
        theme: TenantTheme.instance.buildTheme(),
        home: inicio,
      ),
    );
  }
}
