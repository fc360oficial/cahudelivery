import 'package:intl/intl.dart';

/// "09:26" no horário do celular.
String hora(DateTime d) => DateFormat('HH:mm', 'pt_BR').format(d.toLocal());

/// "Terça, 17/11"
String diaDaSemana(DateTime d) {
  final s = DateFormat("EEEE, dd/MM", 'pt_BR').format(d.toLocal());
  return s[0].toUpperCase() + s.substring(1);
}

/// "16 min", "1 h 05 min". Menos de um minuto vira "1 min".
String duracao(Duration d) {
  final m = d.inMinutes < 1 ? 1 : d.inMinutes;
  if (m < 60) return '$m min';
  return '${m ~/ 60} h ${(m % 60).toString().padLeft(2, '0')} min';
}

/// "38" ou "12,5": volumes e quilos sem casas inúteis.
String numero(double n) {
  final f = NumberFormat.decimalPattern('pt_BR')..maximumFractionDigits = 1;
  return f.format(n);
}

/// "38 volumes" / "1 volume"
String volumes(double n) => '${numero(n)} ${n == 1 ? 'volume' : 'volumes'}';
