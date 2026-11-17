import 'api_exception.dart';

/// Mensagens em português para os códigos de negócio da API do motorista.
const mensagensPorCodigo = <String, String>{
  'MOTORISTA_DESATIVADO': mensagemAcessoBloqueado,
};

/// Texto amigável para qualquer erro que chegue a uma tela.
String mensagemDeErro(Object erro) {
  if (erro is SemConexao) return 'Sem internet. Confira a conexão e tente de novo.';
  if (erro is ApiException) {
    final porCodigo = mensagensPorCodigo[erro.codigo];
    if (porCodigo != null) return porCodigo;
    if (erro.statusCode == 429) return erro.message.isEmpty ? 'Muitas tentativas. Aguarde um pouco.' : erro.message;
    return erro.message;
  }
  return 'Algo deu errado. Tente de novo.';
}

/// Erro que não adianta reenviar (o servidor recusou de vez): a ação sai da fila com o motivo.
bool erroDefinitivo(Object erro) =>
    erro is ApiException && erro is! SemConexao && erro.statusCode >= 400 && erro.statusCode < 500 && erro.statusCode != 401 && erro.statusCode != 408 && erro.statusCode != 429;
