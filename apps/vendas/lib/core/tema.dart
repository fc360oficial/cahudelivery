import 'package:flutter/material.dart';

/// Paleta da marca Fluxo Vendas (plano, "Marca e visual").
class Cores {
  Cores._();
  static const marinho = Color(0xFF0B1F4B);
  static const azul = Color(0xFF1D5BE0);
  static const amarelo = Color(0xFFFFC20E);
  static const fundo = Color(0xFFF4F6FB);
  static const cartao = Colors.white;
  static const texto = Color(0xFF0F1B3D);
  static const textoSuave = Color(0xFF5B678A);
  static const linha = Color(0xFFE3E8F3);
  static const erro = Color(0xFFC62828);
  static const ok = Color(0xFF1E8E5A);
}

ThemeData construirTema() {
  final base = ColorScheme.fromSeed(seedColor: Cores.azul, brightness: Brightness.light).copyWith(
    primary: Cores.azul,
    onPrimary: Colors.white,
    secondary: Cores.amarelo,
    onSecondary: Cores.marinho,
    surface: Cores.cartao,
    onSurface: Cores.texto,
    error: Cores.erro,
  );
  final raio = BorderRadius.circular(14);
  return ThemeData(
    useMaterial3: true,
    colorScheme: base,
    scaffoldBackgroundColor: Cores.fundo,
    appBarTheme: const AppBarTheme(
      backgroundColor: Cores.marinho,
      foregroundColor: Colors.white,
      elevation: 0,
      centerTitle: false,
      titleTextStyle: TextStyle(fontSize: 18, fontWeight: FontWeight.w700, color: Colors.white),
    ),
    cardTheme: CardThemeData(
      color: Cores.cartao,
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16), side: const BorderSide(color: Cores.linha)),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: Cores.azul,
        foregroundColor: Colors.white,
        minimumSize: const Size.fromHeight(52),
        shape: RoundedRectangleBorder(borderRadius: raio),
        textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: Cores.azul,
        minimumSize: const Size.fromHeight(52),
        side: const BorderSide(color: Cores.azul),
        shape: RoundedRectangleBorder(borderRadius: raio),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: Colors.white,
      border: OutlineInputBorder(borderRadius: raio, borderSide: const BorderSide(color: Cores.linha)),
      enabledBorder: OutlineInputBorder(borderRadius: raio, borderSide: const BorderSide(color: Cores.linha)),
      focusedBorder: OutlineInputBorder(borderRadius: raio, borderSide: const BorderSide(color: Cores.azul, width: 2)),
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: Colors.white,
      indicatorColor: Cores.amarelo.withValues(alpha: 0.35),
      labelTextStyle: WidgetStateProperty.all(const TextStyle(fontSize: 12, fontWeight: FontWeight.w600)),
    ),
    snackBarTheme: const SnackBarThemeData(behavior: SnackBarBehavior.floating),
  );
}
