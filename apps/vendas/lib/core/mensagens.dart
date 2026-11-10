import 'api_exception.dart';

/// Mensagens em português para os códigos de negócio da API de Vendas
/// (`ApiException.codigo`). Códigos que o servidor já explica bem na própria
/// `message` caem no texto vindo dele.
const mensagensPorCodigo = <String, String>{
  'CLIENTE_FORA_DA_CARTEIRA': 'Este cliente não faz parte da sua carteira.',
  'CLIENTE_BLOQUEADO': 'Cliente bloqueado. Fale com o supervisor.',
  'CLIENTE_SEM_CADASTRO_ERP': 'Cliente ainda sem cadastro no ERP. Não é possível vender.',
  'SEM_ENDERECO': 'Cliente sem endereço cadastrado.',
  'FORMA_NAO_PERMITIDA': 'Esta forma de pagamento não é aceita nesta tabela.',
  'TABELA_OU_FORMA_INEXISTENTE': 'Tabela ou forma de pagamento não existe mais. Sincronize e refaça.',
  'TIPO_ENTREGA_DIFERENTE_DA_TABELA': 'O tipo de entrega não bate com a tabela escolhida.',
  'PRODUTO_INDISPONIVEL': 'Há produto indisponível no pedido.',
  'PRODUTO_REPETIDO': 'Há produto repetido no pedido.',
  'VALOR_FORA_DO_LIMITE': 'O valor do pedido está fora do limite permitido.',
  'ID_DISPOSITIVO_EM_USO': 'Este pedido já foi enviado por outro aparelho.',
  'AINDA_DIVERGENTE': 'Os valores mudaram de novo. Confira e confirme outra vez.',
  'VENDEDOR_DESATIVADO': mensagemAcessoBloqueado,
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
