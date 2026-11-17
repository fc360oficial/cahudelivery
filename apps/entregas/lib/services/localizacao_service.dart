import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:geolocator/geolocator.dart';
import 'package:permission_handler/permission_handler.dart' as ph;

import '../core/api_client.dart';
import '../core/api_exception.dart';
import '../data/banco_local.dart';
import 'carga_service.dart';

/// O que falta para o app liberar o motorista. Só [ok] libera (decisão do Tiago, 17/11/2026).
enum EstadoLocalizacao { verificando, gpsDesligado, semPermissao, negadaParaSempre, soDuranteUso, ok }

/// O que o app precisa do Android para localização. Separado para os testes trocarem por um falso.
abstract class PlataformaLocalizacao {
  Future<bool> gpsLigado();
  Future<LocationPermission> permissao();
  Future<LocationPermission> pedirPermissao();
  Future<bool> abrirConfiguracoesDoApp();
  Future<bool> abrirConfiguracoesDeLocalizacao();
  Future<bool> bateriaLiberada();
  Future<void> pedirBateria();
  Future<PontoGps?> pontoAtual();
  Stream<PontoGps> acompanhar();
}

class PlataformaGeolocator implements PlataformaLocalizacao {
  @override
  Future<bool> gpsLigado() => Geolocator.isLocationServiceEnabled();
  @override
  Future<LocationPermission> permissao() => Geolocator.checkPermission();
  @override
  Future<LocationPermission> pedirPermissao() => Geolocator.requestPermission();
  @override
  Future<bool> abrirConfiguracoesDoApp() => Geolocator.openAppSettings();
  @override
  Future<bool> abrirConfiguracoesDeLocalizacao() => Geolocator.openLocationSettings();
  @override
  Future<bool> bateriaLiberada() => ph.Permission.ignoreBatteryOptimizations.isGranted;
  @override
  Future<void> pedirBateria() async {
    await ph.Permission.notification.request();
    await ph.Permission.ignoreBatteryOptimizations.request();
  }

  @override
  Future<PontoGps?> pontoAtual() async {
    try {
      final p = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(accuracy: LocationAccuracy.high, timeLimit: Duration(seconds: 8)),
      );
      return PontoGps(p.latitude, p.longitude, p.accuracy);
    } catch (_) {
      final p = await Geolocator.getLastKnownPosition();
      return p == null ? null : PontoGps(p.latitude, p.longitude, p.accuracy);
    }
  }

  @override
  Stream<PontoGps> acompanhar() => Geolocator.getPositionStream(
        locationSettings: AndroidSettings(
          accuracy: LocationAccuracy.high,
          distanceFilter: 25,
          intervalDuration: const Duration(minutes: 1),
          // Notificação fixa exigida pelo Android para usar a localização com a tela apagada.
          foregroundNotificationConfig: const ForegroundNotificationConfig(
            notificationTitle: 'Fluxo Entregas',
            notificationText: 'Rota em andamento',
            notificationChannelName: 'Rota em andamento',
            enableWakeLock: true,
            setOngoing: true,
          ),
        ),
      ).map((p) => PontoGps(p.latitude, p.longitude, p.accuracy));
}

/// Permissão de localização (bloqueia o app até estar tudo certo) e envio da posição durante a rota.
class LocalizacaoService extends ChangeNotifier {
  LocalizacaoService({
    required PlataformaLocalizacao plataforma,
    required ApiClient api,
    required BancoLocal banco,
    DateTime Function()? agora,
    this.intervaloEnvio = const Duration(minutes: 2),
  })  : _p = plataforma,
        _api = api,
        _banco = banco,
        _agora = agora ?? DateTime.now;

  final PlataformaLocalizacao _p;
  final ApiClient _api;
  final BancoLocal _banco;
  final DateTime Function() _agora;
  final Duration intervaloEnvio;

  EstadoLocalizacao _estado = EstadoLocalizacao.verificando;
  bool _bateriaLiberada = true;
  StreamSubscription<PontoGps>? _acompanhamento;
  Timer? _envio;
  Timer? _vigia;

  EstadoLocalizacao get estado => _estado;
  bool get liberado => _estado == EstadoLocalizacao.ok;
  bool get bateriaLiberada => _bateriaLiberada;
  bool get acompanhando => _acompanhamento != null;

  /// Confere tudo de novo (ao abrir, ao voltar das configurações e a cada 30 s com o app aberto).
  Future<void> verificar() async {
    final antes = _estado;
    final EstadoLocalizacao novo;
    if (!await _p.gpsLigado()) {
      novo = EstadoLocalizacao.gpsDesligado;
    } else {
      novo = switch (await _p.permissao()) {
        LocationPermission.always => EstadoLocalizacao.ok,
        LocationPermission.whileInUse => EstadoLocalizacao.soDuranteUso,
        LocationPermission.deniedForever => EstadoLocalizacao.negadaParaSempre,
        _ => EstadoLocalizacao.semPermissao,
      };
    }
    _bateriaLiberada = await _p.bateriaLiberada();
    _estado = novo;
    if (novo != EstadoLocalizacao.ok) await pararAcompanhamento();
    if (novo != antes) notifyListeners();
  }

  void vigiar() {
    _vigia?.cancel();
    _vigia = Timer.periodic(const Duration(seconds: 30), (_) => verificar());
  }

  /// O botão da tela de bloqueio: faz o próximo passo que falta.
  Future<void> resolver() async {
    switch (_estado) {
      case EstadoLocalizacao.gpsDesligado:
        await _p.abrirConfiguracoesDeLocalizacao();
      case EstadoLocalizacao.semPermissao:
        final r = await _p.pedirPermissao();
        // Android 11+: "o tempo todo" só se marca nas configurações do app.
        if (r == LocationPermission.whileInUse) await _p.abrirConfiguracoesDoApp();
      case EstadoLocalizacao.soDuranteUso:
      case EstadoLocalizacao.negadaParaSempre:
        await _p.abrirConfiguracoesDoApp();
      case EstadoLocalizacao.ok:
      case EstadoLocalizacao.verificando:
        break;
    }
    await verificar();
  }

  Future<void> liberarBateria() async {
    await _p.pedirBateria();
    _bateriaLiberada = await _p.bateriaLiberada();
    notifyListeners();
  }

  Future<PontoGps?> pontoAtual() => liberado ? _p.pontoAtual() : Future.value();

  /// Liga o acompanhamento (com a carga em rota). Cada ponto é guardado e sobe em lote.
  void acompanhar() {
    if (_acompanhamento != null || !liberado) return;
    _acompanhamento = _p.acompanhar().listen(
      (g) => _banco.guardarPosicao(_agora(), g.lat, g.lng, g.precisaoM),
      onError: (_) => verificar(),
    );
    _envio?.cancel();
    _envio = Timer.periodic(intervaloEnvio, (_) => enviarPosicoes());
    notifyListeners();
  }

  Future<void> pararAcompanhamento() async {
    final tinha = _acompanhamento != null;
    await _acompanhamento?.cancel();
    _acompanhamento = null;
    _envio?.cancel();
    _envio = null;
    if (tinha) {
      notifyListeners();
      await enviarPosicoes();
    }
  }

  /// Sobe as posições guardadas (até 500 por vez). Sem sinal ficam para a próxima.
  Future<void> enviarPosicoes() async {
    try {
      while (true) {
        final lote = await _banco.posicoes();
        if (lote.isEmpty) return;
        await _api.post('/motorista/posicoes', body: {
          'pontos': [
            for (final p in lote)
              {'lat': p['lat'], 'lng': p['lng'], 'em': p['em'], if (p['precisao'] != null) 'precisaoM': p['precisao']},
          ],
        });
        await _banco.removerPosicoes(lote.map((p) => '${p['em']}').toList());
        if (lote.length < 500) return;
      }
    } on SemConexao {
      return;
    } on ApiException {
      return;
    }
  }

  @override
  void dispose() {
    _vigia?.cancel();
    _envio?.cancel();
    _acompanhamento?.cancel();
    super.dispose();
  }
}
