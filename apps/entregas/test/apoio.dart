import 'dart:async';
import 'dart:convert';

import 'package:fluxo_entregas/data/banco_local.dart';
import 'package:fluxo_entregas/services/carga_service.dart';
import 'package:fluxo_entregas/services/conectividade.dart';
import 'package:geolocator/geolocator.dart';
import 'package:fluxo_entregas/services/localizacao_service.dart';
import 'package:http/http.dart' as http;
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

/// Banco em memória (cada teste começa limpo).
Future<BancoLocal> bancoEmMemoria() {
  sqfliteFfiInit();
  return BancoLocal.abrir(databaseFactoryFfi, inMemoryDatabasePath);
}

class RedeFalsa implements FonteConectividade {
  final _c = StreamController<bool>.broadcast();
  bool tem = true;
  @override
  Future<bool> temRede() async => tem;
  @override
  Stream<bool> get mudancas => _c.stream;
  void mudar(bool v) {
    tem = v;
    _c.add(v);
  }
}

/// Requisição recebida pelo servidor falso.
class Pedido {
  Pedido(this.metodo, this.caminho, this.cabecalhos, this.corpo, this.campos, this.arquivos);
  final String metodo, caminho;
  final Map<String, String> cabecalhos;
  final dynamic corpo;
  final Map<String, String> campos;
  final List<String> arquivos;
}

/// Servidor falso: responde pela função [responder]; sem sinal = lança ClientException.
class ServidorFalso extends http.BaseClient {
  ServidorFalso(this.responder);
  (int, Object?) Function(Pedido p) responder;
  final pedidos = <Pedido>[];
  bool semSinal = false;

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    if (semSinal) throw http.ClientException('sem rede');
    dynamic corpo;
    final campos = <String, String>{};
    final arquivos = <String>[];
    if (request is http.Request && request.body.isNotEmpty) corpo = jsonDecode(request.body);
    if (request is http.MultipartRequest) {
      campos.addAll(request.fields);
      arquivos.addAll(request.files.map((f) => f.field));
    }
    final p = Pedido(request.method, request.url.path.replaceFirst('/v1', ''), request.headers, corpo, campos, arquivos);
    pedidos.add(p);
    final (status, resposta) = responder(p);
    final bytes = utf8.encode(resposta == null ? '' : jsonEncode(resposta));
    return http.StreamedResponse(Stream.value(bytes), status, headers: {'content-type': 'application/json'});
  }
}

/// Carga do servidor no formato da API, com [n] paradas.
Map<String, dynamic> cargaJson({String status = 'autorizada', int n = 3}) => {
      'id': 'carga-1',
      'numero': 7,
      'data': '2026-11-18',
      'status': status,
      'saidaEm': null,
      'caminhao': {'nome': 'Caminhão 2', 'placa': 'ABC1D23'},
      'paradas': [
        for (var i = 1; i <= n; i++)
          {
            'ordem': i,
            'linhaIds': ['linha-$i'],
            'cliente': 'Cliente $i',
            'telefone': '8199999000$i',
            'endereco': {'logradouro': 'Rua $i', 'numero': '$i', 'bairro': 'Prazeres', 'cidade': 'Jaboatão', 'uf': 'PE', 'cep': '54000000'},
            'latitude': -8.16,
            'longitude': -34.92,
            'notas': [
              {'numero': '4800$i', 'origem': 'app', 'pedidoNumero': '41$i', 'volumes': 10}
            ],
            'volumes': 10,
            'pesoKg': 100,
            'status': 'pendente',
            'chegadaEm': null,
            'concluidaEm': null,
            'ocorrencias': 0,
            'itens': [
              {'notaNumero': '4800$i', 'codigo': '1001', 'descricao': 'AGUA SANITARIA 2L CX6', 'quantidade': 10}
            ],
          }
      ],
    };

class PlataformaFalsa implements PlataformaLocalizacao {
  bool gps = true;
  LocationPermission perm = LocationPermission.denied;
  LocationPermission respostaPedido = LocationPermission.whileInUse;
  bool bateria = false;
  int abriuApp = 0, abriuGps = 0;
  final pontos = StreamController<PontoGps>.broadcast();
  PontoGps? atual = const PontoGps(-8.16, -34.92, 5);

  @override
  Future<bool> gpsLigado() async => gps;
  @override
  Future<LocationPermission> permissao() async => perm;
  @override
  Future<LocationPermission> pedirPermissao() async => perm = respostaPedido;
  @override
  Future<bool> abrirConfiguracoesDoApp() async {
    abriuApp++;
    return true;
  }

  @override
  Future<bool> abrirConfiguracoesDeLocalizacao() async {
    abriuGps++;
    return true;
  }

  @override
  Future<bool> bateriaLiberada() async => bateria;
  @override
  Future<void> pedirBateria() async => bateria = true;
  @override
  Future<PontoGps?> pontoAtual() async => atual;
  @override
  Stream<PontoGps> acompanhar() => pontos.stream;
}
