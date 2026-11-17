import 'package:flutter/material.dart';

import '../app_servicos.dart';
import '../data/modelos.dart';
import '../widgets/comuns.dart';
import '../widgets/parada_widgets.dart';
import 'inicio_page.dart';

/// Todas as paradas da carga, na ordem.
class ParadasPage extends StatelessWidget {
  const ParadasPage({super.key});

  @override
  Widget build(BuildContext context) => const _ListaParadas(titulo: 'Paradas', soFeitas: false);
}

/// Só as paradas já registradas (entregue, não entregue).
class _ListaParadas extends StatelessWidget {
  const _ListaParadas({required this.titulo, required this.soFeitas});
  final String titulo;
  final bool soFeitas;

  @override
  Widget build(BuildContext context) {
    final s = Servicos.of(context);
    return Column(
      children: [
        TopoTela(titulo: titulo),
        Expanded(
          child: ListenableBuilder(
            listenable: s.carga,
            builder: (context, _) {
              final carga = s.carga.carga;
              final lista = (carga?.paradas ?? const <Parada>[]).where((p) => !soFeitas || p.status.resolvida).toList();
              return ListaAtualizavel(
                aoAtualizar: s.carga.sincronizar,
                vazio: EstadoVazio(
                  icone: soFeitas ? Icons.check_circle_outline_rounded : Icons.location_off_outlined,
                  titulo: carga == null ? 'Nenhuma carga liberada' : (soFeitas ? 'Nenhuma entrega registrada ainda' : 'Carga sem paradas'),
                ),
                itens: [
                  const AvisosFila(),
                  for (final p in lista) CartaoParada(parada: p, aoTocar: () => abrirParada(context, p)),
                ],
              );
            },
          ),
        ),
      ],
    );
  }
}

class FeitasPageBase extends StatelessWidget {
  const FeitasPageBase({super.key});
  @override
  Widget build(BuildContext context) => const _ListaParadas(titulo: 'Feitas', soFeitas: true);
}
