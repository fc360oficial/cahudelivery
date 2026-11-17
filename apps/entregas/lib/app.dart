import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';

import 'app_servicos.dart';
import 'core/tema.dart';
import 'features/bloqueio_localizacao_page.dart';
import 'features/home_shell.dart';
import 'features/login_page.dart';
import 'services/sessao_service.dart';
import 'widgets/marca.dart';

/// Raiz do app: escolhe a tela pela sessão e pela localização (sem localização liberada o motorista não passa
/// da tela de bloqueio) e confere tudo de novo quando o app volta para a frente.
class FluxoEntregasApp extends StatefulWidget {
  const FluxoEntregasApp({super.key, required this.servicos});
  final AppServicos servicos;

  @override
  State<FluxoEntregasApp> createState() => _FluxoEntregasAppState();
}

class _FluxoEntregasAppState extends State<FluxoEntregasApp> with WidgetsBindingObserver {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    widget.servicos.sessao.restaurar();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed && widget.servicos.sessao.estado == EstadoSessao.logado) {
      widget.servicos.localizacao.verificar();
      widget.servicos.carga.sincronizar();
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = widget.servicos;
    return Servicos(
      servicos: s,
      child: MaterialApp(
        title: 'Fluxo Entregas',
        debugShowCheckedModeBanner: false,
        theme: construirTema(),
        locale: const Locale('pt', 'BR'),
        supportedLocales: const [Locale('pt', 'BR')],
        localizationsDelegates: const [GlobalMaterialLocalizations.delegate, GlobalWidgetsLocalizations.delegate, GlobalCupertinoLocalizations.delegate],
        home: ListenableBuilder(
          listenable: Listenable.merge([s.sessao, s.localizacao]),
          builder: (context, _) => switch (s.sessao.estado) {
            EstadoSessao.iniciando => const _Abertura(),
            EstadoSessao.deslogado => const LoginPage(),
            EstadoSessao.logado => s.localizacao.liberado ? const HomeShell() : const BloqueioLocalizacaoPage(),
          },
        ),
      ),
    );
  }
}

class _Abertura extends StatelessWidget {
  const _Abertura();

  @override
  Widget build(BuildContext context) => const Scaffold(
        backgroundColor: Cores.marinho,
        body: Center(child: MarcaFluxoEntregas(altura: 56, corFluxo: Colors.white, corEntregas: Cores.amarelo)),
      );
}
