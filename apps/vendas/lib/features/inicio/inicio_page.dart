import 'package:flutter/material.dart';

import '../../app_servicos.dart';
import '../../core/formatadores.dart';
import '../../core/tema.dart';
import '../../data/modelos.dart';
import '../../services/carrinho_service.dart';
import '../../services/sincronizacao_service.dart';
import '../../widgets/em_construcao.dart';
import '../../widgets/comuns.dart';
import '../pedido/iniciar_pedido.dart';
import '../shell/home_shell.dart';

/// Tela Início: saudação, vendas do dia/mês (resumo em cache), atalhos grandes,
/// estado da conexão e da sincronização.
class InicioPage extends StatefulWidget {
  const InicioPage({super.key});

  @override
  State<InicioPage> createState() => _InicioPageState();
}

class _InicioPageState extends State<InicioPage> {
  ResumoVendedor? _resumo;
  AppServicos? _s;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final s = Servicos.of(context);
    if (!identical(s, _s)) {
      _s?.sincronizacao.cargaVersao.removeListener(_carregar);
      _s = s;
      s.sincronizacao.cargaVersao.addListener(_carregar);
      _carregar();
    }
  }

  @override
  void dispose() {
    _s?.sincronizacao.cargaVersao.removeListener(_carregar);
    super.dispose();
  }

  Future<void> _carregar() async {
    final r = await _s!.meta.resumo();
    await _s!.fila.atualizarContadores();
    if (mounted) setState(() => _resumo = r);
  }

  Future<void> _sincronizar() async {
    final r = await _s!.sincronizacao.sincronizar();
    if (!mounted || r.ok) return;
    if (r.situacao == SituacaoSync.sessaoExpirada) return; // a raiz já volta ao login
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      content: Text(r.situacao == SituacaoSync.semConexao
          ? 'Sem internet. Mostrando os dados salvos no aparelho.'
          : (r.mensagem ?? 'Não foi possível sincronizar.')),
    ));
  }

  Future<void> _descartar(CarrinhoService cart) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Descartar o pedido?'),
        content: Text('O pedido de ${cart.cliente?.nomeFantasia ?? ''} em andamento será apagado.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancelar')),
          FilledButton(
              style: FilledButton.styleFrom(minimumSize: const Size(0, 48)),
              onPressed: () => Navigator.pop(ctx, true),
              child: const Text('Descartar')),
        ],
      ),
    );
    if (ok == true) await cart.limpar();
  }

  void _abrir(String titulo) =>
      Navigator.of(context).push(MaterialPageRoute(builder: (_) => EmConstrucaoPage(titulo: titulo)));

  @override
  Widget build(BuildContext context) {
    final s = Servicos.of(context);
    return ListenableBuilder(
      listenable: Listenable.merge([s.sincronizacao, s.sessao, s.fila, s.carrinho]),
      builder: (context, _) {
        final sync = s.sincronizacao;
        final nome = primeiroNome(s.sessao.vendedor?.nome ?? '');
        final r = _resumo;
        final fila = s.fila;
        final cart = s.carrinho;
        // Retidos: o que está nas tabelas locais; o resumo do servidor também conta os de outros aparelhos.
        final retidos = fila.retidos > (r?.pedidosRetidos ?? 0) ? fila.retidos : (r?.pedidosRetidos ?? 0);
        return RefreshIndicator(
          onRefresh: _sincronizar,
          child: ListView(
            physics: const AlwaysScrollableScrollPhysics(),
            padding: const EdgeInsets.all(16),
            children: [
              Text('Olá, $nome!', style: Theme.of(context).textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w800)),
              if ((s.sessao.distribuidora ?? '').isNotEmpty)
                Text(s.sessao.distribuidora!, style: const TextStyle(color: Cores.textoSuave)),
              const SizedBox(height: 8),
              _LinhaConexao(sync: sync, agora: s.agora),
              if (sync.dadosAntigos) ...[
                const SizedBox(height: 12),
                const _AvisoDadosAntigos(),
              ],
              if (fila.naFila > 0) ...[
                const SizedBox(height: 12),
                _IndicadorFila(qtd: fila.naFila),
              ],
              if (cart.temRascunho) ...[
                const SizedBox(height: 12),
                _CartaoRascunho(
                  cliente: cart.cliente!.nomeFantasia,
                  itens: cart.qtdItens,
                  total: cart.total,
                  aoContinuar: () => continuarPedido(context),
                  aoDescartar: () => _descartar(cart),
                ),
              ],
              const SizedBox(height: 16),
              Row(
                children: [
                  Expanded(
                    child: _CartaoValor(
                      chave: const Key('vendido-hoje'),
                      titulo: 'Vendido hoje',
                      valor: r == null ? '—' : moeda(r.vendidoHoje),
                      detalhe: r == null ? 'sem dados ainda' : '${r.pedidosHoje} ${r.pedidosHoje == 1 ? 'pedido' : 'pedidos'}',
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: _CartaoValor(
                      chave: const Key('vendido-mes'),
                      titulo: 'Vendido no mês',
                      valor: r == null ? '—' : moeda(r.vendidoMes),
                      detalhe: r == null ? 'sem dados ainda' : '${r.clientesPositivadosMes} de ${r.clientesCarteira} clientes',
                    ),
                  ),
                ],
              ),
              if (retidos > 0) ...[
                const SizedBox(height: 12),
                _CartaoRetidos(qtd: retidos, aoTocar: () => HomeShell.of(context).irPara(AbaVendas.pedidos)),
              ],
              if (fila.recusados > 0) ...[
                const SizedBox(height: 12),
                CaixaAviso(
                  key: const Key('aviso-recusados'),
                  tom: TomAviso.erro,
                  texto: fila.recusados == 1
                      ? '1 pedido foi recusado pelo servidor e não foi enviado. Veja em Pedidos.'
                      : '${fila.recusados} pedidos foram recusados pelo servidor e não foram enviados. Veja em Pedidos.',
                ),
              ],
              const SizedBox(height: 16),
              GridView.count(
                crossAxisCount: 2,
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                mainAxisSpacing: 12,
                crossAxisSpacing: 12,
                childAspectRatio: 1.35,
                children: [
                  _BotaoGrande(icone: Icons.add_shopping_cart_rounded, rotulo: 'Novo pedido', destaque: true, aoTocar: () => iniciarNovoPedido(context)),
                  _BotaoGrande(icone: Icons.storefront_rounded, rotulo: 'Clientes', aoTocar: () => HomeShell.of(context).irPara(AbaVendas.clientes)),
                  _BotaoGrande(
                    icone: Icons.request_quote_outlined,
                    rotulo: 'Orçamentos',
                    selo: (r?.orcamentosAbertos ?? 0) > 0 ? '${r!.orcamentosAbertos}' : null,
                    aoTocar: () => _abrir('Orçamentos'),
                  ),
                  _BotaoGrande(icone: Icons.inventory_2_outlined, rotulo: 'Catálogo', aoTocar: () => _abrir('Catálogo')),
                ],
              ),
              const SizedBox(height: 16),
              OutlinedButton.icon(
                key: const Key('sincronizar-agora'),
                onPressed: sync.sincronizando ? null : _sincronizar,
                icon: sync.sincronizando
                    ? const SizedBox(height: 18, width: 18, child: CircularProgressIndicator(strokeWidth: 2.5))
                    : const Icon(Icons.sync_rounded),
                label: Text(sync.sincronizando ? 'Sincronizando...' : 'Sincronizar agora'),
              ),
              if (sync.ultimoErro != null && !sync.sincronizando)
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: Text(sync.ultimoErro!, textAlign: TextAlign.center, style: const TextStyle(color: Cores.erro, fontSize: 13)),
                ),
              const SizedBox(height: 8),
            ],
          ),
        );
      },
    );
  }
}

class _IndicadorFila extends StatelessWidget {
  const _IndicadorFila({required this.qtd});
  final int qtd;

  @override
  Widget build(BuildContext context) {
    return Container(
      key: const Key('indicador-fila'),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        color: const Color(0xFFEAF1FF),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0xFFBFD3FA)),
      ),
      child: Row(
        children: [
          const Icon(Icons.schedule_send_rounded, color: Cores.azul),
          const SizedBox(width: 10),
          Expanded(
            child: Text('Na fila: $qtd', style: const TextStyle(fontWeight: FontWeight.w800, color: Cores.marinho)),
          ),
          const Flexible(child: Text('sobe quando a internet voltar', textAlign: TextAlign.right, style: TextStyle(color: Cores.textoSuave, fontSize: 12))),
        ],
      ),
    );
  }
}

class _CartaoRascunho extends StatelessWidget {
  const _CartaoRascunho({required this.cliente, required this.itens, required this.total, required this.aoContinuar, required this.aoDescartar});
  final String cliente;
  final int itens;
  final double total;
  final VoidCallback aoContinuar, aoDescartar;

  @override
  Widget build(BuildContext context) {
    return Card(
      key: const Key('cartao-rascunho'),
      color: const Color(0xFFFFF4D6),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(14, 12, 6, 6),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Continuar pedido de $cliente',
                maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w800, color: Cores.marinho, fontSize: 15)),
            const SizedBox(height: 2),
            Text(itens == 0 ? 'Sem itens ainda' : '$itens ${itens == 1 ? 'item' : 'itens'} · ${moeda(total)}',
                style: const TextStyle(color: Cores.textoSuave)),
            Row(
              children: [
                Expanded(
                  child: TextButton(
                      onPressed: aoDescartar,
                      style: TextButton.styleFrom(minimumSize: const Size(48, 48), foregroundColor: Cores.erro),
                      child: const Text('Descartar')),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: FilledButton(
                      key: const Key('continuar-pedido'),
                      onPressed: aoContinuar,
                      style: FilledButton.styleFrom(minimumSize: const Size(0, 48)),
                      child: const Text('Continuar')),
                ),
                const SizedBox(width: 8),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _LinhaConexao extends StatelessWidget {
  const _LinhaConexao({required this.sync, required this.agora});
  final SincronizacaoService sync;
  final DateTime Function() agora;

  @override
  Widget build(BuildContext context) {
    final texto = linhaConexao(online: sync.online, ultima: sync.ultimaSincronizacao, agora: agora());
    return Row(
      children: [
        Icon(Icons.circle, size: 10, color: sync.online ? Cores.ok : Cores.textoSuave),
        const SizedBox(width: 8),
        Expanded(child: Text(texto, key: const Key('linha-conexao'), style: const TextStyle(color: Cores.textoSuave, fontSize: 13))),
      ],
    );
  }
}

class _AvisoDadosAntigos extends StatelessWidget {
  const _AvisoDadosAntigos();

  @override
  Widget build(BuildContext context) {
    return Container(
      key: const Key('aviso-dados-antigos'),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Cores.amarelo.withValues(alpha: 0.18),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Cores.amarelo),
      ),
      child: const Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(Icons.warning_amber_rounded, color: Cores.marinho),
          SizedBox(width: 10),
          Expanded(
            child: Text(
              'Os dados têm mais de 12 horas. Preço e estoque podem estar desatualizados. Sincronize assim que tiver internet.',
              style: TextStyle(color: Cores.marinho, fontWeight: FontWeight.w600),
            ),
          ),
        ],
      ),
    );
  }
}

class _CartaoValor extends StatelessWidget {
  const _CartaoValor({this.chave, required this.titulo, required this.valor, required this.detalhe});
  final Key? chave;
  final String titulo, valor, detalhe;

  @override
  Widget build(BuildContext context) {
    return Card(
      key: chave,
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(titulo, style: const TextStyle(color: Cores.textoSuave, fontSize: 13)),
            const SizedBox(height: 4),
            FittedBox(
              fit: BoxFit.scaleDown,
              child: Text(valor, style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800, color: Cores.marinho)),
            ),
            const SizedBox(height: 2),
            Text(detalhe, style: const TextStyle(color: Cores.textoSuave, fontSize: 12)),
          ],
        ),
      ),
    );
  }
}

class _CartaoRetidos extends StatelessWidget {
  const _CartaoRetidos({required this.qtd, required this.aoTocar});
  final int qtd;
  final VoidCallback aoTocar;

  @override
  Widget build(BuildContext context) {
    return Card(
      key: const Key('cartao-retidos'),
      color: const Color(0xFFFFF4D6),
      child: ListTile(
        onTap: aoTocar,
        leading: const Icon(Icons.pause_circle_outline_rounded, color: Cores.marinho),
        title: Text(
          qtd == 1 ? '1 pedido retido aguardando você' : '$qtd pedidos retidos aguardando você',
          style: const TextStyle(fontWeight: FontWeight.w700, color: Cores.marinho),
        ),
        subtitle: const Text('Preço, estoque ou crédito mudaram. Confirme ou cancele.'),
        trailing: const Icon(Icons.chevron_right_rounded),
      ),
    );
  }
}

class _BotaoGrande extends StatelessWidget {
  const _BotaoGrande({required this.icone, required this.rotulo, required this.aoTocar, this.destaque = false, this.selo});
  final IconData icone;
  final String rotulo;
  final VoidCallback aoTocar;
  final bool destaque;
  final String? selo;

  @override
  Widget build(BuildContext context) {
    final fundo = destaque ? Cores.azul : Colors.white;
    final frente = destaque ? Colors.white : Cores.marinho;
    return Material(
      color: fundo,
      borderRadius: BorderRadius.circular(18),
      child: InkWell(
        borderRadius: BorderRadius.circular(18),
        onTap: aoTocar,
        child: Container(
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(18),
            border: destaque ? null : Border.all(color: Cores.linha),
          ),
          padding: const EdgeInsets.all(14),
          child: Stack(
            children: [
              Column(
                mainAxisAlignment: MainAxisAlignment.center,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Icon(icone, size: 34, color: destaque ? Cores.amarelo : Cores.azul),
                  const Spacer(),
                  Text(rotulo, style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800, color: frente)),
                ],
              ),
              if (selo != null)
                Positioned(
                  right: 0,
                  top: 0,
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                    decoration: BoxDecoration(color: Cores.amarelo, borderRadius: BorderRadius.circular(10)),
                    child: Text(selo!, style: const TextStyle(fontWeight: FontWeight.w800, color: Cores.marinho)),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}
