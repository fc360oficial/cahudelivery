import 'package:flutter/material.dart';

import '../app_servicos.dart';
import '../core/config.dart';
import '../core/formatadores.dart';
import '../core/tema.dart';
import '../widgets/comuns.dart';

/// Mais: quem está logado, sincronizar, bateria e sair.
class MaisPage extends StatelessWidget {
  const MaisPage({super.key});

  @override
  Widget build(BuildContext context) {
    final s = Servicos.of(context);
    return Column(
      children: [
        const TopoTela(titulo: 'Mais'),
        Expanded(
          child: ListenableBuilder(
            listenable: Listenable.merge([s.carga, s.localizacao]),
            builder: (context, _) => ListView(
              padding: const EdgeInsets.all(16),
              children: [
                Cartao(
                  child: ListTile(
                    contentPadding: const EdgeInsets.all(14),
                    leading: const IconeCaixa(Icons.person_rounded, redondo: true),
                    title: Text(s.sessao.nome ?? '', style: const TextStyle(fontWeight: FontWeight.w800, color: Cores.marinho)),
                    subtitle: Text(s.sessao.distribuidora ?? ''),
                  ),
                ),
                const SizedBox(height: 12),
                Cartao(
                  child: Column(
                    children: [
                      ListTile(
                        leading: const IconeCaixa(Icons.sync_rounded),
                        title: const Text('Sincronizar agora', style: TextStyle(fontWeight: FontWeight.w700)),
                        subtitle: Text(s.carga.atualizadaEm == null
                            ? (s.carga.semSinal ? 'Sem internet' : 'Ainda não sincronizou')
                            : 'Última: ${hora(s.carga.atualizadaEm!)}${s.carga.pendentes > 0 ? ' · ${s.carga.pendentes} a enviar' : ''}'),
                        onTap: s.carga.sincronizar,
                      ),
                      if (!s.localizacao.bateriaLiberada) ...[
                        const Divider(height: 1),
                        ListTile(
                          leading: const IconeCaixa(Icons.battery_alert_rounded, cor: Cores.ambar, fundo: Cores.amareloClaro),
                          title: const Text('Liberar a bateria', style: TextStyle(fontWeight: FontWeight.w700)),
                          subtitle: const Text('Evita que o celular feche o app no meio da rota'),
                          onTap: s.localizacao.liberarBateria,
                        ),
                      ],
                    ],
                  ),
                ),
                const SizedBox(height: 12),
                Cartao(
                  child: ListTile(
                    leading: const IconeCaixa(Icons.logout_rounded, cor: Cores.erro, fundo: Color(0xFFFDECEC)),
                    title: const Text('Sair', style: TextStyle(fontWeight: FontWeight.w700, color: Cores.erro)),
                    subtitle: s.carga.pendentes > 0 ? Text('${s.carga.pendentes} registro(s) ainda não enviados ficam guardados no celular') : null,
                    onTap: s.sessao.sair,
                  ),
                ),
                const SizedBox(height: 18),
                Center(child: Text('Fluxo Entregas ${AppConfig.versao}', style: const TextStyle(color: Cores.textoSuave, fontSize: 12.5))),
              ],
            ),
          ),
        ),
      ],
    );
  }
}
