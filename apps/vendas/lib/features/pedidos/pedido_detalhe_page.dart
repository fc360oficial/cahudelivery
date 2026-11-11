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
import 'painel_retido.dart';

const semInternetParaResolver = 'Conecte-se à internet para confirmar ou cancelar.';

/// Detalhe de um pedido: cliente, tabela, forma, itens, total, observação, linha do tempo e as
/// ações de cada situação (retido: confirmar/cancelar; recusado: editar e reenviar/descartar;
/// na fila: tentar agora/cancelar envio).
class PedidoDetalhePage extends StatefulWidget {
  const PedidoDetalhePage({super.key, required this.pedidoId});
  final String pedidoId;

  @override
  State<PedidoDetalhePage> createState() => _PedidoDetalhePageState();
}

class _Dados {
  const _Dados({required this.pedido, required this.cliente, this.tabela, this.forma, required this.itens});
  final PedidoLocal pedido;
  final String cliente;
  final TabelaPreco? tabela;
  final String? forma;
  final List<({String nome, String unidade, double quantidade, double precoUnit})> itens;
}

class _PedidoDetalhePageState extends State<PedidoDetalhePage> {
  AppServicos? _s;
  _Dados? _dados;
  bool _carregando = true;
  bool _ocupado = false;
  int _geracao = 0;
  String? _sucesso;
  List<Divergencia> _aindaBloqueando = const [];

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
    final minha = ++_geracao;
    final s = _s!;
    final p = await s.pedidosLocais.porId(widget.pedidoId);
    if (!mounted || minha != _geracao) return;
    if (p == null) {
      setState(() {
        _dados = null;
        _carregando = false;
      });
      return;
    }
    final cliente = await s.clientes.porId(p.clienteId);
    final tabela = p.tabelaId == null ? null : await s.tabelas.porId(p.tabelaId!);
    var itens = p.itens;
    if (itens.isEmpty && p.servidorId != null) {
      // Pedido de outro aparelho: os itens vêm do histórico baixado na sincronização.
      final h = await s.historico.porPedidoId(p.servidorId!);
      if (h != null) itens = [for (final i in h.itens) ItemEnvio(produtoId: i.produtoId, quantidade: i.quantidade, precoUnit: i.precoUnit)];
    }
    final produtos = await s.produtos.buscarPorIds(itens.map((i) => i.produtoId).toList());
    final nomes = {for (final x in produtos) x.produto.id: x.produto};
    String? forma;
    if (p.formaId != null) {
      for (final f in await s.tabelas.formas()) {
        if (f.id == p.formaId) forma = f.descricao;
      }
    }
    if (!mounted || minha != _geracao) return;
    setState(() {
      _carregando = false;
      _dados = _Dados(
        pedido: p,
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

  Future<bool> _confirmar({required String titulo, required String texto, required String sim, String nao = 'Voltar', bool perigo = false}) async {
    final r = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(titulo),
        content: Text(texto),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: Text(nao)),
          FilledButton(
            style: FilledButton.styleFrom(minimumSize: const Size(0, 48), backgroundColor: perigo ? Cores.erro : null),
            onPressed: () => Navigator.pop(ctx, true),
            child: Text(sim),
          ),
        ],
      ),
    );
    return r == true;
  }

  Future<void> _atualizar() async {
    await _s!.pedidos.reconciliar();
    await _carregar();
  }

  Future<void> _confirmarValores(PedidoLocal p) async {
    setState(() {
      _ocupado = true;
      _sucesso = null;
      _aindaBloqueando = const [];
    });
    try {
      final r = await _s!.pedidos.confirmar(p);
      if (!mounted) return;
      if (r.confirmado) {
        setState(() => _sucesso = 'Pedido confirmado com os valores atuais. Ele segue para o ERP.');
      } else if (r.jaResolvido) {
        _aviso(r.mensagem!);
      } else {
        setState(() => _aindaBloqueando = r.divergencias);
      }
    } on SemConexao {
      if (mounted) _aviso(semInternetParaResolver);
    } on ApiException catch (e) {
      if (mounted) _aviso(mensagemDeErro(e));
    } finally {
      if (mounted) setState(() => _ocupado = false);
    }
  }

  Future<void> _cancelarRetido(PedidoLocal p) async {
    final sim = await _confirmar(
        titulo: 'Cancelar este pedido?', texto: 'O pedido de ${_dados!.cliente} não vai para o ERP. Isso não pode ser desfeito.', sim: 'Cancelar pedido', perigo: true);
    if (!sim || !mounted) return;
    setState(() => _ocupado = true);
    try {
      final feito = await _s!.pedidos.cancelarRetido(p);
      if (mounted) _aviso(feito ? 'Pedido cancelado.' : 'Este pedido já foi resolvido. A lista foi atualizada.');
    } on SemConexao {
      if (mounted) _aviso(semInternetParaResolver);
    } on ApiException catch (e) {
      if (mounted) _aviso(mensagemDeErro(e));
    } finally {
      if (mounted) setState(() => _ocupado = false);
    }
  }

  Future<void> _tentarAgora() async {
    setState(() => _ocupado = true);
    await _s!.fila.enviarFila();
    await _s!.pedidos.reconciliar();
    await _carregar();
    if (!mounted) return;
    setState(() => _ocupado = false);
    final p = _dados?.pedido;
    if (p != null && p.estado == EstadoPedido.aguardandoEnvio) _aviso('Sem internet. O pedido continua na fila.');
  }

  Future<void> _cancelarEnvio(PedidoLocal p) async {
    final sim = await _confirmar(
        titulo: 'Cancelar o envio?', texto: 'O pedido sai da fila e não será enviado. Isso não pode ser desfeito.', sim: 'Cancelar envio', perigo: true);
    if (!sim || !mounted) return;
    final feito = await _s!.fila.cancelarEnvio(p.id);
    await _s!.pedidos.reconciliar();
    await _carregar();
    if (mounted) _aviso(feito ? 'Envio cancelado. O pedido não será enviado.' : 'Este pedido já foi enviado.');
  }

  Future<void> _editarEReenviar(PedidoLocal p) async {
    await abrirRascunho(
      context,
      clienteId: p.clienteId,
      tabelaId: p.tabelaId,
      formaId: p.formaId,
      itens: p.itens,
      observacoes: p.observacoes,
      orcamentoId: p.orcamentoId,
      avisoInicial: 'Pedido recusado${p.motivo == null ? '' : ': ${p.motivo!.replaceAll(RegExp(r'\.\s*$'), '')}'}. Ajuste e envie de novo.',
      // O pedido recusado vira rascunho: some da lista. Ao enviar de novo nasce um idDispositivo NOVO.
      aoMontar: () => _s!.pedidos.descartar(p.id),
    );
  }

  Future<void> _descartar(PedidoLocal p) async {
    final sim = await _confirmar(
        titulo: 'Descartar o pedido?', texto: 'O pedido recusado some da lista. Isso não pode ser desfeito.', sim: 'Descartar', perigo: true);
    if (!sim || !mounted) return;
    await _s!.pedidos.descartar(p.id);
    if (mounted) Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    final s = Servicos.of(context);
    return Scaffold(
      appBar: AppBar(title: const Text('Pedido')),
      body: ListenableBuilder(
        listenable: s.sincronizacao,
        builder: (context, _) {
          if (_carregando) return const Center(child: CircularProgressIndicator());
          final d = _dados;
          if (d == null) {
            return const EstadoVazio(icone: Icons.receipt_long_outlined, titulo: 'Pedido não encontrado', texto: 'Ele pode ter sido descartado.');
          }
          return RefreshIndicator(onRefresh: _atualizar, child: _corpo(d, s.sincronizacao.online));
        },
      ),
    );
  }

  Widget _corpo(_Dados d, bool online) {
    final p = d.pedido;
    final sit = situacaoDe(p);
    final retirada = d.tabela?.tipoEntrega == TipoEntrega.retirada;
    final total = sit == SituacaoPedido.retido ? p.total : p.totalServidor;
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
                    Expanded(
                      child: Text(d.cliente, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800, color: Cores.marinho)),
                    ),
                    const SizedBox(width: 8),
                    Flexible(child: PilulaPedido(sit)),
                  ],
                ),
                if (p.servidorNumero != null)
                  Text('Pedido nº ${p.servidorNumero}', style: const TextStyle(fontWeight: FontWeight.w700)),
                const Divider(height: 20),
                LinhaInfo('Data', dataHoraCurta(p.criadoEm.toLocal())),
                if (d.tabela != null) LinhaInfo('Tabela', d.tabela!.nome),
                if (d.tabela != null) LinhaInfo('Tipo', retirada ? 'Retirada pelo cliente' : 'Entrega'),
                if (d.forma != null) LinhaInfo('Pagamento', d.forma!),
                LinhaInfo('Total', moeda(total), destaque: true, corValor: Cores.marinho),
              ],
            ),
          ),
        ),
        if (_sucesso != null) ...[
          const SizedBox(height: 12),
          CaixaAviso(key: const Key('aviso-confirmado'), tom: TomAviso.info, icone: Icons.check_circle_outline_rounded, texto: '$_sucesso Novo total: ${moeda(p.totalServidor)}.'),
        ],
        if (_aindaBloqueando.isNotEmpty) ...[
          const SizedBox(height: 12),
          Container(
            key: const Key('ainda-bloqueado'),
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(color: const Color(0xFFFDECEC), borderRadius: BorderRadius.circular(14), border: Border.all(color: const Color(0xFFF0B5B5))),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('Ainda não dá para confirmar', style: TextStyle(color: Cores.erro, fontWeight: FontWeight.w800)),
                const SizedBox(height: 4),
                for (final x in _aindaBloqueando) Text('• ${x.descricao}', style: const TextStyle(color: Cores.erro)),
                const SizedBox(height: 4),
                const Text('O pedido continua retido.', style: TextStyle(color: Cores.erro)),
              ],
            ),
          ),
        ],
        if (sit == SituacaoPedido.retido) ...[
          const SizedBox(height: 12),
          PainelRetido(
            pedido: p,
            online: online,
            ocupado: _ocupado,
            aoConfirmar: () => _confirmarValores(p),
            aoCancelar: () => _cancelarRetido(p),
          ),
        ],
        if (sit == SituacaoPedido.recusado) ...[
          const SizedBox(height: 12),
          CaixaAviso(key: const Key('motivo-recusa'), tom: TomAviso.erro, titulo: 'Pedido recusado', texto: p.motivo ?? 'O servidor recusou o envio.'),
          const SizedBox(height: 12),
          FilledButton(key: const Key('editar-reenviar'), onPressed: () => _editarEReenviar(p), child: const Text('Editar e reenviar')),
          const SizedBox(height: 8),
          OutlinedButton(
            key: const Key('descartar-pedido'),
            onPressed: () => _descartar(p),
            style: OutlinedButton.styleFrom(foregroundColor: Cores.erro, minimumSize: const Size.fromHeight(48)),
            child: const Text('Descartar'),
          ),
        ],
        if (sit == SituacaoPedido.naFila) ...[
          const SizedBox(height: 12),
          const CaixaAviso(tom: TomAviso.info, icone: Icons.schedule_send_rounded, texto: 'Este pedido ainda não foi enviado. Ele sobe sozinho quando a internet voltar.'),
          const SizedBox(height: 12),
          FilledButton(
            key: const Key('tentar-enviar'),
            onPressed: _ocupado ? null : _tentarAgora,
            child: _ocupado
                ? const SizedBox(height: 22, width: 22, child: CircularProgressIndicator(strokeWidth: 2.5, color: Colors.white))
                : const Text('Tentar enviar agora'),
          ),
          const SizedBox(height: 8),
          OutlinedButton(
            key: const Key('cancelar-envio'),
            onPressed: _ocupado ? null : () => _cancelarEnvio(p),
            style: OutlinedButton.styleFrom(foregroundColor: Cores.erro, minimumSize: const Size.fromHeight(48)),
            child: const Text('Cancelar envio'),
          ),
        ],
        const SizedBox(height: 16),
        const TituloSecao('ITENS'),
        if (d.itens.isEmpty)
          const Text('Os itens deste pedido não estão neste aparelho.', style: TextStyle(color: Cores.textoSuave))
        else
          for (final i in d.itens) ...[_LinhaItem(i), const SizedBox(height: 8)],
        if ((p.observacoes ?? '').isNotEmpty) ...[
          const SizedBox(height: 8),
          const TituloSecao('OBSERVAÇÃO'),
          Text(p.observacoes!),
        ],
        const SizedBox(height: 16),
        const TituloSecao('LINHA DO TEMPO'),
        for (final e in _linhaDoTempo(p)) _Evento(e),
        const SizedBox(height: 16),
      ],
    );
  }
}

class _LinhaItem extends StatelessWidget {
  const _LinhaItem(this.i);
  final ({String nome, String unidade, double quantidade, double precoUnit}) i;

  @override
  Widget build(BuildContext context) {
    return Card(
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
    );
  }
}

class EventoTempo {
  const EventoTempo(this.icone, this.texto, this.quando);
  final IconData icone;
  final String texto;
  final DateTime? quando;
}

/// Estados pelos quais o pedido passou, do que o aparelho sabe.
List<EventoTempo> _linhaDoTempo(PedidoLocal p) {
  final ev = <EventoTempo>[];
  DateTime? data(String? iso) => iso == null ? null : DateTime.tryParse(iso);
  if (p.doServidor) {
    ev.add(EventoTempo(Icons.cloud_done_outlined, 'Recebido pelo servidor (feito em outro aparelho)', p.criadoEm));
  } else {
    ev.add(EventoTempo(Icons.edit_note_rounded, 'Pedido criado no aparelho', p.criadoEm));
  }
  final confirmadoEm = data(p.resposta?['confirmadoEm'] as String?);
  final canceladoEm = data(p.resposta?['canceladoEm'] as String?);
  final enviado = p.enviadoEm != null && !p.doServidor;
  switch (p.estado) {
    case EstadoPedido.aguardandoEnvio:
      ev.add(EventoTempo(Icons.schedule_send_rounded, p.tentativas > 0 ? 'Na fila: ${p.tentativas} tentativa(s) de envio sem internet' : 'Na fila de envio', p.atualizadoEm));
    case EstadoPedido.enviando:
      ev.add(EventoTempo(Icons.cloud_upload_outlined, 'Enviando', p.atualizadoEm));
    case EstadoPedido.recusado:
      ev.add(EventoTempo(Icons.cancel_outlined, 'Recusado pelo servidor', p.atualizadoEm));
    case EstadoPedido.cancelado:
      if (enviado) ev.add(EventoTempo(Icons.cloud_done_outlined, 'Recebido pelo servidor', p.enviadoEm));
      if (p.servidorId == null) {
        ev.add(EventoTempo(Icons.cancel_outlined, 'Envio cancelado por você', p.atualizadoEm));
      } else {
        ev.add(EventoTempo(Icons.cancel_outlined, 'Cancelado', canceladoEm ?? p.atualizadoEm));
      }
    case EstadoPedido.retido:
      ev.add(EventoTempo(Icons.pause_circle_outline_rounded, 'Retido pelo servidor: aguardando você', p.enviadoEm ?? p.atualizadoEm));
    default:
      if (confirmadoEm != null) {
        if (enviado) ev.add(EventoTempo(Icons.pause_circle_outline_rounded, 'Retido pelo servidor', p.enviadoEm));
        ev.add(EventoTempo(Icons.check_circle_outline_rounded, 'Confirmado com os valores atuais', confirmadoEm));
      } else if (enviado) {
        ev.add(EventoTempo(Icons.cloud_done_outlined, 'Enviado ao servidor', p.enviadoEm));
      }
      ev.add(EventoTempo(Icons.flag_outlined, 'Situação agora: ${situacaoDe(p).rotulo}', p.atualizadoEm));
  }
  return ev;
}

class _Evento extends StatelessWidget {
  const _Evento(this.e);
  final EventoTempo e;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(e.icone, size: 20, color: Cores.azul),
          const SizedBox(width: 10),
          Expanded(child: Text(e.texto)),
          if (e.quando != null) ...[
            const SizedBox(width: 8),
            Text(dataHoraCurta(e.quando!.toLocal()), style: const TextStyle(color: Cores.textoSuave, fontSize: 12)),
          ],
        ],
      ),
    );
  }
}
