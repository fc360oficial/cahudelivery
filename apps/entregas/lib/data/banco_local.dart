import 'dart:convert';

import 'package:sqflite/sqflite.dart';

import 'modelos.dart';

/// Tipos de ação que o motorista registra e a fila envia, nesta ordem, quando houver sinal.
enum TipoAcao { iniciar, chegada, entregue, naoEntregue, ocorrencia, encerrar }

/// Uma ação guardada no aparelho até o servidor confirmar.
class Acao {
  const Acao({
    required this.id,
    required this.tipo,
    required this.cargaId,
    required this.dados,
    this.fotos = const {},
    required this.criadaEm,
    this.tentativas = 0,
    this.recusa,
  });

  final String id;
  final TipoAcao tipo;
  final String cargaId;
  /// Campos do formulário (linhaIds, em, lat, lng, motivo...).
  final Map<String, dynamic> dados;
  /// Campo do formulário → caminho da foto no aparelho.
  final Map<String, String> fotos;
  final DateTime criadaEm;
  final int tentativas;
  /// O servidor recusou de vez (mensagem para o motorista). Ação recusada não volta a ser enviada.
  final String? recusa;

  List<String> get linhaIds => ((dados['linhaIds'] as List?) ?? const []).map((e) => '$e').toList();
}

/// Banco do aparelho: a última carga recebida, a fila de ações e as posições ainda não enviadas.
class BancoLocal {
  BancoLocal._(this.db);
  final Database db;

  static Future<BancoLocal> abrir(DatabaseFactory fabrica, String caminho) async {
    final db = await fabrica.openDatabase(
      caminho,
      options: OpenDatabaseOptions(
        version: 1,
        onCreate: (db, _) async {
          await db.execute('create table meta (chave text primary key, valor text)');
          await db.execute('''create table fila (
            id text primary key, tipo text not null, carga_id text not null, dados text not null, fotos text not null,
            criada_em text not null, tentativas integer not null default 0, recusa text)''');
          await db.execute('create table posicoes (em text primary key, lat real not null, lng real not null, precisao real)');
        },
      ),
    );
    return BancoLocal._(db);
  }

  // ---- meta -----------------------------------------------------------------------------------

  Future<String?> ler(String chave) async {
    final r = await db.query('meta', where: 'chave = ?', whereArgs: [chave]);
    return r.isEmpty ? null : r.first['valor'] as String?;
  }

  Future<void> gravar(String chave, String? valor) async {
    if (valor == null) {
      await db.delete('meta', where: 'chave = ?', whereArgs: [chave]);
    } else {
      await db.insert('meta', {'chave': chave, 'valor': valor}, conflictAlgorithm: ConflictAlgorithm.replace);
    }
  }

  // ---- carga ----------------------------------------------------------------------------------

  Future<Carga?> carga() async {
    final j = await ler('carga');
    if (j == null) return null;
    final dados = jsonDecode(j);
    return dados == null ? null : Carga.deJson(dados as Map<String, dynamic>);
  }

  Future<void> gravarCarga(Carga? c) => gravar('carga', jsonEncode(c?.paraJson()));

  // ---- fila -----------------------------------------------------------------------------------

  Future<void> enfileirar(Acao a) => db.insert('fila', {
        'id': a.id,
        'tipo': a.tipo.name,
        'carga_id': a.cargaId,
        'dados': jsonEncode(a.dados),
        'fotos': jsonEncode(a.fotos),
        'criada_em': a.criadaEm.toUtc().toIso8601String(),
        'tentativas': a.tentativas,
        'recusa': a.recusa,
      });

  /// Na ordem em que o motorista fez.
  Future<List<Acao>> acoes() async {
    final linhas = await db.query('fila', orderBy: 'criada_em, rowid');
    return linhas
        .map((l) => Acao(
              id: l['id'] as String,
              tipo: TipoAcao.values.byName(l['tipo'] as String),
              cargaId: l['carga_id'] as String,
              dados: jsonDecode(l['dados'] as String) as Map<String, dynamic>,
              fotos: (jsonDecode(l['fotos'] as String) as Map).map((k, v) => MapEntry('$k', '$v')),
              criadaEm: DateTime.parse(l['criada_em'] as String),
              tentativas: l['tentativas'] as int,
              recusa: l['recusa'] as String?,
            ))
        .toList();
  }

  Future<void> removerAcao(String id) => db.delete('fila', where: 'id = ?', whereArgs: [id]);

  Future<void> contarTentativa(String id) => db.rawUpdate('update fila set tentativas = tentativas + 1 where id = ?', [id]);

  Future<void> recusarAcao(String id, String motivo) => db.update('fila', {'recusa': motivo}, where: 'id = ?', whereArgs: [id]);

  // ---- posições -------------------------------------------------------------------------------

  Future<void> guardarPosicao(DateTime em, double lat, double lng, double? precisao) => db.insert(
        'posicoes',
        {'em': em.toUtc().toIso8601String(), 'lat': lat, 'lng': lng, 'precisao': precisao},
        conflictAlgorithm: ConflictAlgorithm.ignore,
      );

  Future<List<Map<String, Object?>>> posicoes({int limite = 500}) => db.query('posicoes', orderBy: 'em', limit: limite);

  Future<void> removerPosicoes(List<String> ems) async {
    if (ems.isEmpty) return;
    await db.delete('posicoes', where: 'em in (${List.filled(ems.length, '?').join(',')})', whereArgs: ems);
  }

  /// Troca de motorista no mesmo aparelho: nada do anterior pode sobrar.
  Future<void> limparTudo() async {
    await db.delete('meta');
    await db.delete('fila');
    await db.delete('posicoes');
  }
}
