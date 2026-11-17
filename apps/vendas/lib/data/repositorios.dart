import 'package:sqflite/sqflite.dart';

import '../core/formatadores.dart' show normalizarBusca;
import 'banco_local.dart';
import 'modelos.dart';

/// Escapa `%`, `_` e `\` para uso em LIKE ... ESCAPE '\'.
String _like(String s) => s.replaceAll(r'\', r'\\').replaceAll('%', r'\%').replaceAll('_', r'\_');

/// Carteira do vendedor (clientes do espelho).
class ClientesRepository {
  ClientesRepository(this._banco);
  final BancoLocal _banco;
  Database get _db => _banco.db;

  static const _select = '''
    SELECT c.*, (SELECT MAX(h.criado_em) FROM historico h WHERE h.cliente_id = c.id) AS ultima_compra,
           (SELECT COUNT(*) FROM titulos t WHERE t.cliente_id = c.id AND t.status = 'ABERTO'
              AND t.vencimento < date('now', 'localtime')) AS titulos_vencidos
      FROM clientes c''';

  /// Busca por nome (fantasia/razão, sem acento), código do ERP (prefixo) ou
  /// documento (CPF/CNPJ, aceita pontuação). [termo] vazio = carteira toda.
  /// Ordem alfabética por nome fantasia.
  Future<List<Cliente>> buscar({String? termo, int? limite}) async {
    final t = (termo ?? '').trim();
    final where = <String>[];
    final args = <Object?>[];
    if (t.isNotEmpty) {
      final nome = '%${_like(normalizarBusca(t))}%';
      final digitos = t.replaceAll(RegExp(r'\D'), '');
      final partes = [r"c.nome_busca LIKE ? ESCAPE '\'"];
      args.add(nome);
      // CNPJ/CPF/código só quando o termo é número (com ou sem pontuação): "Mercado 24h" busca só por nome.
      if (digitos.isNotEmpty && !RegExp(r'[A-Za-zÀ-ÿ]').hasMatch(t)) {
        partes.add(r"c.documento LIKE ? ESCAPE '\'");
        args.add('%$digitos%');
        partes.add('c.erp_cliente_id = ?');
        args.add(digitos);
      }
      where.add('(${partes.join(' OR ')})');
    }
    final rows = await _db.rawQuery(
      '$_select ${where.isEmpty ? '' : 'WHERE ${where.join(' AND ')}'} ORDER BY c.nome_busca ${limite == null ? '' : 'LIMIT $limite'}',
      args,
    );
    return rows.map(Cliente.fromRow).toList();
  }

  Future<Cliente?> porId(String id) async {
    final rows = await _db.rawQuery('$_select WHERE c.id = ?', [id]);
    return rows.isEmpty ? null : Cliente.fromRow(rows.first);
  }

  Future<int> contar() async =>
      Sqflite.firstIntValue(await _db.rawQuery('SELECT COUNT(*) FROM clientes')) ?? 0;
}

/// Catálogo: produtos com preço da tabela escolhida e estoque.
class ProdutosRepository {
  ProdutosRepository(this._banco);
  final BancoLocal _banco;
  Database get _db => _banco.db;

  static const _colunas = 'p.*, pr.preco AS preco_tabela';

  /// Lista produtos. Com [tabelaId], cada item traz o preço da tabela (`preco`
  /// nulo = a tabela não tem preço para o produto). [termo] casa por nome (sem
  /// acento), SKU ou EAN. [somenteComPreco] esconde o que não tem preço na tabela
  /// (exige [tabelaId]). [somenteComEstoque] esconde estoque <= 0.
  /// Ordem: nome. Paginação por [limite]/[deslocamento].
  Future<List<ProdutoComPreco>> buscar({
    String? termo,
    String? categoriaId,
    String? tabelaId,
    bool somenteComPreco = false,
    bool somenteComEstoque = false,
    int? limite,
    int deslocamento = 0,
  }) async {
    final args = <Object?>[];
    final join = tabelaId == null
        ? 'LEFT JOIN (SELECT NULL AS produto_id, NULL AS preco) pr ON 0'
        : 'LEFT JOIN precos pr ON pr.produto_id = p.id AND pr.tabela_id = ?';
    if (tabelaId != null) args.add(tabelaId);
    final where = <String>[];
    final t = (termo ?? '').trim();
    if (t.isNotEmpty) {
      where.add(r"(p.nome_busca LIKE ? ESCAPE '\' OR p.sku LIKE ? ESCAPE '\' OR p.ean LIKE ? ESCAPE '\')");
      args.addAll(['%${_like(normalizarBusca(t))}%', '${_like(t)}%', '${_like(t)}%']);
    }
    if (categoriaId != null) {
      where.add('p.categoria_id = ?');
      args.add(categoriaId);
    }
    if (somenteComPreco && tabelaId != null) where.add('pr.preco IS NOT NULL');
    if (somenteComEstoque) where.add('p.estoque > 0');
    final rows = await _db.rawQuery(
      'SELECT $_colunas FROM produtos p $join ${where.isEmpty ? '' : 'WHERE ${where.join(' AND ')}'} '
      'ORDER BY p.nome_busca, p.id ${limite == null ? '' : 'LIMIT $limite OFFSET $deslocamento'}',
      args,
    );
    return rows.map((r) => ProdutoComPreco(Produto.fromRow(r), (r['preco_tabela'] as num?)?.toDouble())).toList();
  }

  Future<ProdutoComPreco?> porId(String id, {String? tabelaId}) async {
    final r = await buscarPorIds([id], tabelaId: tabelaId);
    return r.isEmpty ? null : r.first;
  }

  /// Vários produtos de uma vez (carrinho, histórico). Ids inexistentes são ignorados.
  Future<List<ProdutoComPreco>> buscarPorIds(List<String> ids, {String? tabelaId}) async {
    if (ids.isEmpty) return [];
    final marcas = List.filled(ids.length, '?').join(',');
    final rows = await _db.rawQuery(
      'SELECT $_colunas FROM produtos p '
      '${tabelaId == null ? 'LEFT JOIN (SELECT NULL AS produto_id, NULL AS preco) pr ON 0' : 'LEFT JOIN precos pr ON pr.produto_id = p.id AND pr.tabela_id = ?'} '
      'WHERE p.id IN ($marcas)',
      [?tabelaId, ...ids],
    );
    return rows.map((r) => ProdutoComPreco(Produto.fromRow(r), (r['preco_tabela'] as num?)?.toDouble())).toList();
  }

  /// Preço de um produto numa tabela, ou nulo se a tabela não o tem.
  Future<double?> preco(String produtoId, String tabelaId) async {
    final r = await _db.query('precos',
        columns: ['preco'], where: 'produto_id = ? AND tabela_id = ?', whereArgs: [produtoId, tabelaId]);
    return r.isEmpty ? null : (r.first['preco'] as num).toDouble();
  }

  /// Mapa produtoId -> preço numa tabela (usado para recalcular o carrinho ao trocar de tabela).
  Future<Map<String, double>> precosDaTabela(String tabelaId, {Iterable<String>? produtoIds}) async {
    final ids = produtoIds?.toList();
    if (ids != null && ids.isEmpty) return {};
    final rows = ids == null
        ? await _db.query('precos', where: 'tabela_id = ?', whereArgs: [tabelaId])
        : await _db.query('precos',
            where: 'tabela_id = ? AND produto_id IN (${List.filled(ids.length, '?').join(',')})',
            whereArgs: [tabelaId, ...ids]);
    return {for (final r in rows) r['produto_id'] as String: (r['preco'] as num).toDouble()};
  }

  Future<List<Categoria>> categorias() async {
    final rows = await _db.query('categorias', orderBy: 'ordem, nome');
    return rows.map((r) => Categoria(id: r['id'] as String, nome: r['nome'] as String)).toList();
  }

  Future<int> contar() async =>
      Sqflite.firstIntValue(await _db.rawQuery('SELECT COUNT(*) FROM produtos')) ?? 0;
}

/// Tabelas de preço e formas de pagamento aceitas por cada uma.
class TabelasRepository {
  TabelasRepository(this._banco);
  final BancoLocal _banco;
  Database get _db => _banco.db;

  /// Todas as tabelas (ordem por nome) já com suas formas.
  Future<List<TabelaComFormas>> listar() async {
    final tabelas = (await _db.query('tabelas', orderBy: 'nome')).map(TabelaPreco.fromRow).toList();
    final formas = await _db.rawQuery(
        'SELECT tf.tabela_id, f.* FROM tabela_formas tf JOIN formas f ON f.id = tf.forma_id ORDER BY f.descricao');
    final porTabela = <String, List<FormaPagamento>>{};
    for (final r in formas) {
      porTabela.putIfAbsent(r['tabela_id'] as String, () => []).add(FormaPagamento.fromRow(r));
    }
    return [for (final t in tabelas) TabelaComFormas(t, porTabela[t.id] ?? const [])];
  }

  Future<TabelaComFormas?> porId(String id) async {
    final r = await _db.query('tabelas', where: 'id = ?', whereArgs: [id]);
    if (r.isEmpty) return null;
    return TabelaComFormas(TabelaPreco.fromRow(r.first), await formasDaTabela(id));
  }

  Future<List<FormaPagamento>> formasDaTabela(String tabelaId) async {
    final rows = await _db.rawQuery(
        'SELECT f.* FROM tabela_formas tf JOIN formas f ON f.id = tf.forma_id WHERE tf.tabela_id = ? ORDER BY f.descricao',
        [tabelaId]);
    return rows.map(FormaPagamento.fromRow).toList();
  }

  Future<List<FormaPagamento>> formas() async =>
      (await _db.query('formas', orderBy: 'descricao')).map(FormaPagamento.fromRow).toList();
}

/// Títulos em aberto do cliente (financeiro), por vencimento.
class TitulosRepository {
  TitulosRepository(this._banco);
  final BancoLocal _banco;

  Future<List<Titulo>> porCliente(String clienteId) async {
    final rows = await _banco.db.query('titulos',
        where: 'cliente_id = ?', whereArgs: [clienteId], orderBy: 'vencimento, numero');
    return rows.map(Titulo.fromRow).toList();
  }
}

/// Pedidos dos últimos 90 dias do cliente (já com itens), do mais novo ao mais antigo.
class HistoricoRepository {
  HistoricoRepository(this._banco);
  final BancoLocal _banco;

  Future<List<PedidoHistorico>> porCliente(String clienteId, {int? limite}) async {
    final rows = await _banco.db.query('historico',
        where: 'cliente_id = ?',
        whereArgs: [clienteId],
        orderBy: 'criado_em DESC',
        limit: limite);
    return rows.map(PedidoHistorico.fromRow).toList();
  }

  /// Pedido do histórico pelo id do servidor (itens de pedidos feitos em outro aparelho).
  Future<PedidoHistorico?> porPedidoId(String pedidoId) async {
    final rows = await _banco.db.query('historico', where: 'pedido_id = ?', whereArgs: [pedidoId]);
    return rows.isEmpty ? null : PedidoHistorico.fromRow(rows.first);
  }
}
