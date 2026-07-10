/// Conversões e formatação pt-BR sem dependência do pacote intl.
/// O backend (PostgreSQL numeric via JSON) entrega números como string.
library;

double asDouble(dynamic v) {
  if (v == null) return 0;
  if (v is num) return v.toDouble();
  return double.tryParse('$v') ?? 0;
}

/// 1234.5 -> "R$ 1.234,50"
String moeda(dynamic v) {
  final n = asDouble(v);
  final negativo = n < 0;
  final centavos = (n.abs() * 100).round();
  final inteiro = (centavos ~/ 100).toString();
  final resto = (centavos % 100).toString().padLeft(2, '0');
  final sb = StringBuffer();
  for (var i = 0; i < inteiro.length; i++) {
    if (i > 0 && (inteiro.length - i) % 3 == 0) sb.write('.');
    sb.write(inteiro[i]);
  }
  return '${negativo ? '-' : ''}R\$ $sb,$resto';
}

/// ISO 8601 -> "09/07/2026 14:32" (hora local do aparelho).
String dataHora(dynamic iso) {
  final d = DateTime.tryParse('$iso')?.toLocal();
  if (d == null) return '';
  String p(int v) => v.toString().padLeft(2, '0');
  return '${p(d.day)}/${p(d.month)}/${d.year} ${p(d.hour)}:${p(d.minute)}';
}

/// ISO 8601 -> "09/07/2026".
String dataCurta(dynamic iso) {
  final d = DateTime.tryParse('$iso')?.toLocal();
  if (d == null) return '';
  String p(int v) => v.toString().padLeft(2, '0');
  return '${p(d.day)}/${p(d.month)}/${d.year}';
}

/// "12345678000190" -> "12.345.678/0001-90"; CPF idem.
String documento(String? doc) {
  final d = (doc ?? '').replaceAll(RegExp(r'\D'), '');
  if (d.length == 14) {
    return '${d.substring(0, 2)}.${d.substring(2, 5)}.${d.substring(5, 8)}/${d.substring(8, 12)}-${d.substring(12)}';
  }
  if (d.length == 11) {
    return '${d.substring(0, 3)}.${d.substring(3, 6)}.${d.substring(6, 9)}-${d.substring(9)}';
  }
  return doc ?? '';
}

/// "01310100" -> "01310-100"
String cep(String? v) {
  final d = (v ?? '').replaceAll(RegExp(r'\D'), '');
  return d.length == 8 ? '${d.substring(0, 5)}-${d.substring(5)}' : (v ?? '');
}
