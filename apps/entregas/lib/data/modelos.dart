// Modelos da carga do motorista, como a API `/motorista/carga` devolve.

enum StatusParada { pendente, noCliente, entregue, naoEntregue, parcial }

StatusParada statusParadaDe(String? s) => switch (s) {
      'no_cliente' => StatusParada.noCliente,
      'entregue' => StatusParada.entregue,
      'nao_entregue' => StatusParada.naoEntregue,
      'parcial' => StatusParada.parcial,
      _ => StatusParada.pendente,
    };

String statusParadaParaApi(StatusParada s) => switch (s) {
      StatusParada.pendente => 'pendente',
      StatusParada.noCliente => 'no_cliente',
      StatusParada.entregue => 'entregue',
      StatusParada.naoEntregue => 'nao_entregue',
      StatusParada.parcial => 'parcial',
    };

extension StatusParadaX on StatusParada {
  bool get resolvida => this == StatusParada.entregue || this == StatusParada.naoEntregue || this == StatusParada.parcial;
}

String _s(dynamic v) => v == null ? '' : '$v';
String? _sn(dynamic v) => v == null || '$v'.trim().isEmpty ? null : '$v';
double _d(dynamic v) => v is num ? v.toDouble() : double.tryParse('$v') ?? 0;
double? _dn(dynamic v) => v == null ? null : (v is num ? v.toDouble() : double.tryParse('$v'));
DateTime? _data(dynamic v) => v == null ? null : DateTime.tryParse('$v');

class Endereco {
  const Endereco({this.logradouro, this.numero, this.complemento, this.bairro, this.cidade, this.uf, this.cep});
  final String? logradouro, numero, complemento, bairro, cidade, uf, cep;

  factory Endereco.deJson(Map<String, dynamic>? j) => Endereco(
        logradouro: _sn(j?['logradouro']),
        numero: _sn(j?['numero']),
        complemento: _sn(j?['complemento']),
        bairro: _sn(j?['bairro']),
        cidade: _sn(j?['cidade']),
        uf: _sn(j?['uf']),
        cep: _sn(j?['cep']),
      );

  Map<String, dynamic> paraJson() =>
      {'logradouro': logradouro, 'numero': numero, 'complemento': complemento, 'bairro': bairro, 'cidade': cidade, 'uf': uf, 'cep': cep};

  /// "Rua do Sol, 120"
  String get rua => [logradouro, numero].whereType<String>().join(', ');

  /// "Prazeres · Jaboatão dos Guararapes"
  String get regiao => [bairro, cidade].whereType<String>().join(' · ');

  /// Endereço completo para abrir no mapa.
  String get completo => [rua, bairro, cidade, uf, cep].whereType<String>().where((s) => s.isNotEmpty).join(', ');
}

class NotaParada {
  const NotaParada({this.numero, required this.origem, this.pedidoNumero, required this.volumes});
  final String? numero;
  final String origem;
  final String? pedidoNumero;
  final double volumes;

  factory NotaParada.deJson(Map<String, dynamic> j) =>
      NotaParada(numero: _sn(j['numero']), origem: _s(j['origem']), pedidoNumero: _sn(j['pedidoNumero']), volumes: _d(j['volumes']));

  Map<String, dynamic> paraJson() => {'numero': numero, 'origem': origem, 'pedidoNumero': pedidoNumero, 'volumes': volumes};

  String get rotuloOrigem => switch (origem) {
        'app' => 'Pedido do app',
        'site' => 'Pedido do site',
        'vendedor' => 'Pedido do vendedor',
        'televendas' => 'Pedido do televendas',
        _ => 'Pedido',
      };
}

class ItemParada {
  const ItemParada({this.notaNumero, this.codigo, required this.descricao, required this.quantidade});
  final String? notaNumero;
  final String? codigo;
  final String descricao;
  final double quantidade;

  factory ItemParada.deJson(Map<String, dynamic> j) =>
      ItemParada(notaNumero: _sn(j['notaNumero']), codigo: _sn(j['codigo']), descricao: _s(j['descricao']), quantidade: _d(j['quantidade']));

  Map<String, dynamic> paraJson() => {'notaNumero': notaNumero, 'codigo': codigo, 'descricao': descricao, 'quantidade': quantidade};
}

class Parada {
  const Parada({
    required this.ordem,
    required this.linhaIds,
    required this.cliente,
    this.telefone,
    required this.endereco,
    this.latitude,
    this.longitude,
    required this.notas,
    required this.volumes,
    required this.pesoKg,
    required this.status,
    this.chegadaEm,
    this.concluidaEm,
    this.ocorrencias = 0,
    this.itens = const [],
  });

  final int ordem;
  final List<String> linhaIds;
  final String cliente;
  final String? telefone;
  final Endereco endereco;
  final double? latitude, longitude;
  final List<NotaParada> notas;
  final double volumes;
  final double pesoKg;
  final StatusParada status;
  final DateTime? chegadaEm, concluidaEm;
  final int ocorrencias;
  final List<ItemParada> itens;

  /// Chave estável da parada (a primeira linha).
  String get chave => linhaIds.first;

  String get rotuloNotas {
    final numeros = notas.map((n) => n.numero).whereType<String>().toList();
    if (numeros.isEmpty) return 'Sem nota';
    return numeros.length == 1 ? 'Nota ${numeros.first}' : 'Notas ${numeros.sublist(0, numeros.length - 1).join(', ')} e ${numeros.last}';
  }

  factory Parada.deJson(Map<String, dynamic> j) => Parada(
        ordem: (j['ordem'] as num).toInt(),
        linhaIds: (j['linhaIds'] as List).map((e) => '$e').toList(),
        cliente: _s(j['cliente']),
        telefone: _sn(j['telefone']),
        endereco: Endereco.deJson(j['endereco'] as Map<String, dynamic>?),
        latitude: _dn(j['latitude']),
        longitude: _dn(j['longitude']),
        notas: ((j['notas'] as List?) ?? const []).map((n) => NotaParada.deJson(n as Map<String, dynamic>)).toList(),
        volumes: _d(j['volumes']),
        pesoKg: _d(j['pesoKg']),
        status: statusParadaDe(j['status'] as String?),
        chegadaEm: _data(j['chegadaEm']),
        concluidaEm: _data(j['concluidaEm']),
        ocorrencias: (j['ocorrencias'] as num?)?.toInt() ?? 0,
        itens: ((j['itens'] as List?) ?? const []).map((i) => ItemParada.deJson(i as Map<String, dynamic>)).toList(),
      );

  Map<String, dynamic> paraJson() => {
        'ordem': ordem,
        'linhaIds': linhaIds,
        'cliente': cliente,
        'telefone': telefone,
        'endereco': endereco.paraJson(),
        'latitude': latitude,
        'longitude': longitude,
        'notas': notas.map((n) => n.paraJson()).toList(),
        'volumes': volumes,
        'pesoKg': pesoKg,
        'status': statusParadaParaApi(status),
        'chegadaEm': chegadaEm?.toUtc().toIso8601String(),
        'concluidaEm': concluidaEm?.toUtc().toIso8601String(),
        'ocorrencias': ocorrencias,
        'itens': itens.map((i) => i.paraJson()).toList(),
      };

  Parada copiar({StatusParada? status, DateTime? chegadaEm, DateTime? concluidaEm, int? ocorrencias}) => Parada(
        ordem: ordem,
        linhaIds: linhaIds,
        cliente: cliente,
        telefone: telefone,
        endereco: endereco,
        latitude: latitude,
        longitude: longitude,
        notas: notas,
        volumes: volumes,
        pesoKg: pesoKg,
        status: status ?? this.status,
        chegadaEm: chegadaEm ?? this.chegadaEm,
        concluidaEm: concluidaEm ?? this.concluidaEm,
        ocorrencias: ocorrencias ?? this.ocorrencias,
        itens: itens,
      );
}

class Carga {
  const Carga({
    required this.id,
    required this.numero,
    required this.data,
    required this.status,
    this.saidaEm,
    this.caminhaoNome,
    this.caminhaoPlaca,
    required this.paradas,
  });

  final String id;
  final int numero;
  final String data;
  /// autorizada | em_rota | encerrada (esta só existe no aparelho, até o servidor confirmar).
  final String status;
  final DateTime? saidaEm;
  final String? caminhaoNome, caminhaoPlaca;
  final List<Parada> paradas;

  int get feitas => paradas.where((p) => p.status.resolvida).length;
  double get volumes => paradas.fold(0, (s, p) => s + p.volumes);
  double get pesoKg => paradas.fold(0, (s, p) => s + p.pesoKg);
  bool get emRota => status == 'em_rota';
  bool get tudoResolvido => paradas.every((p) => p.status.resolvida);

  /// A próxima parada a fazer (a que já tem "Cheguei" vem primeiro).
  Parada? get proxima =>
      paradas.where((p) => p.status == StatusParada.noCliente).firstOrNull ?? paradas.where((p) => p.status == StatusParada.pendente).firstOrNull;

  /// A parada concluída por último (para "Saiu do cliente anterior às...").
  Parada? get ultimaConcluida {
    final feitas = paradas.where((p) => p.concluidaEm != null).toList()..sort((a, b) => a.concluidaEm!.compareTo(b.concluidaEm!));
    return feitas.lastOrNull;
  }

  Parada? paradaPorChave(String chave) => paradas.where((p) => p.chave == chave).firstOrNull;

  factory Carga.deJson(Map<String, dynamic> j) => Carga(
        id: _s(j['id']),
        numero: (j['numero'] as num).toInt(),
        data: _s(j['data']),
        status: _s(j['status']),
        saidaEm: _data(j['saidaEm']),
        caminhaoNome: _sn((j['caminhao'] as Map?)?['nome']),
        caminhaoPlaca: _sn((j['caminhao'] as Map?)?['placa']),
        paradas: ((j['paradas'] as List?) ?? const []).map((p) => Parada.deJson(p as Map<String, dynamic>)).toList(),
      );

  Map<String, dynamic> paraJson() => {
        'id': id,
        'numero': numero,
        'data': data,
        'status': status,
        'saidaEm': saidaEm?.toUtc().toIso8601String(),
        'caminhao': caminhaoNome == null ? null : {'nome': caminhaoNome, 'placa': caminhaoPlaca},
        'paradas': paradas.map((p) => p.paraJson()).toList(),
      };

  Carga copiar({String? status, DateTime? saidaEm, List<Parada>? paradas}) => Carga(
        id: id,
        numero: numero,
        data: data,
        status: status ?? this.status,
        saidaEm: saidaEm ?? this.saidaEm,
        caminhaoNome: caminhaoNome,
        caminhaoPlaca: caminhaoPlaca,
        paradas: paradas ?? this.paradas,
      );
}
