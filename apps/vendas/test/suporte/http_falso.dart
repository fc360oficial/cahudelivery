import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

class Chamada {
  Chamada(this.metodo, this.caminho, this.cabecalhos, this.corpo);
  final String metodo, caminho;
  final Map<String, String> cabecalhos;
  final String corpo;
}

/// Servidor HTTP falso: [rota] devolve (status, json) por método+caminho.
class ServidorFalso {
  ServidorFalso(this.rota);
  final Future<(int, Object?)> Function(Chamada c) rota;
  final chamadas = <Chamada>[];

  late final http.Client cliente = MockClient((req) async {
    final c = Chamada(req.method, req.url.path.replaceFirst('/v1', ''), req.headers, req.body);
    chamadas.add(c);
    final (status, corpo) = await rota(c);
    return http.Response(jsonEncode(corpo), status, headers: {'content-type': 'application/json; charset=utf-8'});
  });

  int contar(String metodo, String caminho) =>
      chamadas.where((c) => c.metodo == metodo && c.caminho == caminho).length;
}
