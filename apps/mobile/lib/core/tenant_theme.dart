import 'package:flutter/material.dart';

import 'api_client.dart';
import 'config.dart';

/// Identidade visual do tenant carregada de GET /v1/config (tema remoto).
/// Se a rede falhar no boot, usa o fallback embutido do flavor — o app abre sempre.
class TenantTheme extends ChangeNotifier {
  TenantTheme._();
  static final TenantTheme instance = TenantTheme._();

  String appNome = AppBuildConfig.appNome;
  String distribuidora = '';
  // Fallback embutido — mesmas cores do tema remoto do tenant CAHU, para não
  // piscar azul (tema antigo) antes do GET /v1/config responder.
  Color corPrimaria = const Color(0xFFFFD500);
  Color corSecundaria = const Color(0xFF1A1A1A);
  String? logoUrl;
  Map<String, dynamic> configuracoes = const {};
  bool carregado = false;

  Future<void> carregar() async {
    try {
      final cfg = await ApiClient.instance.get('/config') as Map<String, dynamic>;
      appNome = cfg['appNome'] ?? appNome;
      distribuidora = cfg['distribuidora'] ?? '';
      final tema = cfg['tema'] as Map<String, dynamic>?;
      if (tema != null) {
        corPrimaria = _hex(tema['cor_primaria']) ?? corPrimaria;
        corSecundaria = _hex(tema['cor_secundaria']) ?? corSecundaria;
        logoUrl = tema['logo_url'];
      }
      configuracoes = (cfg['configuracoes'] as Map<String, dynamic>?) ?? const {};
      carregado = true;
      notifyListeners();
    } catch (_) {
      // offline no boot: segue com o fallback embutido
    }
  }

  /// Cor de texto/ícone legível sobre a cor primária (escuro sobre amarelo).
  Color get corSobrePrimaria =>
      corPrimaria.computeLuminance() > 0.5 ? const Color(0xFF1A1A1A) : Colors.white;

  ThemeData buildTheme() {
    final base = ColorScheme.fromSeed(seedColor: corPrimaria, primary: corPrimaria);
    final scheme = base.copyWith(onPrimary: corSobrePrimaria);
    return ThemeData(
      useMaterial3: true,
      colorScheme: scheme,
      scaffoldBackgroundColor: const Color(0xFFF7F7F9),
      appBarTheme: AppBarTheme(
        backgroundColor: corPrimaria,
        foregroundColor: corSobrePrimaria,
        elevation: 0,
        centerTitle: false,
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          minimumSize: const Size.fromHeight(52),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
          textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: Colors.white,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide: BorderSide(color: Colors.grey.shade300),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide: BorderSide(color: Colors.grey.shade300),
        ),
      ),
      cardTheme: CardThemeData(
        elevation: 0,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        color: Colors.white,
      ),
    );
  }

  static Color? _hex(String? v) {
    if (v == null) return null;
    final s = v.replaceFirst('#', '');
    if (s.length != 6) return null;
    return Color(int.parse('FF$s', radix: 16));
  }
}
