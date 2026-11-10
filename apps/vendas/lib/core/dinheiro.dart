/// Dinheiro em `double` arredondado a 2 casas LINHA A LINHA, igual ao servidor
/// (`apps/api/src/vendas/conferir-pedido.ts`, função `arredondar`).
///
/// Decisão: `double` com arredondamento por linha (e não centavos inteiros)
/// porque a carga e a API trocam valores decimais e o servidor soma linhas já
/// arredondadas; assim o total do aparelho bate com o do ERP centavo a centavo.
library;

/// Arredonda para 2 casas, meio centavo para cima (como `Math.round` do servidor).
/// `toStringAsPrecision(15)` desfaz o erro binário de valor*100
/// (10.075*100 = 1007.4999999999999) antes de arredondar.
double arredondar(double valor) {
  final centavos = double.parse((valor * 100).toStringAsPrecision(15));
  // Math.round do JS: floor(x + 0.5) (meio sempre para cima, também nos negativos).
  return (centavos + 0.5).floorToDouble() / 100;
}

/// Total de uma linha: preço × quantidade, arredondado.
double totalLinha(double precoUnit, double quantidade) => arredondar(precoUnit * quantidade);

/// Soma de linhas já calculadas (cada uma arredondada) com o total arredondado.
double somarLinhas(Iterable<double> totaisDeLinha) =>
    arredondar(totaisDeLinha.fold<double>(0, (a, b) => a + b));

/// Total de itens `(preço, quantidade)`: arredonda cada linha e depois soma.
double totalDoPedido(Iterable<({double precoUnit, double quantidade})> itens) =>
    somarLinhas(itens.map((i) => totalLinha(i.precoUnit, i.quantidade)));
