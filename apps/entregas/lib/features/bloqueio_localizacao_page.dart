import 'package:flutter/material.dart';

import '../app_servicos.dart';
import '../core/tema.dart';
import '../services/localizacao_service.dart';
import '../widgets/comuns.dart';
import '../widgets/marca.dart';

/// Tela que segura o motorista até a localização estar liberada ("o tempo todo" e GPS ligado).
/// O texto fala da função (registrar chegada e entrega), como o Tiago pediu.
class BloqueioLocalizacaoPage extends StatelessWidget {
  const BloqueioLocalizacaoPage({super.key});

  @override
  Widget build(BuildContext context) {
    final s = Servicos.of(context);
    final loc = s.localizacao;
    return ListenableBuilder(
      listenable: loc,
      builder: (context, _) {
        final estado = loc.estado;
        final gpsOk = estado != EstadoLocalizacao.gpsDesligado && estado != EstadoLocalizacao.verificando;
        final sempreOk = estado == EstadoLocalizacao.ok;
        final (titulo, texto, botao) = switch (estado) {
          EstadoLocalizacao.verificando => ('Conferindo a localização…', '', null),
          EstadoLocalizacao.gpsDesligado => (
              'Ligue a localização do celular',
              'O GPS está desligado. Ele é usado para registrar a chegada e a entrega em cada cliente.',
              'Ligar a localização',
            ),
          EstadoLocalizacao.semPermissao => (
              'Permita a localização',
              'O app usa a localização para registrar a chegada e a entrega em cada cliente, mesmo com a tela apagada.',
              'Permitir localização',
            ),
          EstadoLocalizacao.soDuranteUso => (
              'Falta um passo',
              'Na tela que vai abrir, toque em "Permissões" › "Local" e marque "Permitir o tempo todo". Depois volte para o app.',
              'Abrir as configurações',
            ),
          EstadoLocalizacao.negadaParaSempre => (
              'A localização foi negada',
              'Na tela que vai abrir, toque em "Permissões" › "Local" e marque "Permitir o tempo todo". Depois volte para o app.',
              'Abrir as configurações',
            ),
          EstadoLocalizacao.ok => ('Tudo certo', '', null),
        };
        return Scaffold(
          body: SafeArea(
            child: ListView(
              padding: const EdgeInsets.fromLTRB(20, 24, 20, 24),
              children: [
                const Center(child: MarcaFluxoEntregas(altura: 52)),
                const SizedBox(height: 28),
                Center(child: IconeCaixa(Icons.location_on_rounded, tamanho: 88, redondo: true)),
                const SizedBox(height: 18),
                Text(titulo, textAlign: TextAlign.center, style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800, color: Cores.marinho)),
                if (texto.isNotEmpty) ...[
                  const SizedBox(height: 8),
                  Text(texto, textAlign: TextAlign.center, style: const TextStyle(fontSize: 16, color: Cores.textoSuave, height: 1.35)),
                ],
                const SizedBox(height: 22),
                Cartao(
                  child: Column(
                    children: [
                      _Passo(ok: gpsOk, titulo: 'Localização do celular ligada'),
                      const Divider(height: 1),
                      _Passo(ok: sempreOk, titulo: 'Permitir o tempo todo'),
                      const Divider(height: 1),
                      _Passo(ok: loc.bateriaLiberada, titulo: 'Sem economia de bateria para o app', opcional: true),
                    ],
                  ),
                ),
                const SizedBox(height: 22),
                if (botao != null) FilledButton(onPressed: loc.resolver, child: Text(botao)),
                if (!loc.bateriaLiberada) ...[
                  const SizedBox(height: 10),
                  OutlinedButton(onPressed: loc.liberarBateria, child: const Text('Liberar a bateria')),
                ],
                const SizedBox(height: 10),
                TextButton(onPressed: loc.verificar, child: const Text('Já liberei, conferir de novo')),
                const SizedBox(height: 18),
                Center(
                  child: TextButton(
                    onPressed: s.sessao.sair,
                    child: Text('Sair (${s.sessao.primeiroNome})', style: const TextStyle(color: Cores.textoSuave)),
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }
}

class _Passo extends StatelessWidget {
  const _Passo({required this.ok, required this.titulo, this.opcional = false});
  final bool ok, opcional;
  final String titulo;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      child: Row(
        children: [
          Icon(ok ? Icons.check_circle_rounded : Icons.radio_button_unchecked_rounded, color: ok ? Cores.ok : Cores.textoSuave, size: 26),
          const SizedBox(width: 12),
          Expanded(child: Text(titulo, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600, color: Cores.texto))),
          if (opcional && !ok) const Etiqueta('Recomendado', cor: Cores.ambar),
        ],
      ),
    );
  }
}
