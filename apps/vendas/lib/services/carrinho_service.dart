import 'dart:async';

import 'package:flutter/foundation.dart';

import '../core/dinheiro.dart';
import '../core/formatadores.dart';
import '../data/modelos.dart';
import '../data/pedido_local.dart';
import '../data/rascunho.dart';
import '../data/repositorios.dart';

/// Linha do carrinho: produto (com estoque e foto do espelho) + preço da TABELA + quantidade.
/// O preço nunca é digitado: vem do espelho local.
class ItemCarrinho {
  const ItemCarrinho({required this.produto, required this.precoUnit, required this.quantidade});
  final Produto produto;
  final double precoUnit, quantidade;

  double get total => totalLinha(precoUnit, quantidade);

  /// Pede mais do que o estoque do espelho. Permitido (o servidor decide), mas a linha avisa.
  bool get acimaDoEstoque => quantidade > produto.estoque;

  ItemCarrinho com({double? precoUnit, double? quantidade}) =>
      ItemCarrinho(produto: produto, precoUnit: precoUnit ?? this.precoUnit, quantidade: quantidade ?? this.quantidade);

  ItemEnvio paraEnvio() => ItemEnvio(produtoId: produto.id, quantidade: quantidade, precoUnit: precoUnit);
}

/// O que acontece se a tabela do pedido for trocada (mostrado no diálogo de confirmação).
class PrevisaoTrocaTabela {
  const PrevisaoTrocaTabela({
    required this.totalAtual,
    required this.totalNovo,
    required this.removidos,
    required this.mantidos,
    required this.formaPerdida,
  });
  final double totalAtual, totalNovo;

  /// Itens sem preço na tabela nova: saem do pedido se o vendedor confirmar.
  final List<ItemCarrinho> removidos;
  final List<ItemCarrinho> mantidos;

  /// A forma escolhida não é aceita pela tabela nova: será limpa e perguntada de novo.
  final bool formaPerdida;
}

/// Pedido em andamento (um rascunho por vez). Fica em memória e é gravado no banco
/// local a cada mudança, então matar o app não perde o pedido.
///
/// Fluxo: [iniciar] (cliente) -> [escolherTabela] -> [escolherForma] (automática quando
/// a tabela aceita uma só) -> [definirQuantidade] ... -> enviado pela `FilaEnvioService`,
/// que chama [limpar].
class CarrinhoService extends ChangeNotifier {
  CarrinhoService({
    required ProdutosRepository produtos,
    required TabelasRepository tabelas,
    required ClientesRepository clientes,
    required RascunhoRepository rascunhos,
    DateTime Function()? agora,
  })  : _produtos = produtos,
        _tabelas = tabelas,
        _clientes = clientes,
        _rascunhos = rascunhos,
        _agora = agora ?? DateTime.now;

  final ProdutosRepository _produtos;
  final TabelasRepository _tabelas;
  final ClientesRepository _clientes;
  final RascunhoRepository _rascunhos;
  final DateTime Function() _agora;

  Cliente? _cliente;
  TabelaComFormas? _tabela;
  FormaPagamento? _forma;
  List<ItemCarrinho> _itens = [];
  String _observacoes = '';
  String? _orcamentoId;
  String? _aviso;
  double? _totalAnterior;
  Future<void> _gravando = Future.value();

  Cliente? get cliente => _cliente;
  TabelaComFormas? get tabela => _tabela;
  FormaPagamento? get forma => _forma;
  List<ItemCarrinho> get itens => List.unmodifiable(_itens);
  String get observacoes => _observacoes;

  /// Orçamento de origem (quando o pedido nasce da conversão de um orçamento).
  String? get orcamentoId => _orcamentoId;

  /// Total do orçamento (ou pedido) de origem, quando o rascunho veio de um: a revisão avisa se mudou.
  double? get totalAnterior => _totalAnterior;

  /// Aviso de uma única exibição (ex.: itens que saíram do rascunho restaurado).
  String? get aviso => _aviso;
  void limparAviso() => _aviso = null;

  bool get temRascunho => _cliente != null;
  bool get vazio => _itens.isEmpty;

  /// Linhas do pedido (o contador da barra do catálogo).
  int get qtdItens => _itens.length;

  double get total => somarLinhas(_itens.map((i) => i.total));

  /// Entrega ou retirada: vem da tabela, o vendedor não escolhe.
  TipoEntrega? get tipoEntrega => _tabela?.tabela.tipoEntrega;

  /// Forma exige escolha do vendedor (a tabela aceita mais de uma).
  bool get precisaEscolherForma => (_tabela?.formas.length ?? 0) > 1;

  /// Forma veio sozinha porque a tabela aceita só uma.
  bool get formaAutomatica => (_tabela?.formas.length ?? 0) == 1;

  /// Tem tudo para abrir o catálogo: cliente, tabela e forma.
  bool get prontoParaCatalogo => _cliente != null && _tabela != null && _forma != null;

  /// Crédito do cliente que vale para este pedido: só quando a forma confere limite.
  double? get creditoDisponivel =>
      (_forma?.exigeCredito ?? false) ? _cliente?.creditoDisponivel : null;

  /// Aviso (não bloqueio): o total passa do crédito disponível. O servidor decide.
  bool get passaDoLimite => creditoDisponivel != null && total > creditoDisponivel!;

  int get itensAcimaDoEstoque => _itens.where((i) => i.acimaDoEstoque).length;

  double quantidadeDe(String produtoId) {
    for (final i in _itens) {
      if (i.produto.id == produtoId) return i.quantidade;
    }
    return 0;
  }

  // ---- montagem ----

  /// Começa um pedido novo para [cliente], descartando o rascunho anterior.
  void iniciar(Cliente cliente) {
    _cliente = cliente;
    _tabela = null;
    _forma = null;
    _itens = [];
    _observacoes = '';
    _orcamentoId = null;
    _aviso = null;
    _totalAnterior = null;
    _mudou();
  }

  /// Troca o cliente (volta atrás na 1ª etapa): zera o resto, o preço depende da tabela.
  void trocarCliente(Cliente cliente) {
    if (_cliente?.id == cliente.id) return;
    iniciar(cliente);
  }

  /// Quem vai mudar: totais antes/depois, itens sem preço e se a forma se perde.
  Future<PrevisaoTrocaTabela> previsaoTroca(TabelaComFormas nova) async {
    final precos = await _produtos.precosDaTabela(nova.tabela.id, produtoIds: _itens.map((i) => i.produto.id));
    final mantidos = <ItemCarrinho>[];
    final removidos = <ItemCarrinho>[];
    for (final i in _itens) {
      final p = precos[i.produto.id];
      if (p == null) {
        removidos.add(i);
      } else {
        mantidos.add(i.com(precoUnit: p));
      }
    }
    final formaPerdida = _forma != null && !nova.formas.any((f) => f.id == _forma!.id);
    return PrevisaoTrocaTabela(
      totalAtual: total,
      totalNovo: somarLinhas(mantidos.map((i) => i.total)),
      removidos: removidos,
      mantidos: mantidos,
      formaPerdida: formaPerdida,
    );
  }

  /// Aplica a tabela: recalcula todos os preços pelo espelho, tira os itens sem preço,
  /// limpa a forma que a tabela não aceita e escolhe a forma sozinha quando só há uma.
  /// A UI mostra [previsaoTroca] e pede confirmação ANTES de chamar com itens no carrinho.
  Future<void> escolherTabela(TabelaComFormas nova) async {
    final prev = await previsaoTroca(nova);
    _tabela = nova;
    _itens = prev.mantidos;
    _ajustarForma();
    _mudou();
  }

  void _ajustarForma() {
    final formas = _tabela?.formas ?? const <FormaPagamento>[];
    if (formas.length == 1) {
      _forma = formas.first;
    } else if (_forma != null && !formas.any((f) => f.id == _forma!.id)) {
      _forma = null;
    }
  }

  void escolherForma(FormaPagamento forma) {
    if (_tabela == null || !_tabela!.formas.any((f) => f.id == forma.id)) return;
    _forma = forma;
    _mudou();
  }

  /// Define a quantidade de um produto (<= 0 remove). O preço é o da tabela escolhida;
  /// produto sem preço nela não entra.
  void definirQuantidade(ProdutoComPreco p, double quantidade) {
    final i = _itens.indexWhere((x) => x.produto.id == p.produto.id);
    if (quantidade <= 0) {
      if (i >= 0) _itens.removeAt(i);
    } else if (i >= 0) {
      _itens[i] = _itens[i].com(quantidade: quantidade);
    } else if (p.preco != null) {
      _itens.add(ItemCarrinho(produto: p.produto, precoUnit: p.preco!, quantidade: quantidade));
    } else {
      return;
    }
    _mudou();
  }

  /// Muda a quantidade de uma linha já no carrinho (tela de revisão). <= 0 remove.
  void alterarQuantidade(String produtoId, double quantidade) {
    final i = _itens.indexWhere((x) => x.produto.id == produtoId);
    if (i < 0) return;
    if (quantidade <= 0) {
      _itens.removeAt(i);
    } else {
      _itens[i] = _itens[i].com(quantidade: quantidade);
    }
    _mudou();
  }

  void remover(String produtoId) => alterarQuantidade(produtoId, 0);

  void definirObservacoes(String texto) {
    _observacoes = texto.length > 500 ? texto.substring(0, 500) : texto;
    _mudou();
  }

  /// Monta o rascunho a partir de um orçamento ou pedido recusado: preços SEMPRE os atuais da tabela
  /// (pelo espelho), item sem preço ou fora do catálogo sai e vira aviso, e [totalAnterior] guarda o
  /// total de antes para a revisão avisar quando mudou. [orcamentoId] liga o rascunho ao orçamento:
  /// salvar de novo usa o MESMO id (PUT) e enviar como pedido converte esse orçamento.
  Future<void> carregar({
    required Cliente cliente,
    required TabelaComFormas tabela,
    String? formaId,
    required List<ItemEnvio> itens,
    String? observacoes,
    String? orcamentoId,
    double? totalAnterior,
    String? avisoInicial,
  }) async {
    final achados = await _produtos.buscarPorIds(itens.map((i) => i.produtoId).toList(), tabelaId: tabela.tabela.id);
    final porId = {for (final p in achados) p.produto.id: p};
    final novos = <ItemCarrinho>[];
    for (final i in itens) {
      final p = porId[i.produtoId];
      if (p != null && p.preco != null) novos.add(ItemCarrinho(produto: p.produto, precoUnit: p.preco!, quantidade: i.quantidade));
    }
    final partes = <String>[?avisoInicial];
    final fora = itens.length - novos.length;
    if (fora > 0) {
      partes.add(fora == 1
          ? '1 item saiu porque não tem mais preço nesta tabela.'
          : '$fora itens saíram porque não têm mais preço nesta tabela.');
    }
    final novoTotal = somarLinhas(novos.map((i) => i.total));
    if (totalAnterior != null && arredondar(totalAnterior) != arredondar(novoTotal)) {
      partes.add('O total mudou: era ${moeda(totalAnterior)} e agora é ${moeda(novoTotal)} (preços atuais da tabela).');
    }
    _cliente = cliente;
    _tabela = tabela;
    _forma = null;
    for (final f in tabela.formas) {
      if (f.id == formaId) _forma = f;
    }
    _itens = novos;
    _observacoes = (observacoes ?? '').length > 500 ? observacoes!.substring(0, 500) : (observacoes ?? '');
    _orcamentoId = orcamentoId;
    _totalAnterior = totalAnterior;
    _aviso = partes.isEmpty ? null : partes.join(' ');
    _ajustarForma();
    _mudou();
  }

  /// Orçamento de origem (usado pela conversão em pedido).
  void definirOrcamentoOrigem(String? id) {
    _orcamentoId = id;
    _mudou();
  }

  /// Descarta o rascunho (memória e banco).
  Future<void> limpar() async {
    _cliente = null;
    _tabela = null;
    _forma = null;
    _itens = [];
    _observacoes = '';
    _orcamentoId = null;
    _aviso = null;
    _totalAnterior = null;
    notifyListeners();
    final g = _gravando.then((_) => _rascunhos.apagar());
    _gravando = g.catchError((_) {});
    await g;
  }

  /// Só a memória (logout): o rascunho continua no banco para o mesmo vendedor.
  void soltarMemoria() {
    _cliente = null;
    _tabela = null;
    _forma = null;
    _itens = [];
    _observacoes = '';
    _orcamentoId = null;
    _aviso = null;
    _totalAnterior = null;
    notifyListeners();
  }

  // ---- persistência ----

  Rascunho _paraRascunho() => Rascunho(
        clienteId: _cliente!.id,
        tabelaId: _tabela?.tabela.id,
        formaId: _forma?.id,
        observacoes: _observacoes,
        orcamentoId: _orcamentoId,
        itens: [for (final i in _itens) (produtoId: i.produto.id, quantidade: i.quantidade)],
      );

  void _mudou() {
    notifyListeners();
    if (_cliente == null) return;
    final r = _paraRascunho();
    final agora = _agora();
    _gravando = _gravando.then((_) => _rascunhos.gravar(r, agora)).catchError((Object e) {
      debugPrint('rascunho: $e');
    });
  }

  /// Espera as gravações pendentes (testes e antes de sair do app).
  Future<void> aguardarGravacao() => _gravando;

  /// Relê o rascunho do banco (ao abrir o app logado). Preços, nomes e estoque vêm do
  /// espelho de agora; o que não tem mais preço na tabela sai do pedido e fica um [aviso].
  Future<void> restaurar() async {
    if (_cliente != null) return; // já há um em memória
    final r = await _rascunhos.ler();
    if (r == null) return;
    final cliente = await _clientes.porId(r.clienteId);
    if (cliente == null) {
      await _rascunhos.apagar();
      return;
    }
    TabelaComFormas? tabela = r.tabelaId == null ? null : await _tabelas.porId(r.tabelaId!);
    var itens = <ItemCarrinho>[];
    String? aviso;
    if (tabela != null && r.itens.isNotEmpty) {
      final achados = await _produtos.buscarPorIds(r.itens.map((i) => i.produtoId).toList(), tabelaId: tabela.tabela.id);
      final porId = {for (final p in achados) p.produto.id: p};
      for (final i in r.itens) {
        final p = porId[i.produtoId];
        if (p != null && p.preco != null) itens.add(ItemCarrinho(produto: p.produto, precoUnit: p.preco!, quantidade: i.quantidade));
      }
      final fora = r.itens.length - itens.length;
      if (fora > 0) {
        aviso = fora == 1
            ? '1 item saiu do pedido porque não tem mais preço nesta tabela.'
            : '$fora itens saíram do pedido porque não têm mais preço nesta tabela.';
      }
    } else if (r.itens.isNotEmpty) {
      aviso = 'A tabela deste pedido não existe mais. Escolha outra e monte os itens de novo.';
      itens = [];
    }
    _cliente = cliente;
    _tabela = tabela;
    _forma = null;
    if (tabela != null) {
      for (final f in tabela.formas) {
        if (f.id == r.formaId) _forma = f;
      }
    }
    _itens = itens;
    _observacoes = r.observacoes;
    _orcamentoId = r.orcamentoId;
    _aviso = aviso;
    _ajustarForma();
    notifyListeners();
  }
}
