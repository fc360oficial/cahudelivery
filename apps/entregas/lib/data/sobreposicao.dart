import 'banco_local.dart';
import 'modelos.dart';

/// A carga como o motorista deve ver: a última recebida do servidor MAIS o que ele já fez no aparelho e ainda
/// está na fila (sem sinal). Ação recusada pelo servidor não conta.
Carga aplicarAcoes(Carga carga, List<Acao> acoes) {
  var c = carga;
  for (final a in acoes) {
    if (a.cargaId != c.id || a.recusa != null) continue;
    final em = DateTime.tryParse('${a.dados['em'] ?? ''}') ?? a.criadaEm;
    switch (a.tipo) {
      case TipoAcao.iniciar:
        if (c.status == 'autorizada') c = c.copiar(status: 'em_rota', saidaEm: em);
      case TipoAcao.encerrar:
        c = c.copiar(status: 'encerrada');
      case TipoAcao.chegada:
      case TipoAcao.entregue:
      case TipoAcao.naoEntregue:
      case TipoAcao.ocorrencia:
        // Qualquer registro numa parada também tira a carga do CD (o servidor faz o mesmo).
        if (c.status == 'autorizada' && a.tipo != TipoAcao.ocorrencia) c = c.copiar(status: 'em_rota', saidaEm: em);
        final linhas = a.tipo == TipoAcao.ocorrencia ? ['${a.dados['linhaId']}'] : a.linhaIds;
        c = c.copiar(paradas: [for (final p in c.paradas) p.linhaIds.any(linhas.contains) ? _aplicar(p, a.tipo, em) : p]);
    }
  }
  return c;
}

Parada _aplicar(Parada p, TipoAcao tipo, DateTime em) => switch (tipo) {
      TipoAcao.chegada => p.status == StatusParada.pendente ? p.copiar(status: StatusParada.noCliente, chegadaEm: p.chegadaEm ?? em) : p,
      TipoAcao.entregue =>
        p.status.resolvida ? p : p.copiar(status: StatusParada.entregue, chegadaEm: p.chegadaEm ?? em, concluidaEm: em),
      TipoAcao.naoEntregue =>
        p.status.resolvida ? p : p.copiar(status: StatusParada.naoEntregue, chegadaEm: p.chegadaEm ?? em, concluidaEm: em),
      TipoAcao.ocorrencia => p.copiar(ocorrencias: p.ocorrencias + 1),
      _ => p,
    };
