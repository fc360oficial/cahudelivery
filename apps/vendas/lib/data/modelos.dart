import 'dart:convert';

import '../core/formatadores.dart' show normalizarBusca;

double _d(Object? v) => v == null ? 0 : (v as num).toDouble();
double? _dn(Object? v) => v == null ? null : (v as num).toDouble();
String? _sn(Object? v) => v == null ? null : '$v';

/// Endereço do cliente (um só: o padrão). Todos os campos podem faltar no ERP.
class Endereco {
  const Endereco({this.logradouro, this.numero, this.complemento, this.bairro, this.cidade, this.uf, this.cep});
  final String? logradouro, numero, complemento, bairro, cidade, uf, cep;

  factory Endereco.fromJson(Map<String, dynamic> j) => Endereco(
        logradouro: _sn(j['logradouro']),
        numero: _sn(j['numero']),
        complemento: _sn(j['complemento']),
        bairro: _sn(j['bairro']),
        cidade: _sn(j['cidade']),
        uf: _sn(j['uf']),
        cep: _sn(j['cep']),
      );

  /// Linha única para mostrar: "RUA X, 10 · BAIRRO · CIDADE/UF".
  String get resumo {
    final rua = [logradouro, numero].where((e) => e != null && e.isNotEmpty).join(', ');
    final cid = [cidade, uf].where((e) => e != null && e.isNotEmpty).join('/');
    return [rua, bairro, cid].where((e) => e != null && e.isNotEmpty).join(' · ');
  }
}

class Cliente {
  const Cliente({
    required this.id,
    this.erpClienteId,
    required this.documento,
    this.razaoSocial,
    required this.nomeFantasia,
    this.telefone,
    required this.status,
    this.limiteCredito,
    required this.emAberto,
    required this.pedidosEmTransito,
    this.endereco,
    this.ultimaCompra,
    this.titulosVencidos = 0,
  });

  final String id;

  /// Nulo = sem cadastro no ERP (não pode vender).
  final String? erpClienteId;
  final String documento;
  final String? razaoSocial;
  final String nomeFantasia;
  final String? telefone;
  final String status;
  final double? limiteCredito;
  final double emAberto;
  final double pedidosEmTransito;
  final Endereco? endereco;

  /// Data do último pedido no histórico local (preenchida só pelas consultas do repositório).
  final DateTime? ultimaCompra;

  /// Títulos em aberto com vencimento passado. Com algum, o cliente não pode ter pedido novo
  /// (regra do dono: bloqueia em qualquer tabela e forma de pagamento).
  final int titulosVencidos;
  bool get temTituloVencido => titulosVencidos > 0;

  /// Por que o cliente não pode receber pedido; nulo quando pode.
  String? get motivoSemPedido => bloqueado
      ? 'Cliente bloqueado: não é possível fazer pedido. Fale com o supervisor.'
      : !temCadastroErp
          ? 'Cliente sem cadastro no ERP: não é possível vender.'
          : temTituloVencido
              ? 'Cliente com título vencido: não é possível fazer pedido até regularizar.'
              : null;

  /// limite − em aberto − pedidos a prazo ainda não faturados. Nulo se não há limite.
  double? get creditoDisponivel => limiteCredito == null ? null : limiteCredito! - emAberto - pedidosEmTransito;
  bool get temCadastroErp => erpClienteId != null && erpClienteId!.isNotEmpty;
  bool get bloqueado => status != 'aprovado';

  factory Cliente.fromJson(Map<String, dynamic> j) => Cliente(
        id: j['id'] as String,
        erpClienteId: _sn(j['erpClienteId']),
        documento: '${j['documento']}',
        razaoSocial: _sn(j['razaoSocial']),
        nomeFantasia: '${j['nomeFantasia']}',
        telefone: _sn(j['telefone']),
        status: '${j['status']}',
        limiteCredito: _dn(j['limiteCredito']),
        emAberto: _d(j['emAberto']),
        pedidosEmTransito: _d(j['pedidosEmTransito']),
        endereco: j['endereco'] == null ? null : Endereco.fromJson(Map<String, dynamic>.from(j['endereco'] as Map)),
      );

  Map<String, Object?> toRow() => {
        'id': id,
        'erp_cliente_id': erpClienteId,
        'documento': documento,
        'razao_social': razaoSocial,
        'nome_fantasia': nomeFantasia,
        'telefone': telefone,
        'status': status,
        'limite_credito': limiteCredito,
        'em_aberto': emAberto,
        'pedidos_em_transito': pedidosEmTransito,
        'nome_busca': normalizarBusca('$nomeFantasia ${razaoSocial ?? ''}'),
        'end_logradouro': endereco?.logradouro,
        'end_numero': endereco?.numero,
        'end_complemento': endereco?.complemento,
        'end_bairro': endereco?.bairro,
        'end_cidade': endereco?.cidade,
        'end_uf': endereco?.uf,
        'end_cep': endereco?.cep,
        'tem_endereco': endereco == null ? 0 : 1,
      };

  factory Cliente.fromRow(Map<String, Object?> r) => Cliente(
        id: r['id'] as String,
        erpClienteId: r['erp_cliente_id'] as String?,
        documento: r['documento'] as String,
        razaoSocial: r['razao_social'] as String?,
        nomeFantasia: r['nome_fantasia'] as String,
        telefone: r['telefone'] as String?,
        status: r['status'] as String,
        limiteCredito: _dn(r['limite_credito']),
        emAberto: _d(r['em_aberto']),
        pedidosEmTransito: _d(r['pedidos_em_transito']),
        endereco: r['tem_endereco'] == 1
            ? Endereco(
                logradouro: r['end_logradouro'] as String?,
                numero: r['end_numero'] as String?,
                complemento: r['end_complemento'] as String?,
                bairro: r['end_bairro'] as String?,
                cidade: r['end_cidade'] as String?,
                uf: r['end_uf'] as String?,
                cep: r['end_cep'] as String?)
            : null,
        ultimaCompra: r['ultima_compra'] == null ? null : DateTime.parse(r['ultima_compra'] as String),
        titulosVencidos: (r['titulos_vencidos'] as num? ?? 0).toInt(),
      );
}

String _dataIso(DateTime d) =>
    '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

class Titulo {
  const Titulo({
    required this.clienteId,
    required this.numero,
    required this.valor,
    required this.vencimento,
    required this.status,
  });
  final String clienteId, numero, status;
  final double valor;

  /// Só a data (yyyy-MM-dd), à meia-noite local.
  final DateTime vencimento;

  bool vencido(DateTime agora) => vencimento.isBefore(DateTime(agora.year, agora.month, agora.day));

  factory Titulo.fromJson(Map<String, dynamic> j) => Titulo(
        clienteId: j['clienteId'] as String,
        numero: '${j['numero']}',
        valor: _d(j['valor']),
        vencimento: DateTime.parse(j['vencimento'] as String),
        status: '${j['status']}',
      );

  Map<String, Object?> toRow() =>
      {'cliente_id': clienteId, 'numero': numero, 'valor': valor, 'vencimento': _dataIso(vencimento), 'status': status};

  factory Titulo.fromRow(Map<String, Object?> r) => Titulo(
        clienteId: r['cliente_id'] as String,
        numero: r['numero'] as String,
        valor: _d(r['valor']),
        vencimento: DateTime.parse(r['vencimento'] as String),
        status: r['status'] as String,
      );
}

enum TipoEntrega { entrega, retirada }

class TabelaPreco {
  const TabelaPreco({required this.id, required this.nome, required this.erpTabelaId, required this.tipoEntrega});
  final String id, nome, erpTabelaId;
  final TipoEntrega tipoEntrega;

  /// Valor que o servidor espera/devolve ('entrega' | 'retirada').
  String get tipoEntregaApi => tipoEntrega.name;

  factory TabelaPreco.fromJson(Map<String, dynamic> j) => TabelaPreco(
        id: j['id'] as String,
        nome: '${j['nome']}',
        erpTabelaId: '${j['erpTabelaId']}',
        tipoEntrega: j['tipoEntrega'] == 'retirada' ? TipoEntrega.retirada : TipoEntrega.entrega,
      );

  Map<String, Object?> toRow() => {'id': id, 'nome': nome, 'erp_tabela_id': erpTabelaId, 'tipo_entrega': tipoEntrega.name};

  factory TabelaPreco.fromRow(Map<String, Object?> r) => TabelaPreco(
        id: r['id'] as String,
        nome: r['nome'] as String,
        erpTabelaId: r['erp_tabela_id'] as String,
        tipoEntrega: r['tipo_entrega'] == 'retirada' ? TipoEntrega.retirada : TipoEntrega.entrega,
      );
}

class FormaPagamento {
  const FormaPagamento({required this.id, required this.descricao, required this.exigeCredito});
  final String id, descricao;

  /// Boleto: confere limite de crédito do cliente.
  final bool exigeCredito;

  factory FormaPagamento.fromJson(Map<String, dynamic> j) =>
      FormaPagamento(id: j['id'] as String, descricao: '${j['descricao']}', exigeCredito: j['exigeCredito'] == true);

  Map<String, Object?> toRow() => {'id': id, 'descricao': descricao, 'exige_credito': exigeCredito ? 1 : 0};

  factory FormaPagamento.fromRow(Map<String, Object?> r) =>
      FormaPagamento(id: r['id'] as String, descricao: r['descricao'] as String, exigeCredito: r['exige_credito'] == 1);
}

class TabelaComFormas {
  const TabelaComFormas(this.tabela, this.formas);
  final TabelaPreco tabela;
  final List<FormaPagamento> formas;
}

class Categoria {
  const Categoria({required this.id, required this.nome});
  final String id, nome;
  factory Categoria.fromJson(Map<String, dynamic> j) => Categoria(id: j['id'] as String, nome: '${j['nome']}');
}

class Produto {
  const Produto({
    required this.id,
    required this.sku,
    this.ean,
    required this.nome,
    required this.unidade,
    required this.qtdPorEmbalagem,
    this.categoriaId,
    required this.estoque,
    this.imagemUrl,
  });
  final String id, sku, nome, unidade;
  final String? ean, categoriaId, imagemUrl;
  final double qtdPorEmbalagem, estoque;

  factory Produto.fromJson(Map<String, dynamic> j) => Produto(
        id: j['id'] as String,
        sku: '${j['sku']}',
        ean: _sn(j['ean']),
        nome: '${j['nome']}',
        unidade: '${j['unidade']}',
        qtdPorEmbalagem: _d(j['qtdPorEmbalagem']),
        categoriaId: _sn(j['categoriaId']),
        estoque: _d(j['estoque']),
        imagemUrl: _sn(j['imagemUrl']),
      );

  Map<String, Object?> toRow() => {
        'id': id,
        'sku': sku,
        'ean': ean,
        'nome': nome,
        'nome_busca': normalizarBusca(nome),
        'unidade': unidade,
        'qtd_por_embalagem': qtdPorEmbalagem,
        'categoria_id': categoriaId,
        'estoque': estoque,
        'imagem_url': imagemUrl,
      };

  factory Produto.fromRow(Map<String, Object?> r) => Produto(
        id: r['id'] as String,
        sku: r['sku'] as String,
        ean: r['ean'] as String?,
        nome: r['nome'] as String,
        unidade: r['unidade'] as String,
        qtdPorEmbalagem: _d(r['qtd_por_embalagem']),
        categoriaId: r['categoria_id'] as String?,
        estoque: _d(r['estoque']),
        imagemUrl: r['imagem_url'] as String?,
      );
}

/// Produto + preço numa tabela. [preco] nulo = a tabela não tem preço (não vende).
class ProdutoComPreco {
  const ProdutoComPreco(this.produto, this.preco);
  final Produto produto;
  final double? preco;
  bool get semPreco => preco == null;
}

class Preco {
  const Preco({required this.produtoId, required this.tabelaId, required this.preco});
  final String produtoId, tabelaId;
  final double preco;
  factory Preco.fromJson(Map<String, dynamic> j) =>
      Preco(produtoId: j['produtoId'] as String, tabelaId: j['tabelaId'] as String, preco: _d(j['preco']));
}

class ItemHistorico {
  const ItemHistorico({required this.produtoId, required this.quantidade, required this.precoUnit});
  final String produtoId;
  final double quantidade, precoUnit;
  factory ItemHistorico.fromJson(Map<String, dynamic> j) =>
      ItemHistorico(produtoId: j['produtoId'] as String, quantidade: _d(j['quantidade']), precoUnit: _d(j['precoUnit']));
  Map<String, Object?> toJson() => {'produtoId': produtoId, 'quantidade': quantidade, 'precoUnit': precoUnit};
}

class PedidoHistorico {
  const PedidoHistorico({
    required this.pedidoId,
    required this.numero,
    required this.clienteId,
    required this.criadoEm,
    required this.total,
    required this.status,
    required this.origem,
    required this.itens,
  });

  /// [origem]: 'app_cliente' | 'vendedor'.
  final String pedidoId, clienteId, status, origem;
  final int numero;
  final DateTime criadoEm;
  final double total;
  final List<ItemHistorico> itens;

  factory PedidoHistorico.fromJson(Map<String, dynamic> j) => PedidoHistorico(
        pedidoId: j['pedidoId'] as String,
        numero: (j['numero'] as num).toInt(),
        clienteId: j['clienteId'] as String,
        criadoEm: DateTime.parse(j['criadoEm'] as String),
        total: _d(j['total']),
        status: '${j['status']}',
        origem: '${j['origem']}',
        itens: ((j['itens'] as List?) ?? const [])
            .map((i) => ItemHistorico.fromJson(Map<String, dynamic>.from(i as Map)))
            .toList(),
      );

  Map<String, Object?> toRow() => {
        'pedido_id': pedidoId,
        'numero': numero,
        'cliente_id': clienteId,
        'criado_em': criadoEm.toUtc().toIso8601String(),
        'total': total,
        'status': status,
        'origem': origem,
        'itens_json': jsonEncode(itens.map((i) => i.toJson()).toList()),
      };

  factory PedidoHistorico.fromRow(Map<String, Object?> r) => PedidoHistorico(
        pedidoId: r['pedido_id'] as String,
        numero: r['numero'] as int,
        clienteId: r['cliente_id'] as String,
        criadoEm: DateTime.parse(r['criado_em'] as String),
        total: _d(r['total']),
        status: r['status'] as String,
        origem: r['origem'] as String,
        itens: (jsonDecode(r['itens_json'] as String) as List)
            .map((i) => ItemHistorico.fromJson(Map<String, dynamic>.from(i as Map)))
            .toList(),
      );
}

class VendedorInfo {
  const VendedorInfo({required this.id, required this.nome, this.erpVendedorId});
  final String id, nome;
  final String? erpVendedorId;
}

/// Resposta de `GET /v1/vendas/resumo`. A API não traz a contagem de pedidos do mês, só o valor.
/// Meta do mês do vendedor (`meta` do `GET /vendas/resumo`). `metaMes`, `atingidoPct` e `faltam` são
/// nulos quando o vendedor não tem meta neste mês. O que conta como vendido é só o que o ERP faturou.
class MetaVendas {
  const MetaVendas({this.percentual, this.vendidoMesAnterior, this.origemBase, this.metaMes, this.atingidoPct, this.faltam});
  final double? percentual, vendidoMesAnterior, metaMes, atingidoPct, faltam;
  final String? origemBase;

  bool get temMeta => metaMes != null && atingidoPct != null;

  static double? _n(Object? v) => v is num ? v.toDouble() : null;

  factory MetaVendas.fromJson(Map<String, dynamic> j) => MetaVendas(
        percentual: _n(j['percentual']),
        vendidoMesAnterior: _n(j['vendidoMesAnterior']),
        origemBase: j['origemBase'] as String?,
        metaMes: _n(j['metaMes']),
        atingidoPct: _n(j['atingidoPct']),
        faltam: _n(j['faltam']),
      );

  Map<String, Object?> toJson() => {
        'percentual': percentual,
        'vendidoMesAnterior': vendidoMesAnterior,
        'origemBase': origemBase,
        'metaMes': metaMes,
        'atingidoPct': atingidoPct,
        'faltam': faltam,
      };
}

class ResumoVendedor {
  const ResumoVendedor({
    required this.vendidoHoje,
    required this.pedidosHoje,
    required this.ticketMedioHoje,
    required this.vendidoMes,
    this.devolvidoMes = 0,
    this.pedidosMes = 0,
    this.pedidosFaturadosMes = 0,
    required this.clientesCarteira,
    required this.clientesPositivadosMes,
    required this.pedidosRetidos,
    required this.orcamentosAbertos,
    this.meta,
  });

  /// `vendidoHoje` e `vendidoMes` são o que o ERP FATUROU (regra do dono: só o faturado é "vendido").
  /// `vendidoMes` já vem LÍQUIDO: faturado no mês menos `devolvidoMes` (devoluções que entraram no mês).
  final double vendidoHoje, ticketMedioHoje, vendidoMes, devolvidoMes;
  final int pedidosHoje, pedidosMes, pedidosFaturadosMes, clientesCarteira, clientesPositivadosMes, pedidosRetidos, orcamentosAbertos;

  /// Nulo em API antiga (sem o campo `meta`).
  final MetaVendas? meta;

  factory ResumoVendedor.fromJson(Map<String, dynamic> j) => ResumoVendedor(
        vendidoHoje: _d(j['vendidoHoje']),
        pedidosHoje: (j['pedidosHoje'] as num? ?? 0).toInt(),
        ticketMedioHoje: _d(j['ticketMedioHoje']),
        vendidoMes: _d(j['vendidoMes']),
        devolvidoMes: _d(j['devolvidoMes']),
        pedidosMes: (j['pedidosMes'] as num? ?? 0).toInt(),
        pedidosFaturadosMes: (j['pedidosFaturadosMes'] as num? ?? 0).toInt(),
        clientesCarteira: (j['clientesCarteira'] as num? ?? 0).toInt(),
        clientesPositivadosMes: (j['clientesPositivadosMes'] as num? ?? 0).toInt(),
        pedidosRetidos: (j['pedidosRetidos'] as num? ?? 0).toInt(),
        orcamentosAbertos: (j['orcamentosAbertos'] as num? ?? 0).toInt(),
        meta: j['meta'] is Map<String, dynamic> ? MetaVendas.fromJson(j['meta'] as Map<String, dynamic>) : null,
      );

  Map<String, Object?> toJson() => {
        'vendidoHoje': vendidoHoje,
        'pedidosHoje': pedidosHoje,
        'ticketMedioHoje': ticketMedioHoje,
        'vendidoMes': vendidoMes,
        'devolvidoMes': devolvidoMes,
        'pedidosMes': pedidosMes,
        'pedidosFaturadosMes': pedidosFaturadosMes,
        'clientesCarteira': clientesCarteira,
        'clientesPositivadosMes': clientesPositivadosMes,
        'pedidosRetidos': pedidosRetidos,
        'orcamentosAbertos': orcamentosAbertos,
        'meta': meta?.toJson(),
      };
}

typedef TabelaForma = ({String tabelaId, String formaId});

/// Payload completo de `GET /v1/vendas/sync` (espelho de `CargaVendedor` na API).
class CargaVendedor {
  CargaVendedor({
    required this.geradoEm,
    required this.vendedor,
    required this.clientes,
    required this.titulos,
    required this.tabelas,
    required this.formas,
    required this.tabelaFormas,
    required this.categorias,
    required this.produtos,
    required this.precos,
    required this.historico,
  });

  final DateTime geradoEm;
  final VendedorInfo vendedor;
  final List<Cliente> clientes;
  final List<Titulo> titulos;
  final List<TabelaPreco> tabelas;
  final List<FormaPagamento> formas;
  final List<TabelaForma> tabelaFormas;
  final List<Categoria> categorias;
  final List<Produto> produtos;
  final List<Preco> precos;
  final List<PedidoHistorico> historico;

  static List<T> _lista<T>(Object? v, T Function(Map<String, dynamic>) f) =>
      ((v as List?) ?? const []).map((e) => f(Map<String, dynamic>.from(e as Map))).toList();

  factory CargaVendedor.fromJson(Map<String, dynamic> j) {
    final v = Map<String, dynamic>.from(j['vendedor'] as Map);
    return CargaVendedor(
      geradoEm: DateTime.parse(j['geradoEm'] as String),
      vendedor: VendedorInfo(id: v['id'] as String, nome: '${v['nome']}', erpVendedorId: _sn(v['erpVendedorId'])),
      clientes: _lista(j['clientes'], Cliente.fromJson),
      titulos: _lista(j['titulos'], Titulo.fromJson),
      tabelas: _lista(j['tabelas'], TabelaPreco.fromJson),
      formas: _lista(j['formas'], FormaPagamento.fromJson),
      tabelaFormas: _lista(j['tabelaFormas'], (m) => (tabelaId: m['tabelaId'] as String, formaId: m['formaId'] as String)),
      categorias: _lista(j['categorias'], Categoria.fromJson),
      produtos: _lista(j['produtos'], Produto.fromJson),
      precos: _lista(j['precos'], Preco.fromJson),
      historico: _lista(j['historico'], PedidoHistorico.fromJson),
    );
  }
}
