import 'package:sqflite/sqflite.dart';

/// Banco SQLite local (sqflite). Espelho da carga do servidor + tabelas locais.
///
/// O MESMO código roda no Android (sqflite nativo) e no Windows/testes
/// (`sqflite_common_ffi`): quem cria o [BancoLocal] escolhe a [DatabaseFactory]
/// (veja `main.dart` e `test/suporte/banco_teste.dart`).
class BancoLocal {
  BancoLocal._(this.db);
  final Database db;

  static const versao = 2;

  static Future<BancoLocal> abrir(DatabaseFactory factory, String caminho) async {
    final db = await factory.openDatabase(
      caminho,
      options: OpenDatabaseOptions(
        version: versao,
        onCreate: (db, v) async {
          for (final sql in esquema) {
            await db.execute(sql);
          }
        },
        // v1 -> v2: rascunho do pedido em andamento (tarefa 6).
        onUpgrade: (db, de, para) async {
          if (de < 2) await db.execute(sqlRascunho);
        },
      ),
    );
    return BancoLocal._(db);
  }

  /// Tabelas do ESPELHO (substituídas inteiras a cada carga).
  static const tabelasEspelho = [
    'clientes', 'titulos', 'tabelas', 'formas', 'tabela_formas', 'categorias', 'produtos', 'precos', 'historico',
  ];

  Future<void> fechar() => db.close();

  /// Rascunho do pedido em andamento (um por vendedor): `json` = ver `Rascunho` em `data/rascunho.dart`.
  static const sqlRascunho = '''CREATE TABLE IF NOT EXISTS rascunho_pedido (
        vendedor_id TEXT PRIMARY KEY, json TEXT NOT NULL, atualizado_em TEXT NOT NULL)''';

  static const esquema = <String>[
    // Chave/valor: vendedor_id, vendedor_nome, erp_vendedor_id, distribuidora, ultima_sincronizacao,
    // carga_gerada_em, resumo (JSON de /vendas/resumo), resumo_em.
    'CREATE TABLE meta (chave TEXT PRIMARY KEY, valor TEXT)',
    '''CREATE TABLE clientes (
        id TEXT PRIMARY KEY, erp_cliente_id TEXT, documento TEXT NOT NULL, razao_social TEXT,
        nome_fantasia TEXT NOT NULL, nome_busca TEXT NOT NULL, telefone TEXT, status TEXT NOT NULL,
        limite_credito REAL, em_aberto REAL NOT NULL DEFAULT 0, pedidos_em_transito REAL NOT NULL DEFAULT 0,
        end_logradouro TEXT, end_numero TEXT, end_complemento TEXT, end_bairro TEXT, end_cidade TEXT,
        end_uf TEXT, end_cep TEXT, tem_endereco INTEGER NOT NULL DEFAULT 0)''',
    'CREATE INDEX idx_clientes_nome ON clientes(nome_busca)',
    '''CREATE TABLE titulos (
        id INTEGER PRIMARY KEY AUTOINCREMENT, cliente_id TEXT NOT NULL, numero TEXT NOT NULL,
        valor REAL NOT NULL, vencimento TEXT NOT NULL, status TEXT NOT NULL)''',
    'CREATE INDEX idx_titulos_cliente ON titulos(cliente_id, vencimento)',
    '''CREATE TABLE tabelas (
        id TEXT PRIMARY KEY, nome TEXT NOT NULL, erp_tabela_id TEXT NOT NULL,
        tipo_entrega TEXT NOT NULL CHECK (tipo_entrega IN ('entrega','retirada')))''',
    'CREATE TABLE formas (id TEXT PRIMARY KEY, descricao TEXT NOT NULL, exige_credito INTEGER NOT NULL DEFAULT 0)',
    'CREATE TABLE tabela_formas (tabela_id TEXT NOT NULL, forma_id TEXT NOT NULL, PRIMARY KEY (tabela_id, forma_id))',
    'CREATE TABLE categorias (id TEXT PRIMARY KEY, nome TEXT NOT NULL, ordem INTEGER NOT NULL DEFAULT 0)',
    '''CREATE TABLE produtos (
        id TEXT PRIMARY KEY, sku TEXT NOT NULL, ean TEXT, nome TEXT NOT NULL, nome_busca TEXT NOT NULL,
        unidade TEXT NOT NULL, qtd_por_embalagem REAL NOT NULL DEFAULT 1, categoria_id TEXT,
        estoque REAL NOT NULL DEFAULT 0, imagem_url TEXT)''',
    'CREATE INDEX idx_produtos_nome ON produtos(nome_busca)',
    'CREATE INDEX idx_produtos_categoria ON produtos(categoria_id)',
    'CREATE TABLE precos (produto_id TEXT NOT NULL, tabela_id TEXT NOT NULL, preco REAL NOT NULL, PRIMARY KEY (produto_id, tabela_id))',
    'CREATE INDEX idx_precos_tabela ON precos(tabela_id)',
    '''CREATE TABLE historico (
        pedido_id TEXT PRIMARY KEY, numero INTEGER NOT NULL, cliente_id TEXT NOT NULL, criado_em TEXT NOT NULL,
        total REAL NOT NULL, status TEXT NOT NULL, origem TEXT NOT NULL, itens_json TEXT NOT NULL)''',
    'CREATE INDEX idx_historico_cliente ON historico(cliente_id, criado_em DESC)',

    // ---- Tabelas LOCAIS: a carga NUNCA toca nelas. ----
    // id = UUID v4 gerado no aparelho (idempotência: reenviar o mesmo id nunca duplica).
    // estado: 'aguardando_envio' | 'enviando' | 'enviado' | 'retido' | 'recusado' | 'cancelado'
    // corpo_json: o corpo exato do POST /vendas/pedidos (itens com precoUnit etc.)
    // resposta_json: última resposta do servidor (status, divergências do retido, total atual)
    // motivo / codigo_erro: mensagem e código da recusa definitiva ou do retido
    // servidor_numero: número do pedido no servidor depois de aceito
    '''CREATE TABLE pedidos_locais (
        id TEXT PRIMARY KEY, vendedor_id TEXT NOT NULL, cliente_id TEXT NOT NULL, tabela_id TEXT,
        forma_id TEXT, total REAL NOT NULL DEFAULT 0, estado TEXT NOT NULL, corpo_json TEXT NOT NULL,
        resposta_json TEXT, motivo TEXT, codigo_erro TEXT, servidor_numero INTEGER,
        tentativas INTEGER NOT NULL DEFAULT 0,
        criado_em TEXT NOT NULL, atualizado_em TEXT NOT NULL, enviado_em TEXT)''',
    'CREATE INDEX idx_pedidos_locais_estado ON pedidos_locais(vendedor_id, estado, criado_em)',
    // estado: 'local' (ainda não está no servidor) | 'sincronizado' | 'recusado' | 'cancelado' | 'convertido'
    '''CREATE TABLE orcamentos_locais (
        id TEXT PRIMARY KEY, vendedor_id TEXT NOT NULL, cliente_id TEXT NOT NULL, tabela_id TEXT,
        forma_id TEXT, total REAL NOT NULL DEFAULT 0, estado TEXT NOT NULL, corpo_json TEXT NOT NULL,
        resposta_json TEXT, motivo TEXT, tentativas INTEGER NOT NULL DEFAULT 0,
        criado_em TEXT NOT NULL, atualizado_em TEXT NOT NULL, sincronizado_em TEXT)''',
    'CREATE INDEX idx_orcamentos_locais_estado ON orcamentos_locais(vendedor_id, estado, criado_em)',
    sqlRascunho,
  ];
}
