import 'package:fluxo_vendas/data/banco_local.dart';

/// Ids fixos do cenário de pedido (banco em memória, sem a fixture da API).
class Ids {
  static const vendedor = 'ven-1';
  static const clienteOk = 'cli-ok';
  static const clienteBloqueado = 'cli-bloq';
  static const tabEntrega = 'tab-entrega'; // 1 forma (Boleto)
  static const tabRetirada = 'tab-retirada'; // 3 formas (Boleto, PIX, Cartão)
  static const tabSoPix = 'tab-so-pix'; // 1 forma (PIX), produto p3 sem preço
  static const boleto = 'f-boleto';
  static const pix = 'f-pix';
  static const cartao = 'f-cartao';
  static const p1 = 'p1';
  static const p2 = 'p2';
  static const p3 = 'p3';
}

/// Semeia o espelho: 2 clientes, 3 tabelas, 3 formas, 3 produtos e preços.
/// Cliente ok: limite 1000, em aberto 200, em trânsito 100 => disponível 700.
Future<void> semear(BancoLocal banco) async {
  final db = banco.db;
  await db.insert('meta', {'chave': 'vendedor_id', 'valor': Ids.vendedor});
  await db.insert('meta', {'chave': 'vendedor_nome', 'valor': 'ANA TESTE'});
  Future<void> cli(String id, String nome, String status) => db.insert('clientes', {
        'id': id,
        'erp_cliente_id': '10',
        'documento': '12345678000190',
        'nome_fantasia': nome,
        'nome_busca': nome.toLowerCase(),
        'status': status,
        'limite_credito': 1000,
        'em_aberto': 200,
        'pedidos_em_transito': 100,
        'tem_endereco': 0,
      });
  await cli(Ids.clienteOk, 'Mercado Bom', 'aprovado');
  await cli(Ids.clienteBloqueado, 'Mercado Bloqueado', 'bloqueado');
  Future<void> tab(String id, String nome, String tipo) =>
      db.insert('tabelas', {'id': id, 'nome': nome, 'erp_tabela_id': '1', 'tipo_entrega': tipo});
  await tab(Ids.tabEntrega, 'Entrega boleto 14 dias', 'entrega');
  await tab(Ids.tabRetirada, 'Retirada 7 dias', 'retirada');
  await tab(Ids.tabSoPix, 'Entrega PIX', 'entrega');
  Future<void> forma(String id, String d, int c) => db.insert('formas', {'id': id, 'descricao': d, 'exige_credito': c});
  await forma(Ids.boleto, 'Boleto', 1);
  await forma(Ids.pix, 'PIX', 0);
  await forma(Ids.cartao, 'Cartão', 0);
  Future<void> tf(String t, String f) => db.insert('tabela_formas', {'tabela_id': t, 'forma_id': f});
  await tf(Ids.tabEntrega, Ids.boleto);
  await tf(Ids.tabRetirada, Ids.boleto);
  await tf(Ids.tabRetirada, Ids.pix);
  await tf(Ids.tabRetirada, Ids.cartao);
  await tf(Ids.tabSoPix, Ids.pix);
  Future<void> prod(String id, String nome, double estoque) => db.insert('produtos', {
        'id': id,
        'sku': id,
        'nome': nome,
        'nome_busca': nome.toLowerCase(),
        'unidade': 'CX',
        'qtd_por_embalagem': 1,
        'estoque': estoque,
      });
  await prod(Ids.p1, 'Arroz 5kg', 10);
  await prod(Ids.p2, 'Feijão 1kg', 3);
  await prod(Ids.p3, 'Açúcar 1kg', 50);
  Future<void> preco(String p, String t, double v) => db.insert('precos', {'produto_id': p, 'tabela_id': t, 'preco': v});
  await preco(Ids.p1, Ids.tabEntrega, 10.075);
  await preco(Ids.p2, Ids.tabEntrega, 5.5);
  await preco(Ids.p3, Ids.tabEntrega, 2);
  await preco(Ids.p1, Ids.tabRetirada, 9);
  await preco(Ids.p2, Ids.tabRetirada, 5);
  await preco(Ids.p3, Ids.tabRetirada, 1.9);
  await preco(Ids.p1, Ids.tabSoPix, 11);
  await preco(Ids.p2, Ids.tabSoPix, 6);
  // p3 sem preço na tabela só-PIX
}
