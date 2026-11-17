import 'dart:async';

import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../app_servicos.dart';
import '../core/formatadores.dart';
import '../core/tema.dart';
import '../data/modelos.dart';
import '../widgets/comuns.dart';
import '../widgets/parada_widgets.dart';
import 'comprovante_page.dart';
import 'home_shell.dart';
import 'nao_entregue_page.dart';
import 'ocorrencia_page.dart';

/// Uma parada: "A caminho" (com "Cheguei no cliente"), "No cliente" (entregar, ocorrência, não entregar)
/// ou o resumo, se já foi registrada.
class ParadaPage extends StatefulWidget {
  const ParadaPage({super.key, required this.chave});
  final String chave;

  @override
  State<ParadaPage> createState() => _ParadaPageState();
}

class _ParadaPageState extends State<ParadaPage> {
  Timer? _relogio;
  bool _ocupado = false;

  @override
  void initState() {
    super.initState();
    // Os minutos "em trajeto" e "no cliente" andam com a tela aberta.
    _relogio = Timer.periodic(const Duration(seconds: 30), (_) => setState(() {}));
  }

  @override
  void dispose() {
    _relogio?.cancel();
    super.dispose();
  }

  Future<void> _cheguei(Parada p) async {
    setState(() => _ocupado = true);
    final s = Servicos.of(context);
    try {
      final gps = await s.localizacao.pontoAtual();
      await s.carga.chegada(p, gps);
    } finally {
      if (mounted) setState(() => _ocupado = false);
    }
  }

  Future<void> _abrirMapa(Parada p) async {
    final destino = p.latitude != null && p.longitude != null ? '${p.latitude},${p.longitude}' : p.endereco.completo;
    final uri = Uri.parse('https://www.google.com/maps/dir/?api=1&destination=${Uri.encodeComponent(destino)}&travelmode=driving');
    if (!await launchUrl(uri, mode: LaunchMode.externalApplication) && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Não foi possível abrir o mapa.')));
    }
  }

  Future<void> _ligar(String telefone) => launchUrl(Uri(scheme: 'tel', path: telefone.replaceAll(RegExp(r'[^0-9+]'), '')));

  void _abrir(Widget tela) => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => tela));

  @override
  Widget build(BuildContext context) {
    final s = Servicos.of(context);
    return ListenableBuilder(
      listenable: s.carga,
      builder: (context, _) {
        final carga = s.carga.carga;
        final p = carga?.paradaPorChave(widget.chave);
        if (carga == null || p == null) {
          return Scaffold(appBar: AppBar(title: const Text('Parada')), body: const EstadoVazio(icone: Icons.location_off_outlined, titulo: 'Parada não encontrada'));
        }
        return Scaffold(
          appBar: AppBar(title: Text('Parada ${p.ordem} de ${carga.paradas.length}')),
          bottomNavigationBar: const BarraNavegacaoEmpilhada(),
          body: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              const AvisosFila(),
              _faixaTempo(carga, p),
              const SizedBox(height: 12),
              _cartaoCliente(p),
              const SizedBox(height: 12),
              _notas(p),
              const SizedBox(height: 18),
              ..._acoes(p),
            ],
          ),
        );
      },
    );
  }

  Widget _faixaTempo(Carga carga, Parada p) {
    final agora = DateTime.now();
    if (p.status.resolvida) {
      final (texto, cor) = rotuloStatus(p.status);
      return Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(color: cor.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(16)),
        child: Row(
          children: [
            Icon(p.status == StatusParada.entregue ? Icons.check_circle_rounded : Icons.cancel_rounded, color: cor, size: 32),
            const SizedBox(width: 12),
            Expanded(child: Text('$texto${p.concluidaEm != null ? ' às ${hora(p.concluidaEm!)}' : ''}', style: TextStyle(color: cor, fontSize: 17, fontWeight: FontWeight.w800))),
            if (p.chegadaEm != null && p.concluidaEm != null)
              Text(duracao(p.concluidaEm!.difference(p.chegadaEm!)), style: TextStyle(color: cor, fontWeight: FontWeight.w700)),
          ],
        ),
      );
    }
    if (p.status == StatusParada.noCliente && p.chegadaEm != null) {
      return Container(
        padding: const EdgeInsets.all(18),
        decoration: BoxDecoration(color: Cores.marinho, borderRadius: BorderRadius.circular(20)),
        child: Row(
          children: [
            const Icon(Icons.timer_rounded, color: Cores.amarelo, size: 36),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(duracao(agora.difference(p.chegadaEm!)), style: const TextStyle(color: Colors.white, fontSize: 26, fontWeight: FontWeight.w800)),
                  const Text('no cliente', style: TextStyle(color: Color(0xFFD3DDF5))),
                ],
              ),
            ),
            Container(width: 1, height: 44, color: const Color(0xFF4A63A3)),
            const SizedBox(width: 14),
            Column(children: [
              Text(hora(p.chegadaEm!), style: const TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.w800)),
              const Text('chegada', style: TextStyle(color: Color(0xFFD3DDF5), fontSize: 13)),
            ]),
          ],
        ),
      );
    }
    final desde = carga.ultimaConcluida?.concluidaEm ?? carga.saidaEm;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 14),
      decoration: BoxDecoration(color: Cores.azulClaro, borderRadius: BorderRadius.circular(16)),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('A caminho', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 16, color: Cores.marinho)),
                Text(
                  desde == null ? 'Toque em "Cheguei" ao estacionar.' : (carga.ultimaConcluida != null ? 'Saiu do cliente anterior às ${hora(desde)}' : 'Saiu do CD às ${hora(desde)}'),
                  style: const TextStyle(color: Cores.textoSuave, fontSize: 13.5),
                ),
              ],
            ),
          ),
          if (desde != null) Text(duracao(agora.difference(desde)), style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w800, color: Cores.marinho)),
        ],
      ),
    );
  }

  Widget _cartaoCliente(Parada p) {
    return Cartao(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                const IconeCaixa(Icons.storefront_rounded, redondo: true),
                const SizedBox(width: 12),
                Expanded(child: Text(p.cliente, style: const TextStyle(fontSize: 19, fontWeight: FontWeight.w800, color: Cores.marinho))),
                PilulaStatus(p.status),
              ],
            ),
            const SizedBox(height: 12),
            _linha(Icons.location_on_outlined, [p.endereco.rua, p.endereco.regiao].where((x) => x.isNotEmpty).join(' · ')),
            if (p.endereco.complemento != null) _linha(Icons.chat_bubble_outline_rounded, p.endereco.complemento!),
            if (p.status == StatusParada.pendente || p.status == StatusParada.noCliente) ...[
              const SizedBox(height: 10),
              Row(
                children: [
                  Expanded(child: OutlinedButton.icon(onPressed: () => _abrirMapa(p), icon: const Icon(Icons.map_outlined), label: const Text('Mapa'))),
                  if (p.telefone != null) ...[
                    const SizedBox(width: 10),
                    Expanded(child: OutlinedButton.icon(onPressed: () => _ligar(p.telefone!), icon: const Icon(Icons.call_outlined), label: const Text('Ligar'))),
                  ],
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _linha(IconData icone, String texto) => Padding(
        padding: const EdgeInsets.only(top: 4),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Icon(icone, size: 20, color: Cores.azul),
          const SizedBox(width: 10),
          Expanded(child: Text(texto, style: const TextStyle(fontSize: 15, color: Cores.texto))),
        ]),
      );

  Widget _notas(Parada p) {
    return Cartao(
      child: Column(
        children: [
          for (final n in p.notas) ...[
            ListTile(
              leading: const Icon(Icons.description_outlined, color: Cores.azul),
              title: Text(n.numero == null ? 'Sem nota' : 'Nota ${n.numero}', style: const TextStyle(fontWeight: FontWeight.w800)),
              subtitle: Text(n.rotuloOrigem),
              trailing: Text(volumes(n.volumes), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
            ),
            const Divider(height: 1),
          ],
          Container(
            color: Cores.azulClaro,
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            child: Row(children: [
              const Expanded(child: Text('Total para descer', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 15))),
              Text(volumes(p.volumes), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 20, color: Cores.marinho)),
            ]),
          ),
        ],
      ),
    );
  }

  List<Widget> _acoes(Parada p) {
    switch (p.status) {
      case StatusParada.pendente:
        return [
          const Text('Toque ao estacionar. O tempo desta parada começa aqui.', textAlign: TextAlign.center, style: TextStyle(color: Cores.textoSuave)),
          const SizedBox(height: 10),
          FilledButton.icon(
            key: const Key('cheguei'),
            onPressed: _ocupado ? null : () => _cheguei(p),
            icon: const Icon(Icons.location_on_rounded),
            label: const Text('Cheguei no cliente'),
          ),
          const SizedBox(height: 10),
          OutlinedButton(
            style: OutlinedButton.styleFrom(foregroundColor: Cores.erro, side: const BorderSide(color: Cores.erro, width: 1.5)),
            onPressed: () => _abrir(NaoEntreguePage(chave: p.chave)),
            child: const Text('Não consegui chegar'),
          ),
        ];
      case StatusParada.noCliente:
        return [
          const CaixaAviso(tom: TomAviso.info, icone: Icons.draw_outlined, texto: 'Nada a receber: é só entregar e pegar a assinatura no romaneio.'),
          const SizedBox(height: 14),
          FilledButton.icon(
            key: const Key('entreguei'),
            onPressed: () => _abrir(ComprovantePage(chave: p.chave)),
            icon: const Icon(Icons.check_rounded),
            label: const Text('Entreguei'),
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(child: OutlinedButton(onPressed: () => _abrir(OcorrenciaPage(chave: p.chave)), child: const Text('Ocorrência'))),
              const SizedBox(width: 10),
              Expanded(
                child: OutlinedButton(
                  style: OutlinedButton.styleFrom(foregroundColor: Cores.erro, side: const BorderSide(color: Cores.erro, width: 1.5)),
                  onPressed: () => _abrir(NaoEntreguePage(chave: p.chave)),
                  child: const Text('Não entreguei'),
                ),
              ),
            ],
          ),
        ];
      case StatusParada.entregue:
      case StatusParada.naoEntregue:
      case StatusParada.parcial:
        return [
          if (p.ocorrencias > 0) CaixaAviso(tom: TomAviso.atencao, texto: '${p.ocorrencias} ${p.ocorrencias == 1 ? 'ocorrência registrada' : 'ocorrências registradas'}.'),
          if (p.status == StatusParada.entregue) ...[
            const SizedBox(height: 10),
            OutlinedButton(onPressed: () => _abrir(OcorrenciaPage(chave: p.chave)), child: const Text('Registrar ocorrência')),
          ],
        ];
    }
  }
}
