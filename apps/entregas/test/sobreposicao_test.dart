import 'package:flutter_test/flutter_test.dart';
import 'package:fluxo_entregas/data/banco_local.dart';
import 'package:fluxo_entregas/data/modelos.dart';
import 'package:fluxo_entregas/data/sobreposicao.dart';

import 'apoio.dart';

Acao acao(TipoAcao tipo, Map<String, dynamic> dados, {String? recusa, String carga = 'carga-1'}) =>
    Acao(id: '$tipo-${dados.hashCode}', tipo: tipo, cargaId: carga, dados: {'em': '2026-11-18T12:00:00Z', ...dados}, criadaEm: DateTime.utc(2026, 11, 18, 12), recusa: recusa);

void main() {
  final carga = Carga.deJson(cargaJson());

  test('a primeira chegada vale; entregue depois de chegar mantém a hora da chegada', () {
    final c = aplicarAcoes(carga, [
      acao(TipoAcao.chegada, {'linhaIds': ['linha-1'], 'em': '2026-11-18T11:00:00Z'}),
      acao(TipoAcao.chegada, {'linhaIds': ['linha-1'], 'em': '2026-11-18T11:30:00Z'}),
      acao(TipoAcao.entregue, {'linhaIds': ['linha-1'], 'em': '2026-11-18T11:20:00Z'}),
    ]);
    final p = c.paradas[0];
    expect(p.status, StatusParada.entregue);
    expect(p.chegadaEm, DateTime.utc(2026, 11, 18, 11));
    expect(p.concluidaEm, DateTime.utc(2026, 11, 18, 11, 20));
    expect(c.status, 'em_rota');
    expect(c.saidaEm, DateTime.utc(2026, 11, 18, 11));
  });

  test('parada já resolvida não muda; recusada e de outra carga não contam', () {
    final c = aplicarAcoes(carga, [
      acao(TipoAcao.naoEntregue, {'linhaIds': ['linha-2']}),
      acao(TipoAcao.entregue, {'linhaIds': ['linha-2']}),
      acao(TipoAcao.entregue, {'linhaIds': ['linha-3']}, recusa: 'não'),
      acao(TipoAcao.entregue, {'linhaIds': ['linha-1']}, carga: 'outra'),
    ]);
    expect(c.paradas.map((p) => p.status).toList(), [StatusParada.pendente, StatusParada.naoEntregue, StatusParada.pendente]);
  });

  test('ocorrência soma na parada sem mudar o status e não tira a carga do CD', () {
    final c = aplicarAcoes(carga, [acao(TipoAcao.ocorrencia, {'linhaId': 'linha-3'})]);
    expect(c.paradas[2].ocorrencias, 1);
    expect(c.paradas[2].status, StatusParada.pendente);
    expect(c.status, 'autorizada');
  });

  test('próxima parada: a que já tem "Cheguei" vem antes das pendentes', () {
    final c = aplicarAcoes(carga, [acao(TipoAcao.chegada, {'linhaIds': ['linha-2']})]);
    expect(c.proxima!.chave, 'linha-2');
    expect(aplicarAcoes(carga, []).proxima!.chave, 'linha-1');
  });

  test('carga e paradas sobrevivem à ida e volta pelo JSON guardado no aparelho', () {
    final c = aplicarAcoes(carga, [acao(TipoAcao.entregue, {'linhaIds': ['linha-1']})]);
    final volta = Carga.deJson(c.paraJson());
    expect(volta.paradas[0].status, StatusParada.entregue);
    expect(volta.paradas[0].itens.single.descricao, 'AGUA SANITARIA 2L CX6');
    expect(volta.caminhaoNome, 'Caminhão 2');
    expect(volta.paradas[1].rotuloNotas, 'Nota 48002');
  });
}
