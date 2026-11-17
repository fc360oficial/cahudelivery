import 'package:flutter/material.dart';

import '../app_servicos.dart';
import '../core/formatadores.dart';
import '../core/tema.dart';
import '../data/modelos.dart';
import '../widgets/comuns.dart';
import '../widgets/marca.dart';
import '../widgets/parada_widgets.dart';
import 'parada_page.dart';

/// Início: a carga do dia (caminhão, progresso) e a próxima parada em destaque.
class InicioPage extends StatelessWidget {
  const InicioPage({super.key});

  @override
  Widget build(BuildContext context) {
    final s = Servicos.of(context);
    return ListenableBuilder(
      listenable: s.carga,
      builder: (context, _) {
        final carga = s.carga.carga;
        return RefreshIndicator(
          onRefresh: s.carga.sincronizar,
          child: ListView(
            physics: const AlwaysScrollableScrollPhysics(),
            padding: EdgeInsets.zero,
            children: [
              _Topo(nome: s.sessao.primeiroNome, distribuidora: s.sessao.distribuidora),
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 14, 16, 24),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    const AvisosFila(),
                    if (!s.carga.carregada)
                      const Padding(padding: EdgeInsets.all(40), child: Center(child: CircularProgressIndicator()))
                    else if (carga == null)
                      _SemCarga(encerrou: s.carga.encerramentoPendente, erro: s.carga.erro, aoAtualizar: s.carga.sincronizar)
                    else
                      ..._comCarga(context, carga),
                  ],
                ),
              ),
            ],
          ),
        );
      },
    );
  }

  List<Widget> _comCarga(BuildContext context, Carga carga) {
    final s = Servicos.of(context);
    final proxima = carga.proxima;
    final seguintes = carga.paradas.where((p) => p.status == StatusParada.pendente && p != proxima).take(3).toList();
    return [
      _CartaoCarga(carga: carga),
      const SizedBox(height: 14),
      if (carga.status == 'autorizada') ...[
        FilledButton.icon(
          key: const Key('sair-para-rota'),
          onPressed: s.carga.iniciarRota,
          icon: const Icon(Icons.local_shipping_rounded),
          label: const Text('Saí do CD, começar a rota'),
        ),
        const SizedBox(height: 14),
      ],
      if (proxima != null) ...[
        _ProximaParada(parada: proxima),
        if (seguintes.isNotEmpty) ...[
          const SizedBox(height: 16),
          const TituloSecao('DEPOIS'),
          for (final p in seguintes) CartaoParada(parada: p, aoTocar: () => abrirParada(context, p)),
        ],
      ] else if (carga.tudoResolvido) ...[
        const CaixaAviso(tom: TomAviso.info, icone: Icons.flag_rounded, titulo: 'Todas as paradas registradas', texto: 'Ao chegar no CD, entregue o romaneio assinado e encerre a rota.'),
        const SizedBox(height: 14),
        FilledButton.icon(
          key: const Key('encerrar-rota'),
          onPressed: () async {
            final ok = await showDialog<bool>(
              context: context,
              builder: (c) => AlertDialog(
                title: const Text('Encerrar a rota?'),
                content: const Text('Faça isso quando chegar no CD.'),
                actions: [
                  TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Ainda não')),
                  FilledButton(onPressed: () => Navigator.pop(c, true), child: const Text('Cheguei no CD')),
                ],
              ),
            );
            if (ok == true) await s.carga.encerrar();
          },
          icon: const Icon(Icons.warehouse_rounded),
          label: const Text('Cheguei no CD'),
        ),
      ],
    ];
  }
}

void abrirParada(BuildContext context, Parada p) =>
    Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => ParadaPage(chave: p.chave)));

class _Topo extends StatelessWidget {
  const _Topo({required this.nome, this.distribuidora});
  final String nome;
  final String? distribuidora;

  @override
  Widget build(BuildContext context) {
    return Container(
      color: Colors.white,
      child: SafeArea(
        bottom: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 14, 20, 16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const MarcaFluxoEntregas(altura: 40),
              const SizedBox(height: 12),
              Row(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(nome.isEmpty ? 'Olá!' : 'Olá, $nome!', style: const TextStyle(fontSize: 26, fontWeight: FontWeight.w800, color: Cores.marinho)),
                        Text('${diaDaSemana(DateTime.now())}. Boa rota!', style: const TextStyle(fontSize: 15, color: Cores.texto)),
                      ],
                    ),
                  ),
                  if (distribuidora != null)
                    Container(
                      constraints: const BoxConstraints(maxWidth: 130),
                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                      decoration: BoxDecoration(color: Cores.amarelo, borderRadius: BorderRadius.circular(12)),
                      child: Text(distribuidora!.split(' ').first.toUpperCase(),
                          maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w800, color: Cores.marinho)),
                    ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _CartaoCarga extends StatelessWidget {
  const _CartaoCarga({required this.carga});
  final Carga carga;

  @override
  Widget build(BuildContext context) {
    final total = carga.paradas.length;
    final feitas = carga.feitas;
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        gradient: const LinearGradient(colors: [Color(0xFF13307A), Cores.marinho], begin: Alignment.topLeft, end: Alignment.bottomRight),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              const Icon(Icons.local_shipping_rounded, color: Cores.amarelo, size: 36),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(carga.caminhaoNome ?? 'Carga ${carga.numero}', style: const TextStyle(color: Colors.white, fontSize: 21, fontWeight: FontWeight.w800)),
                    Text('$total ${total == 1 ? 'entrega' : 'entregas'} · ${volumes(carga.volumes)}', style: const TextStyle(color: Color(0xFFD3DDF5), fontSize: 14)),
                  ],
                ),
              ),
              Container(width: 1, height: 44, color: const Color(0xFF4A63A3)),
              const SizedBox(width: 14),
              Column(
                children: [
                  Text('$feitas de $total', style: const TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.w800)),
                  const Text('feitas', style: TextStyle(color: Color(0xFFD3DDF5), fontSize: 13)),
                ],
              ),
            ],
          ),
          const SizedBox(height: 12),
          ClipRRect(
            borderRadius: BorderRadius.circular(8),
            child: LinearProgressIndicator(
              value: total == 0 ? 0 : feitas / total,
              minHeight: 8,
              backgroundColor: const Color(0xFF4A63A3),
              color: Cores.amarelo,
              semanticsLabel: '$feitas de $total entregas feitas',
            ),
          ),
          const SizedBox(height: 10),
          Text(
            carga.saidaEm != null ? 'Saída do CD: ${hora(carga.saidaEm!)}' : 'Carga liberada. Ainda no CD.',
            style: const TextStyle(color: Color(0xFFD3DDF5), fontSize: 13.5),
          ),
        ],
      ),
    );
  }
}

class _ProximaParada extends StatelessWidget {
  const _ProximaParada({required this.parada});
  final Parada parada;

  @override
  Widget build(BuildContext context) {
    final p = parada;
    return Cartao(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20), side: const BorderSide(color: Cores.azul, width: 2)),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                NumeroParada(p, destaque: true),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(p.status == StatusParada.noCliente ? 'VOCÊ ESTÁ AQUI' : 'PRÓXIMA PARADA',
                          style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w800, color: Cores.azul, letterSpacing: 0.4)),
                      Text(p.cliente, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: Cores.marinho)),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 10),
            Text([p.endereco.rua, p.endereco.bairro].whereType<String>().where((x) => x.isNotEmpty).join(' · '),
                style: const TextStyle(color: Cores.textoSuave, fontSize: 14.5)),
            Text('${p.rotuloNotas} · ${volumes(p.volumes)}', style: const TextStyle(color: Cores.textoSuave, fontSize: 14.5)),
            const SizedBox(height: 14),
            FilledButton(onPressed: () => abrirParada(context, p), child: const Text('Abrir parada')),
          ],
        ),
      ),
    );
  }
}

class _SemCarga extends StatelessWidget {
  const _SemCarga({required this.encerrou, this.erro, required this.aoAtualizar});
  final bool encerrou;
  final String? erro;
  final Future<void> Function() aoAtualizar;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(top: 30),
        child: EstadoVazio(
          icone: encerrou ? Icons.flag_rounded : Icons.inventory_2_outlined,
          titulo: encerrou ? 'Rota encerrada' : 'Nenhuma carga liberada para você',
          texto: erro ?? (encerrou ? 'Bom descanso!' : 'Quando o CD autorizar a sua carga, ela aparece aqui.'),
          acao: OutlinedButton(onPressed: aoAtualizar, style: OutlinedButton.styleFrom(minimumSize: const Size(180, 48)), child: const Text('Atualizar')),
        ),
      );
}
