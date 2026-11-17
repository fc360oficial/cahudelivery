import 'package:flutter/material.dart';

import '../../widgets/comuns.dart';
import '../shell/home_shell.dart';

/// Aba Metas: ainda sem conteúdo, só o aviso "Em breve".
class MetasPage extends StatelessWidget {
  const MetasPage({super.key});

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        TopoTela(
          titulo: 'Metas',
          aoVoltar: () => HomeShell.ativo?.irPara(AbaVendas.inicio),
        ),
        const Expanded(
          child: EstadoVazio(
            icone: Icons.flag_outlined,
            titulo: 'Em breve',
            texto: 'Aqui você vai acompanhar a sua meta do mês.',
          ),
        ),
      ],
    );
  }
}
