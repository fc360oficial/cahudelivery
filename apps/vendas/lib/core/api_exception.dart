/// Erro HTTP do backend (RFC 7807 simplificado): [codigo] é o código de negócio
/// da API (ex.: `CLIENTE_BLOQUEADO`), quando existir.
class ApiException implements Exception {
  ApiException(this.statusCode, this.message, {this.codigo, this.corpo});
  final int statusCode;
  final String message;
  final String? codigo;

  /// Corpo JSON da resposta de erro (ex.: `divergencias` do 409 `AINDA_DIVERGENTE`).
  final Object? corpo;

  /// Sessão não vale mais (refresh recusado ou vendedor desativado).
  bool get sessaoExpirada => statusCode == 401;

  @override
  String toString() => message;
}

/// Sem rede, DNS, recusa de conexão ou tempo esgotado. NUNCA derruba a sessão:
/// o pedido/carga simplesmente fica para a próxima tentativa.
class SemConexao extends ApiException {
  SemConexao([String message = 'Sem conexão com a internet.']) : super(0, message, codigo: 'SEM_CONEXAO');
}

/// Mensagem mostrada quando a sessão acaba por bloqueio/remoção/expiração.
const mensagemAcessoBloqueado = 'Seu acesso foi bloqueado ou a sessão expirou. Fale com o supervisor.';
