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

/// Múltiplo de venda > 1 = o produto só sai em embalagem fechada. Com múltiplo
/// 1 a venda é avulsa, por mais que o ERP tenha cadastrado o item como "CX":
/// o Dlinks manda unidade = "CX" pro catálogo inteiro, então a sigla sozinha
/// não distingue uma caixa de cerveja de um saco de ração vendido na unidade.
bool vendidoEmEmbalagemFechada(Map<String, dynamic> p) =>
    asDouble(p['qtd_por_embalagem']) > 1;

/// Siglas de embalagem (agrupam N unidades) — só elas caem na regra do múltiplo.
/// KG/LT são medida, não embalagem: "R$ 8,90 /kg" vale com múltiplo 1.
const _siglasDeEmbalagem = {'CX', 'FD', 'PC', 'PCT', 'PT', 'DP', 'DISP', 'SC', 'BD', 'BDJ'};

/// Embalagem cadastrada no ERP que, com múltiplo 1, na prática é venda avulsa.
bool _embalagemSemMultiplo(Map<String, dynamic> p) =>
    !vendidoEmEmbalagemFechada(p) &&
    _siglasDeEmbalagem.contains((p['unidade_venda'] as String? ?? 'UN').toUpperCase());

/// Sigla curta pro "R$X/sigla" no preço (ex.: /fd, /cx, /un, /kg) — mesmo
/// padrão de precificação que o comprador B2B já reconhece.
String siglaUnidade(Map<String, dynamic> p) {
  if (_embalagemSemMultiplo(p)) return 'un';
  switch (p['unidade_venda']) {
    case 'CX':
      return 'cx';
    case 'FD':
      return 'fd';
    case 'PC':
      return 'pc';
    case 'KG':
      return 'kg';
    default:
      return 'un';
  }
}

/// Nome por extenso da unidade de venda que vem do ERP (CX, FD, PCT...).
/// Sigla desconhecida volta como veio — melhor mostrar "DZ" do que errar.
String nomeUnidade(String? sigla) {
  switch ((sigla ?? 'UN').toUpperCase()) {
    case 'CX':
      return 'CAIXA';
    case 'FD':
      return 'FARDO';
    case 'PCT':
    case 'PT':
      return 'PACOTE';
    case 'PC':
      return 'PEÇA';
    case 'DP':
    case 'DISP':
      return 'DISPLAY';
    case 'SC':
      return 'SACO';
    case 'BD':
    case 'BDJ':
      return 'BANDEJA';
    case 'GL':
      return 'GALÃO';
    case 'KG':
      return 'KG';
    case 'LT':
      return 'LITRO';
    case 'UN':
    case 'UND':
      return 'UNIDADE';
    default:
      return (sigla ?? 'UNIDADE').toUpperCase();
  }
}

/// Nome da unidade de venda de um produto, já corrigido pelo múltiplo: item
/// cadastrado como "CX" mas com múltiplo 1 é vendido avulso, então o cliente
/// lê "UNIDADE" — mostrar "CAIXA" ali faz ele achar que leva a caixa inteira.
String nomeUnidadeDe(Map<String, dynamic> p) =>
    _embalagemSemMultiplo(p) ? 'UNIDADE' : nomeUnidade(p['unidade_venda'] as String?);

/// "CAIXA C/ 12 UN", "FARDO C/ 6 UN" ou só "UNIDADE" — texto pro cliente,
/// em caixa alta como o nome do produto, no lugar do jargão "CX c/ 12".
String descricaoEmbalagem(Map<String, dynamic> p) {
  final nome = nomeUnidadeDe(p);
  final porEmb = asDouble(p['qtd_por_embalagem']);
  return porEmb > 1 ? '$nome C/ ${porEmb.toInt()} UN' : nome;
}

/// Preço por unidade avulsa, calculado a partir do preço do pacote (fardo/
/// caixa/etc.) — o comprador B2B compara oferta pelo valor unitário mesmo
/// quando a venda mínima é por caixa fechada.
double precoUnitario(Map<String, dynamic> p, {String campoPreco = 'preco'}) {
  final porEmb = asDouble(p['qtd_por_embalagem']);
  final precoPacote = asDouble(p[campoPreco]);
  return porEmb > 1 ? precoPacote / porEmb : precoPacote;
}
