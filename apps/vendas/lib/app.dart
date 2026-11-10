import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';

import 'app_servicos.dart';
import 'core/tema.dart';
import 'features/login/login_page.dart';
import 'features/shell/home_shell.dart';
import 'services/sessao_service.dart';
import 'widgets/marca.dart';

/// Raiz do app: injeta os serviços, escolhe a tela pela sessão e liga o ciclo
/// de vida (segundo plano pausa o relógio de 15 min da sincronização).
class FluxoVendasApp extends StatefulWidget {
  const FluxoVendasApp({super.key, required this.servicos});
  final AppServicos servicos;

  @override
  State<FluxoVendasApp> createState() => _FluxoVendasAppState();
}

class _FluxoVendasAppState extends State<FluxoVendasApp> with WidgetsBindingObserver {
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
    final sync = widget.servicos.sincronizacao;
    if (state == AppLifecycleState.resumed) {
      sync.retomar();
    } else if (state == AppLifecycleState.paused) {
      sync.pausar();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Servicos(
      servicos: widget.servicos,
      child: MaterialApp(
        title: 'Fluxo Vendas',
        debugShowCheckedModeBanner: false,
        theme: construirTema(),
        locale: const Locale('pt', 'BR'),
        supportedLocales: const [Locale('pt', 'BR')],
        localizationsDelegates: const [
          GlobalMaterialLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
          GlobalCupertinoLocalizations.delegate,
        ],
        home: ListenableBuilder(
          listenable: widget.servicos.sessao,
          builder: (context, _) => switch (widget.servicos.sessao.estado) {
            EstadoSessao.iniciando => const _Abertura(),
            EstadoSessao.deslogado => const LoginPage(),
            EstadoSessao.logado => const HomeShell(),
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
        body: Center(child: MarcaFluxoVendas(altura: 56)),
      );
}
