import 'dart:async';

import 'package:flutter/material.dart';

import '../../app_servicos.dart';
import '../../core/tema.dart';
import '../../data/modelos.dart';
import '../../widgets/comuns.dart';
import '../clientes/clientes_page.dart';

/// Passo 1: escolher o cliente da carteira. Bloqueado ou sem cadastro no ERP não avança.
class EtapaCliente extends StatefulWidget {
  const EtapaCliente({super.key, required this.aoEscolher});
  final ValueChanged<Cliente> aoEscolher;

  @override
  State<EtapaCliente> createState() => _EtapaClienteState();
}

class _EtapaClienteState extends State<EtapaCliente> {
  final _busca = TextEditingController();
  Timer? _espera;
  List<Cliente>? _lista;
  String? _erro;
  int _geracao = 0;
  bool _iniciou = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (!_iniciou) {
      _iniciou = true;
      _carregar();
    }
  }

  @override
  void dispose() {
    _espera?.cancel();
    _busca.dispose();
    super.dispose();
  }

  Future<void> _carregar() async {
    final minha = ++_geracao;
    try {
      final r = await Servicos.of(context).clientes.buscar(termo: _busca.text);
      if (!mounted || minha != _geracao) return;
      setState(() {
        _lista = r;
        _erro = null;
      });
    } catch (_) {
      if (!mounted || minha != _geracao) return;
      setState(
        () => _erro = 'Não foi possível ler os clientes deste aparelho.',
      );
    }
  }

  void _tocou(Cliente c) {
    if (c.bloqueado || !c.temCadastroErp) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            c.bloqueado
                ? 'Cliente bloqueado: não é possível fazer pedido. Fale com o supervisor.'
                : 'Cliente sem cadastro no ERP: não é possível vender.',
          ),
        ),
      );
      return;
    }
    widget.aoEscolher(c);
  }

  @override
  Widget build(BuildContext context) {
    final s = Servicos.of(context);
    return Column(
      children: [
        const _Titulo('Escolha o cliente'),
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
          child: CampoBusca(
            chave: const Key('busca-cliente-pedido'),
            controlador: _busca,
            dica: 'Buscar cliente...',
            aoMudar: (_) {
              _espera?.cancel();
              _espera = Timer(const Duration(milliseconds: 250), _carregar);
            },
          ),
        ),
        Expanded(
          child: _erro != null
              ? EstadoErro(mensagem: _erro!, aoTentarDeNovo: _carregar)
              : _lista == null
              ? const Center(child: CircularProgressIndicator())
              : _lista!.isEmpty
              ? const EstadoVazio(
                  icone: Icons.search_off_rounded,
                  titulo: 'Nenhum cliente encontrado',
                  texto: 'Só aparecem os clientes da sua carteira.',
                )
              : ListView.separated(
                  padding: const EdgeInsets.fromLTRB(16, 4, 16, 16),
                  itemCount: _lista!.length,
                  separatorBuilder: (_, _) => const SizedBox(height: 10),
                  itemBuilder: (_, i) => LinhaCliente(
                    cliente: _lista![i],
                    agora: s.agora(),
                    avisoBloqueio: true,
                    aoTocar: () => _tocou(_lista![i]),
                  ),
                ),
        ),
      ],
    );
  }
}

/// Passo 2: tabela de preço. O nome diz o prazo; a etiqueta diz se é entrega ou retirada.
class EtapaTabela extends StatefulWidget {
  const EtapaTabela({super.key, required this.aoEscolher});
  final ValueChanged<TabelaComFormas> aoEscolher;

  @override
  State<EtapaTabela> createState() => _EtapaTabelaState();
}

class _EtapaTabelaState extends State<EtapaTabela> {
  Future<List<TabelaComFormas>>? _futuro;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _futuro ??= _carregar();
  }

  Future<List<TabelaComFormas>> _carregar() async {
    final todas = await Servicos.of(context).tabelas.listar();
    return todas
        .where((t) => t.formas.isNotEmpty)
        .toList(); // tabela sem forma não se oferece
  }

  @override
  Widget build(BuildContext context) {
    final cart = Servicos.of(context).carrinho;
    return FutureBuilder<List<TabelaComFormas>>(
      future: _futuro,
      builder: (context, snap) {
        if (snap.hasError) {
          return EstadoErro(
            mensagem: 'Não foi possível ler as tabelas de preço.',
            aoTentarDeNovo: () => setState(() => _futuro = _carregar()),
          );
        }
        if (!snap.hasData) {
          return const Center(child: CircularProgressIndicator());
        }
        final tabelas = snap.data!;
        if (tabelas.isEmpty) {
          return const EstadoVazio(
            icone: Icons.sell_outlined,
            titulo: 'Nenhuma tabela de preço disponível',
            texto: 'Sincronize o aplicativo para baixar as tabelas.',
          );
        }
        return ListView.separated(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
          itemCount: tabelas.length + 1,
          separatorBuilder: (_, _) => const SizedBox(height: 10),
          itemBuilder: (_, i) {
            if (i == 0) {
              return Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const _Titulo(
                    'Tabela de preço',
                    margem: EdgeInsets.fromLTRB(0, 16, 0, 2),
                  ),
                  if (cart.cliente != null)
                    Text(
                      'Pedido de ${cart.cliente!.nomeFantasia}',
                      style: const TextStyle(
                        color: Cores.textoSuave,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                ],
              );
            }
            final t = tabelas[i - 1];
            final escolhida = cart.tabela?.tabela.id == t.tabela.id;
            final retirada = t.tabela.tipoEntrega == TipoEntrega.retirada;
            return Card(
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(16),
                side: escolhida
                    ? const BorderSide(color: Cores.azul, width: 2)
                    : BorderSide.none,
              ),
              child: InkWell(
                borderRadius: BorderRadius.circular(16),
                onTap: () => widget.aoEscolher(t),
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(12, 12, 8, 12),
                  child: Row(
                    children: [
                      const IconeCaixa(Icons.sell_outlined),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              t.tabela.nome,
                              style: const TextStyle(
                                fontSize: 16,
                                fontWeight: FontWeight.w800,
                                color: Cores.marinho,
                              ),
                            ),
                            const SizedBox(height: 6),
                            Wrap(
                              spacing: 6,
                              runSpacing: 4,
                              children: [
                                Etiqueta(
                                  retirada ? 'Retirada' : 'Entrega',
                                  cor: retirada ? Cores.marinho : Cores.azul,
                                  icone: retirada
                                      ? Icons.storefront_rounded
                                      : Icons.local_shipping_outlined,
                                ),
                              ],
                            ),
                            const SizedBox(height: 6),
                            Text(
                              'Pagamento: ${t.formas.map((f) => f.descricao).join(', ')}',
                              style: const TextStyle(
                                color: Cores.textoSuave,
                                fontSize: 13.5,
                              ),
                            ),
                          ],
                        ),
                      ),
                      escolhida
                          ? const Icon(
                              Icons.check_circle_rounded,
                              color: Cores.azul,
                            )
                          : const Icon(
                              Icons.chevron_right_rounded,
                              color: Cores.textoSuave,
                            ),
                    ],
                  ),
                ),
              ),
            );
          },
        );
      },
    );
  }
}

/// Passo 3 (só quando a tabela aceita mais de uma forma).
class EtapaForma extends StatelessWidget {
  const EtapaForma({super.key, required this.aoEscolher});
  final ValueChanged<FormaPagamento> aoEscolher;

  @override
  Widget build(BuildContext context) {
    final cart = Servicos.of(context).carrinho;
    final tabela = cart.tabela;
    if (tabela == null) {
      return const EstadoVazio(
        icone: Icons.sell_outlined,
        titulo: 'Escolha a tabela antes',
        texto: 'A forma de pagamento depende da tabela.',
      );
    }
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
      children: [
        const _Titulo(
          'Forma de pagamento',
          margem: EdgeInsets.fromLTRB(0, 16, 0, 2),
        ),
        Text(
          'Tabela: ${tabela.tabela.nome}',
          style: const TextStyle(
            color: Cores.textoSuave,
            fontWeight: FontWeight.w600,
          ),
        ),
        const SizedBox(height: 12),
        for (final f in tabela.formas) ...[
          Card(
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(16),
              side: cart.forma?.id == f.id
                  ? const BorderSide(color: Cores.azul, width: 2)
                  : BorderSide.none,
            ),
            child: InkWell(
              borderRadius: BorderRadius.circular(16),
              onTap: () => aoEscolher(f),
              child: Padding(
                padding: const EdgeInsets.fromLTRB(12, 12, 8, 12),
                child: Row(
                  children: [
                    const IconeCaixa(Icons.payments_outlined),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            f.descricao,
                            style: const TextStyle(
                              fontWeight: FontWeight.w800,
                              color: Cores.marinho,
                              fontSize: 16,
                            ),
                          ),
                          if (f.exigeCredito)
                            const Text(
                              'Confere o limite de crédito do cliente',
                              style: TextStyle(
                                color: Cores.textoSuave,
                                fontSize: 13.5,
                              ),
                            ),
                        ],
                      ),
                    ),
                    cart.forma?.id == f.id
                        ? const Icon(
                            Icons.check_circle_rounded,
                            color: Cores.azul,
                          )
                        : const Icon(
                            Icons.chevron_right_rounded,
                            color: Cores.textoSuave,
                          ),
                  ],
                ),
              ),
            ),
          ),
          const SizedBox(height: 10),
        ],
      ],
    );
  }
}

/// Título do passo ("Escolha o cliente", "Tabela de preço"...).
class _Titulo extends StatelessWidget {
  const _Titulo(
    this.texto, {
    this.margem = const EdgeInsets.fromLTRB(16, 16, 16, 8),
  });
  final String texto;
  final EdgeInsets margem;

  @override
  Widget build(BuildContext context) => Padding(
    padding: margem,
    child: Align(
      alignment: Alignment.centerLeft,
      child: Text(
        texto,
        style: const TextStyle(
          fontSize: 20,
          fontWeight: FontWeight.w800,
          color: Cores.marinho,
        ),
      ),
    ),
  );
}
