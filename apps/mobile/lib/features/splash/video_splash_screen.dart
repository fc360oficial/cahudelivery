import 'package:flutter/material.dart';
import 'package:video_player/video_player.dart';

/// Toca o vídeo de abertura uma vez e segue pra [next] sozinho ao terminar
/// (ou se o vídeo falhar ao carregar — nunca trava o usuário na tela).
class VideoSplashScreen extends StatefulWidget {
  const VideoSplashScreen({super.key, required this.next});
  final Widget next;

  @override
  State<VideoSplashScreen> createState() => _VideoSplashScreenState();
}

class _VideoSplashScreenState extends State<VideoSplashScreen> {
  late final VideoPlayerController _controller;
  bool _avancou = false;
  // Sem isso, quando o vídeo carrega rápido (ex.: já em cache, 2ª abertura),
  // o listener via _aoAtualizar dispara com posição=duração=0 (ainda não
  // começou a tocar) e o app pula pra tela seguinte cedo demais, deixando
  // só um frame intermediário do zoom na tela por um instante.
  bool _comecouATocar = false;

  @override
  void initState() {
    super.initState();
    _controller = VideoPlayerController.asset('assets/video/intro.mp4')
      ..initialize().then((_) {
        if (!mounted) return;
        setState(() {});
        // Sem som mesmo (o vídeo não tem áudio) — mas sem mutar, navegadores
        // (Chrome/Safari) bloqueiam autoplay e o vídeo nunca começa a tocar.
        _controller.setVolume(0);
        _controller.play();
      }).catchError((_) => _avancar());
    _controller.addListener(_aoAtualizar);
    // Rede de segurança: se por qualquer motivo o vídeo travar ou o evento
    // de fim não disparar, segue pro app mesmo assim (nunca prender o
    // usuário na splash) — o vídeo tem ~2,6s, dá folga de sobra.
    Future.delayed(const Duration(seconds: 5), _avancar);
  }

  void _aoAtualizar() {
    final v = _controller.value;
    if (!_comecouATocar) {
      if (v.isPlaying || v.position > Duration.zero) {
        setState(() => _comecouATocar = true);
      }
      return;
    }
    if (v.isInitialized &&
        !v.isPlaying &&
        v.duration > Duration.zero &&
        v.position >= v.duration) {
      _avancar();
    }
  }

  void _avancar() {
    if (_avancou || !mounted) return;
    _avancou = true;
    Navigator.of(context).pushReplacement(MaterialPageRoute(builder: (_) => widget.next));
  }

  @override
  void dispose() {
    _controller.removeListener(_aoAtualizar);
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFFFD500),
      // BoxFit.cover preenche a tela sem barras (sem "costura" de tom nas
      // bordas) — o vídeo foi redesenhado com a logo bem menor que o quadro
      // pra sobrar folga de corte em qualquer proporção de celular.
      // Só desenha o VideoPlayer depois que a reprodução realmente começou
      // (_comecouATocar) — antes disso, em alguns aparelhos (achado com
      // Motorola, 21/09/26) a textura mostra um quadro de lixo distorcido
      // por uma fração de segundo. Até lá, fica só o fundo amarelo liso.
      body: _comecouATocar
          ? SizedBox.expand(
              child: FittedBox(
                fit: BoxFit.cover,
                child: SizedBox(
                  width: _controller.value.size.width,
                  height: _controller.value.size.height,
                  child: VideoPlayer(_controller),
                ),
              ),
            )
          : const SizedBox.shrink(),
    );
  }
}
