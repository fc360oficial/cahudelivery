import 'package:flutter/material.dart';

/// Paleta da marca Fluxo Vendas (plano, "Marca e visual").
class Cores {
  Cores._();
  static const marinho = Color(0xFF0B1F4B);
  static const azul = Color(0xFF1D5BE0);
  static const amarelo = Color(0xFFFFC20E);
  static const fundo = Color(0xFFF2F5FB);
  static const azulClaro = Color(
    0xFFE6EEFD,
  ); // fundo dos ícones e do cartão de conexão
  static const cinzaChip = Color(0xFFE8ECF4);
  static const amareloClaro = Color(0xFFFFF1C4);
  static const ambar = Color(0xFFB26A00);
  static const cartao = Colors.white;
  static const texto = Color(0xFF0F1B3D);
  static const textoSuave = Color(0xFF5B678A);
  static const linha = Color(0xFFE3E8F3);
  static const erro = Color(0xFFC62828);
  static const ok = Color(0xFF1E8E5A);
}

ThemeData construirTema() {
  final base =
      ColorScheme.fromSeed(
        seedColor: Cores.azul,
        brightness: Brightness.light,
      ).copyWith(
        primary: Cores.azul,
        onPrimary: Colors.white,
        secondary: Cores.amarelo,
        onSecondary: Cores.marinho,
        surface: Cores.cartao,
        onSurface: Cores.texto,
        error: Cores.erro,
      );
  final raio = BorderRadius.circular(28);
  final campo = BorderRadius.circular(14);
  return ThemeData(
    useMaterial3: true,
    colorScheme: base,
    scaffoldBackgroundColor: Cores.fundo,
    appBarTheme: const AppBarTheme(
      backgroundColor: Cores.marinho,
      foregroundColor: Colors.white,
      elevation: 0,
      centerTitle: true,
      scrolledUnderElevation: 0,
      surfaceTintColor: Colors.transparent,
      titleTextStyle: TextStyle(
        fontSize: 20,
        fontWeight: FontWeight.w700,
        color: Colors.white,
      ),
    ),
    cardTheme: CardThemeData(
      color: Cores.cartao,
      elevation: 2,
      shadowColor: const Color(0x330B1F4B),
      surfaceTintColor: Colors.transparent,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: Cores.azul,
        foregroundColor: Colors.white,
        minimumSize: const Size.fromHeight(56),
        shape: RoundedRectangleBorder(borderRadius: raio),
        textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: Cores.azul,
        minimumSize: const Size.fromHeight(52),
        side: const BorderSide(color: Cores.azul, width: 1.5),
        shape: RoundedRectangleBorder(borderRadius: raio),
        textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: Colors.white,
      border: OutlineInputBorder(
        borderRadius: campo,
        borderSide: const BorderSide(color: Cores.linha),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: campo,
        borderSide: const BorderSide(color: Cores.linha),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: campo,
        borderSide: const BorderSide(color: Cores.azul, width: 2),
      ),
    ),
    snackBarTheme: const SnackBarThemeData(behavior: SnackBarBehavior.floating),
    dividerTheme: const DividerThemeData(color: Cores.linha, thickness: 1),
  );
}
