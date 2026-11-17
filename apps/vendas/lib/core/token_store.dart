import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class Tokens {
  const Tokens(this.access, this.refresh);
  final String access;
  final String refresh;
}

/// Onde os tokens ficam guardados. Em produção: [SecureTokenStore] (Keystore do
/// Android). Em testes e onde o armazenamento seguro não existe: [MemoriaTokenStore].
abstract class TokenStore {
  Future<Tokens?> ler();
  Future<void> salvar(Tokens tokens);
  Future<void> limpar();
}

class SecureTokenStore implements TokenStore {
  SecureTokenStore([FlutterSecureStorage? storage])
      : _s = storage ?? const FlutterSecureStorage(aOptions: AndroidOptions());
  final FlutterSecureStorage _s;
  static const _kAccess = 'vendas_access';
  static const _kRefresh = 'vendas_refresh';

  @override
  Future<Tokens?> ler() async {
    final a = await _s.read(key: _kAccess);
    final r = await _s.read(key: _kRefresh);
    return a == null || r == null ? null : Tokens(a, r);
  }

  @override
  Future<void> salvar(Tokens t) async {
    await _s.write(key: _kAccess, value: t.access);
    await _s.write(key: _kRefresh, value: t.refresh);
  }

  @override
  Future<void> limpar() async {
    await _s.delete(key: _kAccess);
    await _s.delete(key: _kRefresh);
  }
}

class MemoriaTokenStore implements TokenStore {
  MemoriaTokenStore([this._t]);
  Tokens? _t;
  @override
  Future<Tokens?> ler() async => _t;
  @override
  Future<void> salvar(Tokens t) async => _t = t;
  @override
  Future<void> limpar() async => _t = null;
}
