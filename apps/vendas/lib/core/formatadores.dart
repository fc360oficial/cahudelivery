import 'package:intl/intl.dart';

final _moeda = NumberFormat.currency(locale: 'pt_BR', symbol: 'R\$', decimalDigits: 2);

/// 1234.5 -> "R$ 1.234,50" (o espaço é o NBSP do intl; troca por espaço comum).
String moeda(num valor) => _moeda.format(valor).replaceAll(' ', ' ');

/// Quantidade sem zeros inúteis: 3.0 -> "3", 0.333 -> "0,333".
String quantidade(num q) {
  if (q == q.roundToDouble()) return q.toInt().toString();
  return q.toString().replaceAll('.', ',');
}

String _p(int v) => v.toString().padLeft(2, '0');

String hora(DateTime d) => '${_p(d.hour)}:${_p(d.minute)}';
String dataCurta(DateTime d) => '${_p(d.day)}/${_p(d.month)}';
String dataHoraCurta(DateTime d) => '${dataCurta(d)} ${hora(d)}';
String dataCompleta(DateTime d) => '${dataCurta(d)}/${d.year}';

/// Linha de conexão do Início: "Online · última sincronização 09:38"
/// ou "Sem internet · dados de 09/11 18:02". [agora] só serve para saber se é hoje.
String linhaConexao({required bool online, required DateTime? ultima, required DateTime agora}) {
  final l = ultima?.toLocal();
  final quando = l == null
      ? null
      : (l.year == agora.year && l.month == agora.month && l.day == agora.day ? hora(l) : dataHoraCurta(l));
  if (online) return quando == null ? 'Online · ainda não sincronizado' : 'Online · última sincronização $quando';
  return quando == null ? 'Sem internet · sem dados' : 'Sem internet · dados de $quando';
}

/// Primeiro nome com capitalização: "ANA PAULA (TESTE)" -> "Ana".
String primeiroNome(String nomeCompleto) {
  final n = nomeCompleto.trim().split(RegExp(r'\s+')).first;
  if (n.isEmpty) return '';
  return n[0].toUpperCase() + n.substring(1).toLowerCase();
}

/// Minúsculas e sem acentos, para buscas ("João" casa com "joao").
String normalizarBusca(String s) {
  const de = 'áàâãäéèêëíìîïóòôõöúùûüçñ';
  const para = 'aaaaaeeeeiiiiooooouuuucn';
  final b = StringBuffer();
  for (final c in s.toLowerCase().runes) {
    final ch = String.fromCharCode(c);
    final i = de.indexOf(ch);
    b.write(i >= 0 ? para[i] : ch);
  }
  return b.toString().trim();
}

/// Situação de um pedido do servidor em português ("EM_FATURAMENTO" -> "Em faturamento").
String rotuloStatusPedido(String status) => switch (status.toUpperCase()) {
      'RECEBIDO' => 'Recebido',
      'ENVIADO_ERP' => 'Enviado ao ERP',
      'ABERTO' => 'Aberto no ERP',
      'EM_FATURAMENTO' => 'Em faturamento',
      'FATURADO' => 'Faturado',
      'ENTREGUE' => 'Entregue',
      'CANCELADO' => 'Cancelado',
      'AGUARDANDO_VENDEDOR' => 'Retido',
      _ => status.isEmpty ? '-' : status[0].toUpperCase() + status.substring(1).toLowerCase().replaceAll('_', ' '),
    };

/// Documento com máscara de CPF/CNPJ quando tem 11 ou 14 dígitos; senão devolve como veio.
String documentoFormatado(String doc) {
  final d = doc.replaceAll(RegExp(r'\D'), '');
  if (d.length == 11) return '${d.substring(0, 3)}.${d.substring(3, 6)}.${d.substring(6, 9)}-${d.substring(9)}';
  if (d.length == 14) {
    return '${d.substring(0, 2)}.${d.substring(2, 5)}.${d.substring(5, 8)}/${d.substring(8, 12)}-${d.substring(12)}';
  }
  return doc;
}
