import 'package:flutter/material.dart';

import '../app_servicos.dart';
import '../core/formatadores.dart';
import '../core/tema.dart';
import '../data/modelos.dart';
import 'comuns.dart';

(String, Color) rotuloStatus(StatusParada s) => switch (s) {
      StatusParada.pendente => ('A fazer', Cores.textoSuave),
      StatusParada.noCliente => ('No cliente', Cores.azul),
      StatusParada.entregue => ('Entregue', Cores.ok),
      StatusParada.naoEntregue => ('Não entregue', Cores.erro),
      StatusParada.parcial => ('Parcial', Cores.ambar),
    };

class PilulaStatus extends StatelessWidget {
  const PilulaStatus(this.status, {super.key});
  final StatusParada status;

  @override
  Widget build(BuildContext context) {
    final (texto, cor) = rotuloStatus(status);
    return Etiqueta(texto, cor: cor);
  }
}

/// Número da parada num quadrado (azul na próxima, verde/vermelho nas feitas).
class NumeroParada extends StatelessWidget {
  const NumeroParada(this.parada, {super.key, this.destaque = false});
  final Parada parada;
  final bool destaque;

  @override
  Widget build(BuildContext context) {
    final (fundo, cor) = destaque
        ? (Cores.azul, Colors.white)
        : switch (parada.status) {
            StatusParada.entregue => (Cores.ok.withValues(alpha: 0.13), Cores.ok),
            StatusParada.naoEntregue => (Cores.erro.withValues(alpha: 0.12), Cores.erro),
            StatusParada.parcial => (Cores.ambar.withValues(alpha: 0.13), Cores.ambar),
            _ => (Cores.azulClaro, Cores.azul),
          };
    return Container(
      width: 46,
      height: 46,
      alignment: Alignment.center,
      decoration: BoxDecoration(color: fundo, borderRadius: BorderRadius.circular(14)),
      child: Text('${parada.ordem}', style: TextStyle(color: cor, fontWeight: FontWeight.w800, fontSize: 18)),
    );
  }
}

/// Linha de parada nas listas (Paradas, Feitas e Início).
class CartaoParada extends StatelessWidget {
  const CartaoParada({super.key, required this.parada, required this.aoTocar});
  final Parada parada;
  final VoidCallback aoTocar;

  @override
  Widget build(BuildContext context) {
    final p = parada;
    final detalhe = switch (p.status) {
      StatusParada.entregue || StatusParada.naoEntregue || StatusParada.parcial when p.concluidaEm != null => '${hora(p.concluidaEm!)} · ${p.rotuloNotas}',
      StatusParada.noCliente when p.chegadaEm != null => 'Chegou às ${hora(p.chegadaEm!)}',
      _ => [p.endereco.bairro, volumes(p.volumes)].whereType<String>().join(' · '),
    };
    return Cartao(
      margin: const EdgeInsets.only(bottom: 10),
      child: InkWell(
        onTap: aoTocar,
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Row(
            children: [
              NumeroParada(p),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(p.cliente, maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16, color: Cores.texto)),
                    const SizedBox(height: 2),
                    Text(detalhe, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(color: Cores.textoSuave, fontSize: 13.5)),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              PilulaStatus(p.status),
            ],
          ),
        ),
      ),
    );
  }
}

/// Avisos da fila: sem sinal, registros guardados no aparelho e registros que o servidor recusou.
class AvisosFila extends StatelessWidget {
  const AvisosFila({super.key});

  @override
  Widget build(BuildContext context) {
    final c = Servicos.of(context).carga;
    return ListenableBuilder(
      listenable: c,
      builder: (context, _) {
        final avisos = <Widget>[
          if (c.semSinal || c.pendentes > 0)
            CaixaAviso(
              tom: TomAviso.info,
              icone: c.semSinal ? Icons.cloud_off_rounded : Icons.cloud_upload_outlined,
              titulo: c.semSinal ? 'Sem internet' : 'Enviando',
              texto: c.pendentes == 0
                  ? (c.semSinal ? 'Mostrando a última carga recebida. Pode trabalhar normalmente.' : 'Seus registros estão em dia.')
                  : '${c.pendentes} ${c.pendentes == 1 ? 'registro guardado' : 'registros guardados'} no celular. ${c.semSinal ? 'Sobem quando o sinal voltar.' : ''}'.trim(),
            ),
          for (final r in c.recusadas)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: InkWell(
                onTap: () => c.dispensarRecusa(r.id),
                child: CaixaAviso(tom: TomAviso.erro, titulo: 'O CD não aceitou um registro', texto: '${r.recusa} Avise o CD. Toque para dispensar.'),
              ),
            ),
        ];
        if (avisos.isEmpty) return const SizedBox.shrink();
        return Padding(padding: const EdgeInsets.only(bottom: 12), child: Column(children: avisos));
      },
    );
  }
}
