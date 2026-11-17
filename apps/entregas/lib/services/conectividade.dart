import 'package:connectivity_plus/connectivity_plus.dart';

/// Fonte de "tem rede?" injetável. Só diz se o aparelho tem alguma interface de
/// rede; se o SERVIDOR responde quem decide é a própria sincronização.
abstract class FonteConectividade {
  Future<bool> temRede();

  /// Emite a cada mudança (true = voltou/tem rede, false = caiu).
  Stream<bool> get mudancas;
}

class ConnectivityPlusFonte implements FonteConectividade {
  ConnectivityPlusFonte([Connectivity? c]) : _c = c ?? Connectivity();
  final Connectivity _c;

  static bool _tem(List<ConnectivityResult> r) => r.any((e) => e != ConnectivityResult.none);

  @override
  Future<bool> temRede() async => _tem(await _c.checkConnectivity());

  @override
  Stream<bool> get mudancas => _c.onConnectivityChanged.map(_tem).distinct();
}
