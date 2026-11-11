import 'package:flutter/material.dart';

import '../../app_servicos.dart';
import '../../core/api_exception.dart';
import '../../core/dinheiro.dart';
import '../../core/formatadores.dart';
import '../../core/mensagens.dart';
import '../../core/tema.dart';
import '../../data/modelos.dart';
import '../../data/pedido_local.dart';
import '../../data/situacao_pedido.dart';
import '../../widgets/comuns.dart';
import '../../widgets/pilulas.dart';
import '../pedido/iniciar_pedido.dart';
import '../pedido/novo_pedido_page.dart';
import '../pedidos/pedido_detalhe_page.dart';

/// Detalhe de um orçamento: itens e totais, e as ações de um orçamento aberto
/// (Editar, Transformar em pedido, Cancelar orçamento). Orçamento convertido leva ao pedido.
class OrcamentoDetalhePage extends StatefulWidget {
  const OrcamentoDetalhePage({super.key, required this.orcamentoId});
  final String orcamentoId;

  @override
  State<OrcamentoDetalhePage> createState() => _OrcamentoDetalhePageState();
}

class _Dados {
  const _Dados({required this.orcamento, required this.cliente, this.tabela, this.forma, required this.itens});
  final OrcamentoLocal orcamento;
  final String cliente;
  final TabelaPreco? tabela;
  final String? forma;
  final List<({String nome, String unidade, double quantidade, double precoUnit})> itens;
}

class _OrcamentoDetalhePageState extends State<OrcamentoDetalhePage> {
  AppServicos? _s;
  _Dados? _dados;
  bool _carregando = true;
  String? _erro;
  bool _ocupado = false;
  int _geracao = 0;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final s = Servicos.of(context);
    if (!identical(s, _s)) {
      _s?.pedidos.removeListener(_carregar);
      _s?.fila.removeListener(_carregar);
      _s = s;
      s.pedidos.addListener(_carregar);
      s.fila.addListener(_carregar);
      _carregar();
    }
  }

  @override
  void dispose() {
    _s?.pedidos.removeListener(_carregar);
    _s?.fila.removeListener(_carregar);
    super.dispose();
  }

  Future<void> _carregar() async {
    try {
      await _ler();
    } catch (_) {
      if (mounted) {
        setState(() {
          _carregando = false;
          _erro = 'Não foi possível ler este orçamento neste aparelho.';
        });
      }
    }
  }

  Future<void> _ler() async {
    final minha = ++_geracao;
    final s = _s!;
    final o = await s.orcamentosLocais.porId(widget.orcamentoId);
    if (!mounted || minha != _geracao) return;
    if (o == null) {
      setState(() {
        _dados = null;
        _carregando = false;
      });
      return;
    }
    final cliente = await s.clientes.porId(o.clienteId);
    final tabela = o.tabelaId == null ? null : await s.tabelas.porId(o.tabelaId!);
    final itens = o.itens;
    final produtos = await s.produtos.buscarPorIds(itens.map((i) => i.produtoId).toList());
    final nomes = {for (final x in produtos) x.produto.id: x.produto};
    String? forma;
    if (o.formaId != null) {
      for (final f in await s.tabelas.formas()) {
        if (f.id == o.formaId) forma = f.descricao;
      }
    }
    if (!mounted || minha != _geracao) return;
    setState(() {
      _carregando = false;
      _erro = null;
      _dados = _Dados(
        orcamento: o,
        cliente: cliente?.nomeFantasia ?? 'Cliente fora da carteira',
        tabela: tabela?.tabela,
        forma: forma,
        itens: [
          for (final i in itens)
            (
              nome: nomes[i.produtoId]?.nome ?? 'Produto não encontrado neste aparelho',
              unidade: nomes[i.produtoId]?.unidade ?? '',
              quantidade: i.quantidade,
              precoUnit: i.precoUnit,
            ),
        ],
      );
    });
  }

  void _aviso(String texto) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(texto)));

  Future<void> _atualizar() async {
    await _s!.pedidos.reconciliar();
    await _carregar();
  }

  Future<void> _abrirComRascunho(OrcamentoLocal o, {required bool converter}) => abrirRascunho(
        context,
        clienteId: o.clienteId,
        tabelaId: o.tabelaId,
        formaId: o.formaId,
        itens: o.itens,
        observacoes: o.observacoes,
        orcamentoId: o.id, // salvar de novo = mesmo id (PUT); enviar como pedido = converte este orçamento
        totalAnterior: o.total,
        etapa: converter ? EtapaPedido.revisao : EtapaPedido.catalogo,
      );

  Future<void> _cancelar(OrcamentoLocal o) async {
    final sim = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Cancelar este orçamento?'),
        content: const Text('O orçamento deixa de valer e não pode ser reaberto.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Voltar')),
          FilledButton(
            style: FilledButton.styleFrom(minimumSize: const Size(0, 48), backgroundColor: Cores.erro),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Cancelar orçamento'),
          ),
        ],
      ),
    );
    if (sim != true || !mounted) return;
    setState(() => _ocupado = true);
    try {
      final feito = await _s!.pedidos.cancelarOrcamento(o);
      if (mounted) _aviso(feito ? 'Orçamento cancelado.' : 'Este orçamento já estava fechado. A lista foi atualizada.');
    } on SemConexao {
      if (mounted) _aviso('Conecte-se à internet para cancelar o orçamento.');
    } on ApiException catch (e) {
      if (mounted) _aviso(mensagemDeErro(e));
    } finally {
      if (mounted) setState(() => _ocupado = false);
    }
  }

  Future<void> _tentarAgora() async {
    setState(() => _ocupado = true);
    await _s!.fila.enviarFila();
    await _carregar();
    if (!mounted) return;
    setState(() => _ocupado = false);
    if (_dados?.orcamento.estado == EstadoOrcamento.local) _aviso('Sem internet. O orçamento continua na fila.');
  }

  Future<void> _descartar(OrcamentoLocal o) async {
    await _s!.pedidos.descartarOrcamento(o.id);
    if (mounted) Navigator.of(context).pop();
  }

  Future<void> _verPedido(OrcamentoLocal o) async {
    final sid = o.pedidoId;
    if (sid == null) return;
    var p = await _s!.pedidosLocais.porServidorId(sid);
    if (p == null) {
      await _s!.pedidos.reconciliar();
      p = await _s!.pedidosLocais.porServidorId(sid);
    }
    if (!mounted) return;
    if (p == null) {
      _aviso('Não achei o pedido deste orçamento neste aparelho. Puxe a lista de Pedidos para atualizar.');
      return;
    }
    final id = p.id;
    await Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => PedidoDetalhePage(pedidoId: id)));
  }

  @override
  Widget build(BuildContext context) {
    final s = Servicos.of(context);
    return Scaffold(
      appBar: AppBar(title: const Text('Orçamento')),
      body: ListenableBuilder(
        listenable: s.sincronizacao,
        builder: (context, _) {
          if (_carregando) return const Center(child: CircularProgressIndicator());
          if (_erro != null) return EstadoErro(mensagem: _erro!, aoTentarDeNovo: _carregar);
          final d = _dados;
          if (d == null) {
            return const EstadoVazio(icone: Icons.request_quote_outlined, titulo: 'Orçamento não encontrado', texto: 'Ele pode ter sido descartado.');
          }
          return RefreshIndicator(onRefresh: _atualizar, child: _corpo(d, s.sincronizacao.online));
        },
      ),
    );
  }

  Widget _corpo(_Dados d, bool online) {
    final o = d.orcamento;
    final sit = situacaoOrcamentoDe(o);
    final retirada = d.tabela?.tipoEntrega == TipoEntrega.retirada;
    final editavel = sit == SituacaoOrcamento.aberto || sit == SituacaoOrcamento.aguardandoEnvio || sit == SituacaoOrcamento.recusado;
    final podeConverter = sit == SituacaoOrcamento.aberto || sit == SituacaoOrcamento.aguardandoEnvio;
    return ListView(
      key: const Key('detalhe-lista'),
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.all(16),
      children: [
        Card(
          margin: EdgeInsets.zero,
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(child: Text(d.cliente, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800, color: Cores.marinho))),
                    const SizedBox(width: 8),
                    Flexible(child: PilulaOrcamento(sit)),
                  ],
                ),
                const Divider(height: 20),
                LinhaInfo('Atualizado em', dataHoraCurta(o.atualizadoEm.toLocal())),
                if (d.tabela != null) LinhaInfo('Tabela', d.tabela!.nome),
                if (d.tabela != null) LinhaInfo('Tipo', retirada ? 'Retirada pelo cliente' : 'Entrega'),
                if (d.forma != null) LinhaInfo('Pagamento', d.forma!),
                LinhaInfo('Total', moeda(o.total), destaque: true, corValor: Cores.marinho),
              ],
            ),
          ),
        ),
        if (sit == SituacaoOrcamento.recusado) ...[
          const SizedBox(height: 12),
          CaixaAviso(key: const Key('motivo-recusa'), tom: TomAviso.erro, titulo: 'Orçamento não enviado', texto: o.motivo ?? 'O servidor recusou o envio.'),
        ],
        if (sit == SituacaoOrcamento.aguardandoEnvio) ...[
          const SizedBox(height: 12),
          const CaixaAviso(tom: TomAviso.info, icone: Icons.schedule_send_rounded, texto: 'Este orçamento ainda não subiu. Ele é enviado quando a internet voltar.'),
          const SizedBox(height: 8),
          OutlinedButton(
            key: const Key('tentar-enviar'),
            onPressed: _ocupado ? null : _tentarAgora,
            child: const Text('Tentar enviar agora'),
          ),
        ],
        if (sit == SituacaoOrcamento.convertido) ...[
          const SizedBox(height: 12),
          const CaixaAviso(tom: TomAviso.info, icone: Icons.check_circle_outline_rounded, texto: 'Este orçamento virou pedido.'),
          const SizedBox(height: 8),
          if (o.pedidoId != null)
            FilledButton(key: const Key('ver-pedido'), onPressed: () => _verPedido(o), child: const Text('Ver o pedido')),
        ],
        if (editavel) ...[
          const SizedBox(height: 12),
          if (podeConverter)
            FilledButton(
              key: const Key('transformar-pedido'),
              onPressed: _ocupado ? null : () => _abrirComRascunho(o, converter: true),
              child: const Text('Transformar em pedido'),
            ),
          if (podeConverter) const SizedBox(height: 8),
          OutlinedButton(
            key: const Key('editar-orcamento'),
            onPressed: _ocupado ? null : () => _abrirComRascunho(o, converter: false),
            style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(48)),
            child: const Text('Editar'),
          ),
        ],
        if (sit == SituacaoOrcamento.aberto) ...[
          const SizedBox(height: 8),
          if (!online)
            const Padding(
              padding: EdgeInsets.only(bottom: 8),
              child: CaixaAviso(
                key: Key('aviso-offline'),
                tom: TomAviso.info,
                icone: Icons.wifi_off_rounded,
                texto: 'Conecte-se à internet para cancelar o orçamento.',
              ),
            ),
          OutlinedButton(
            key: const Key('cancelar-orcamento'),
            onPressed: _ocupado || !online ? null : () => _cancelar(o),
            style: OutlinedButton.styleFrom(foregroundColor: Cores.erro, minimumSize: const Size.fromHeight(48)),
            child: _ocupado ? const SizedBox(height: 22, width: 22, child: CircularProgressIndicator(strokeWidth: 2.5)) : const Text('Cancelar orçamento'),
          ),
        ],
        if (sit == SituacaoOrcamento.recusado) ...[
          const SizedBox(height: 8),
          OutlinedButton(
            key: const Key('descartar-orcamento'),
            onPressed: () => _descartar(o),
            style: OutlinedButton.styleFrom(foregroundColor: Cores.erro, minimumSize: const Size.fromHeight(48)),
            child: const Text('Descartar'),
          ),
        ],
        const SizedBox(height: 16),
        const TituloSecao('ITENS'),
        if (d.itens.isEmpty)
          const Text('Este orçamento não tem itens.', style: TextStyle(color: Cores.textoSuave))
        else
          for (final i in d.itens) ...[
            Card(
              margin: EdgeInsets.zero,
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(i.nome, maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w700)),
                          Text('${quantidade(i.quantidade)} ${i.unidade} × ${moeda(i.precoUnit)}'.trim(),
                              style: const TextStyle(color: Cores.textoSuave, fontSize: 13)),
                        ],
                      ),
                    ),
                    const SizedBox(width: 8),
                    Text(moeda(totalLinha(i.precoUnit, i.quantidade)), style: const TextStyle(fontWeight: FontWeight.w800, color: Cores.marinho)),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 8),
          ],
        if ((o.observacoes ?? '').isNotEmpty) ...[
          const SizedBox(height: 8),
          const TituloSecao('OBSERVAÇÃO'),
          Text(o.observacoes!),
        ],
        const SizedBox(height: 16),
      ],
    );
  }
}
