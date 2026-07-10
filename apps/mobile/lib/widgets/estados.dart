import 'package:flutter/material.dart';

/// Estados obrigatórios de toda tela (doc 10/01-FLUXO-DE-TELAS):
/// carregando (skeleton), vazio (ilustração + ação) e erro (retry).

/// Bloco cinza pulsante usado para montar skeletons de carregamento.
class Esqueleto extends StatefulWidget {
  const Esqueleto({super.key, this.width, this.height = 16, this.radius = 10});
  final double? width;
  final double height;
  final double radius;

  @override
  State<Esqueleto> createState() => _EsqueletoState();
}

class _EsqueletoState extends State<Esqueleto> with SingleTickerProviderStateMixin {
  late final AnimationController _c =
      AnimationController(vsync: this, duration: const Duration(milliseconds: 900))
        ..repeat(reverse: true);

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return FadeTransition(
      opacity: Tween(begin: 0.45, end: 1.0).animate(_c),
      child: Container(
        width: widget.width,
        height: widget.height,
        decoration: BoxDecoration(
          color: Colors.grey.shade300,
          borderRadius: BorderRadius.circular(widget.radius),
        ),
      ),
    );
  }
}

class EstadoVazio extends StatelessWidget {
  const EstadoVazio({
    super.key,
    required this.icone,
    required this.titulo,
    this.mensagem,
    this.acaoLabel,
    this.onAcao,
  });

  final IconData icone;
  final String titulo;
  final String? mensagem;
  final String? acaoLabel;
  final VoidCallback? onAcao;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icone, size: 64, color: Colors.grey.shade400),
            const SizedBox(height: 16),
            Text(titulo,
                textAlign: TextAlign.center,
                style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w600)),
            if (mensagem != null) ...[
              const SizedBox(height: 8),
              Text(mensagem!,
                  textAlign: TextAlign.center,
                  style: TextStyle(fontSize: 14, color: Colors.grey.shade600)),
            ],
            if (acaoLabel != null) ...[
              const SizedBox(height: 20),
              FilledButton(onPressed: onAcao, child: Text(acaoLabel!)),
            ],
          ],
        ),
      ),
    );
  }
}

class EstadoErro extends StatelessWidget {
  const EstadoErro({super.key, this.mensagem, required this.onTentarNovamente});
  final String? mensagem;
  final VoidCallback onTentarNovamente;

  @override
  Widget build(BuildContext context) {
    return EstadoVazio(
      icone: Icons.wifi_off_rounded,
      titulo: 'Algo deu errado',
      mensagem: mensagem ?? 'Verifique sua conexão e tente novamente.',
      acaoLabel: 'Tentar novamente',
      onAcao: onTentarNovamente,
    );
  }
}
