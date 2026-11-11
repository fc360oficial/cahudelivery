import 'package:flutter/material.dart';

import '../../app_servicos.dart';
import '../../core/formatadores.dart';
import '../../core/tema.dart';
import '../../data/modelos.dart';
import '../../data/situacao_pedido.dart';
import '../../services/carrinho_service.dart';
import '../../services/sincronizacao_service.dart';
import '../../widgets/comuns.dart';
import '../../widgets/marca.dart';
import '../catalogo/catalogo_page.dart';
import '../orcamentos/orcamentos_page.dart';
import '../pedido/iniciar_pedido.dart';
import '../shell/home_shell.dart';

/// Tela Início: marca e sino, saudação, cartão do faturado do mês com a meta, atalhos grandes,
/// estado da conexão e os destaques (pedidos retidos, fila de envio).
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
    if (r.situacao == SituacaoSync.sessaoExpirada) {
      return; // a raiz já volta ao login
    }
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(
          r.situacao == SituacaoSync.semConexao
              ? 'Sem internet. Mostrando os dados salvos no aparelho.'
              : (r.mensagem ?? 'Não foi possível sincronizar.'),
        ),
      ),
    );
  }

  Future<void> _descartar(CarrinhoService cart) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Descartar o pedido?'),
        content: Text(
          'O pedido de ${cart.cliente?.nomeFantasia ?? ''} em andamento será apagado.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(minimumSize: const Size(0, 48)),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Descartar'),
          ),
        ],
      ),
    );
    if (ok == true) await cart.limpar();
  }

  void _abrir(Widget tela) =>
      Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => tela));

  @override
  Widget build(BuildContext context) {
    final s = Servicos.of(context);
    return ListenableBuilder(
      listenable: Listenable.merge([
        s.sincronizacao,
        s.sessao,
        s.fila,
        s.carrinho,
      ]),
      builder: (context, _) {
        final sync = s.sincronizacao;
        final nome = primeiroNome(s.sessao.vendedor?.nome ?? '');
        final r = _resumo;
        final fila = s.fila;
        final cart = s.carrinho;
        // Retidos: o que está nas tabelas locais; o resumo do servidor também conta os de outros aparelhos.
        final retidos = fila.retidos > (r?.pedidosRetidos ?? 0)
            ? fila.retidos
            : (r?.pedidosRetidos ?? 0);
        void abrirPedidos(FiltroPedido f) =>
            HomeShell.of(context).irPara(AbaVendas.pedidos, filtro: f);
        return Column(
          children: [
            _Topo(
              avisos: retidos + fila.recusados,
              aoTocarSino: () => retidos > 0
                  ? abrirPedidos(FiltroPedido.retidos)
                  : HomeShell.of(context).irPara(AbaVendas.pedidos),
            ),
            Expanded(
              child: RefreshIndicator(
                onRefresh: _sincronizar,
                child: ListView(
                  physics: const AlwaysScrollableScrollPhysics(),
                  padding: const EdgeInsets.fromLTRB(16, 4, 16, 24),
                  children: [
                    Text(
                      'Olá, $nome!',
                      style: const TextStyle(
                        fontSize: 30,
                        height: 1.15,
                        fontWeight: FontWeight.w800,
                        color: Cores.marinho,
                      ),
                    ),
                    const SizedBox(height: 2),
                    const Text(
                      'Vamos fazer um ótimo dia de vendas!',
                      style: TextStyle(fontSize: 15, color: Cores.texto),
                    ),
                    const SizedBox(height: 16),
                    if (cart.temRascunho) ...[
                      _CartaoRascunho(
                        cliente: cart.cliente!.nomeFantasia,
                        itens: cart.qtdItens,
                        total: cart.total,
                        aoContinuar: () => continuarPedido(context),
                        aoDescartar: () => _descartar(cart),
                      ),
                      const SizedBox(height: 12),
                    ],
                    _CartaoMeta(resumo: r),
                    const SizedBox(height: 14),
                    GridView.count(
                      crossAxisCount: 2,
                      shrinkWrap: true,
                      physics: const NeverScrollableScrollPhysics(),
                      mainAxisSpacing: 12,
                      crossAxisSpacing: 12,
                      childAspectRatio: 1.5,
                      children: [
                        _BotaoGrande(
                          icone: Icons.shopping_cart_rounded,
                          rotulo: 'Novo pedido',
                          aoTocar: () => iniciarNovoPedido(context),
                        ),
                        _BotaoGrande(
                          icone: Icons.groups_rounded,
                          rotulo: 'Clientes',
                          aoTocar: () =>
                              HomeShell.of(context).irPara(AbaVendas.clientes),
                        ),
                        _BotaoGrande(
                          icone: Icons.inventory_2_rounded,
                          rotulo: 'Catálogo',
                          aoTocar: () => _abrir(const CatalogoPage()),
                        ),
                        _BotaoGrande(
                          icone: Icons.request_quote_rounded,
                          rotulo: 'Orçamentos',
                          selo: (r?.orcamentosAbertos ?? 0) > 0
                              ? '${r!.orcamentosAbertos}'
                              : null,
                          aoTocar: () => _abrir(const OrcamentosPage()),
                        ),
                      ],
                    ),
                    const SizedBox(height: 14),
                    _CartaoConexao(
                      sync: sync,
                      agora: s.agora,
                      aoSincronizar: _sincronizar,
                    ),
                    if (sync.ultimoErro != null && !sync.sincronizando)
                      Padding(
                        padding: const EdgeInsets.only(top: 8),
                        child: Text(
                          sync.ultimoErro!,
                          textAlign: TextAlign.center,
                          style: const TextStyle(
                            color: Cores.erro,
                            fontSize: 13,
                          ),
                        ),
                      ),
                    if (sync.dadosAntigos) ...[
                      const SizedBox(height: 12),
                      const _AvisoDadosAntigos(),
                    ],
                    if (retidos > 0) ...[
                      const SizedBox(height: 12),
                      _CartaoDestaque(
                        chave: const Key('cartao-retidos'),
                        icone: Icons.pause_circle_rounded,
                        titulo: retidos == 1
                            ? '1 pedido retido aguardando você'
                            : '$retidos pedidos retidos aguardando você',
                        detalhe:
                            'Preço, estoque ou crédito mudaram. Confirme ou cancele.',
                        aoTocar: () => abrirPedidos(FiltroPedido.retidos),
                      ),
                    ],
                    if (fila.naFila > 0) ...[
                      const SizedBox(height: 12),
                      _CartaoDestaque(
                        chave: const Key('indicador-fila'),
                        icone: Icons.schedule_send_rounded,
                        titulo: fila.naFila == 1
                            ? '1 pedido na fila para enviar'
                            : '${fila.naFila} pedidos na fila para enviar',
                        detalhe: 'Sobem sozinhos quando a internet voltar.',
                        aoTocar: () => abrirPedidos(FiltroPedido.naFila),
                      ),
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
                  ],
                ),
              ),
            ),
          ],
        );
      },
    );
  }
}

/// Área branca do alto: a marca no centro e o sino à direita (com o número de avisos).
class _Topo extends StatelessWidget {
  const _Topo({required this.avisos, required this.aoTocarSino});
  final int avisos;
  final VoidCallback aoTocarSino;

  @override
  Widget build(BuildContext context) {
    return Container(
      color: Colors.white,
      child: SafeArea(
        bottom: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 10, 8, 10),
          child: Row(
            children: [
              const SizedBox(width: 48),
              const Expanded(
                child: Center(child: MarcaFluxoVendas(altura: 46)),
              ),
              SizedBox(
                width: 48,
                height: 48,
                child: Stack(
                  alignment: Alignment.center,
                  children: [
                    IconButton(
                      key: const Key('sino'),
                      tooltip: avisos > 0
                          ? 'Pedidos que precisam de você'
                          : 'Pedidos',
                      onPressed: aoTocarSino,
                      icon: const Icon(
                        Icons.notifications_none_rounded,
                        size: 28,
                        color: Cores.marinho,
                      ),
                    ),
                    if (avisos > 0)
                      Positioned(
                        right: 4,
                        top: 4,
                        child: Container(
                          constraints: const BoxConstraints(
                            minWidth: 18,
                            minHeight: 18,
                          ),
                          padding: const EdgeInsets.symmetric(horizontal: 4),
                          decoration: BoxDecoration(
                            color: const Color(0xFFE53935),
                            borderRadius: BorderRadius.circular(9),
                          ),
                          alignment: Alignment.center,
                          child: Text(
                            '$avisos',
                            style: const TextStyle(
                              color: Colors.white,
                              fontSize: 11,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                        ),
                      ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// O cartão azul grande: faturado no mês à esquerda, % da meta à direita e a barra amarela embaixo.
class _CartaoMeta extends StatelessWidget {
  const _CartaoMeta({required this.resumo});
  final ResumoVendedor? resumo;

  @override
  Widget build(BuildContext context) {
    final r = resumo;
    final meta = r?.meta;
    final temMeta = meta?.temMeta ?? false;
    final pct = meta?.atingidoPct ?? 0;
    const branco70 = Color(0xCCFFFFFF);
    return Container(
      key: const Key('cartao-meta'),
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 14),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(20),
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFF123A8F), Color(0xFF0B2260)],
        ),
        boxShadow: const [
          BoxShadow(
            color: Color(0x330B1F4B),
            blurRadius: 14,
            offset: Offset(0, 6),
          ),
        ],
      ),
      child: Column(
        children: [
          IntrinsicHeight(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.center,
              children: [
                const Icon(
                  Icons.bar_chart_rounded,
                  size: 46,
                  color: Cores.amarelo,
                ),
                const SizedBox(width: 10),
                Expanded(
                  flex: 11,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      FittedBox(
                        fit: BoxFit.scaleDown,
                        alignment: Alignment.centerLeft,
                        child: Text(
                          r == null ? '—' : moeda(r.vendidoMes),
                          key: const Key('vendido-mes'),
                          style: const TextStyle(
                            fontSize: 26,
                            fontWeight: FontWeight.w800,
                            color: Colors.white,
                          ),
                        ),
                      ),
                      const Text(
                        'Faturado no mês',
                        style: TextStyle(color: branco70, fontSize: 14),
                      ),
                    ],
                  ),
                ),
                Container(
                  width: 1,
                  margin: const EdgeInsets.symmetric(horizontal: 12),
                  color: Colors.white24,
                ),
                Expanded(
                  flex: 8,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.center,
                    children: [
                      FittedBox(
                        fit: BoxFit.scaleDown,
                        child: Text(
                          temMeta ? '${pct.floor()}%' : 'Sem meta',
                          key: const Key('meta-percentual'),
                          style: const TextStyle(
                            fontSize: 26,
                            fontWeight: FontWeight.w800,
                            color: Colors.white,
                          ),
                        ),
                      ),
                      Text(
                        temMeta ? 'da meta' : 'neste mês',
                        style: const TextStyle(color: branco70, fontSize: 14),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          if (temMeta) ...[
            const SizedBox(height: 12),
            ClipRRect(
              borderRadius: BorderRadius.circular(6),
              child: LinearProgressIndicator(
                key: const Key('barra-meta'),
                value: (pct / 100).clamp(0.0, 1.0),
                minHeight: 10,
                backgroundColor: Colors.white24,
                valueColor: const AlwaysStoppedAnimation(Cores.amarelo),
              ),
            ),
          ],
          if (r != null) ...[
            const SizedBox(height: 10),
            Align(
              alignment: Alignment.centerLeft,
              child: Text(
                'Hoje: ${moeda(r.vendidoHoje)} · ${r.pedidosHoje} ${r.pedidosHoje == 1 ? 'pedido enviado' : 'pedidos enviados'}',
                key: const Key('vendido-hoje'),
                style: const TextStyle(color: branco70, fontSize: 13),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _BotaoGrande extends StatelessWidget {
  const _BotaoGrande({
    required this.icone,
    required this.rotulo,
    required this.aoTocar,
    this.selo,
  });
  final IconData icone;
  final String rotulo;
  final VoidCallback aoTocar;
  final String? selo;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: InkWell(
        borderRadius: BorderRadius.circular(16),
        onTap: aoTocar,
        child: Stack(
          children: [
            Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(icone, size: 42, color: Cores.azul),
                  const SizedBox(height: 8),
                  Text(
                    rotulo,
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      fontSize: 17,
                      fontWeight: FontWeight.w800,
                      color: Cores.marinho,
                    ),
                  ),
                ],
              ),
            ),
            if (selo != null)
              Positioned(
                right: 10,
                top: 10,
                child: Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 8,
                    vertical: 2,
                  ),
                  decoration: BoxDecoration(
                    color: Cores.amarelo,
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Text(
                    selo!,
                    style: const TextStyle(
                      fontWeight: FontWeight.w800,
                      color: Cores.marinho,
                    ),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

/// "Online" com o visto verde e o botão de atualizar; sem internet fica cinza com aviso laranja.
class _CartaoConexao extends StatelessWidget {
  const _CartaoConexao({
    required this.sync,
    required this.agora,
    required this.aoSincronizar,
  });
  final SincronizacaoService sync;
  final DateTime Function() agora;
  final VoidCallback aoSincronizar;

  @override
  Widget build(BuildContext context) {
    final online = sync.online;
    final u = sync.ultimaSincronizacao;
    final quando = u == null ? null : quandoSincronizou(u, agora());
    final titulo = online ? 'Online' : 'Sem internet';
    final detalhe = online
        ? (quando == null
              ? 'Ainda não sincronizado'
              : 'Última sincronização: $quando')
        : (quando == null ? 'Sem dados neste aparelho' : 'Dados de $quando');
    const laranja = Color(0xFFD97A00);
    return Container(
      key: const Key('linha-conexao'),
      constraints: const BoxConstraints(minHeight: 64),
      padding: const EdgeInsets.fromLTRB(14, 8, 4, 8),
      decoration: BoxDecoration(
        color: online ? Cores.azulClaro : const Color(0xFFEFF0F4),
        borderRadius: BorderRadius.circular(16),
      ),
      child: Row(
        children: [
          Container(
            width: 38,
            height: 38,
            decoration: BoxDecoration(
              color: online ? Cores.ok : laranja,
              shape: BoxShape.circle,
            ),
            child: Icon(
              online ? Icons.check_rounded : Icons.wifi_off_rounded,
              color: Colors.white,
              size: 24,
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  titulo,
                  style: TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w800,
                    color: online ? Cores.marinho : laranja,
                  ),
                ),
                Text(
                  detalhe,
                  style: const TextStyle(color: Cores.textoSuave, fontSize: 13),
                ),
              ],
            ),
          ),
          IconButton(
            key: const Key('sincronizar-agora'),
            tooltip: 'Sincronizar agora',
            onPressed: sync.sincronizando ? null : aoSincronizar,
            icon: sync.sincronizando
                ? const SizedBox(
                    height: 22,
                    width: 22,
                    child: CircularProgressIndicator(strokeWidth: 2.5),
                  )
                : const Icon(Icons.sync_rounded, color: Cores.azul, size: 28),
          ),
        ],
      ),
    );
  }
}

/// Cartão amarelo de destaque (pedidos retidos, fila de envio).
class _CartaoDestaque extends StatelessWidget {
  const _CartaoDestaque({
    required this.chave,
    required this.icone,
    required this.titulo,
    required this.detalhe,
    required this.aoTocar,
  });
  final Key chave;
  final IconData icone;
  final String titulo, detalhe;
  final VoidCallback aoTocar;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Cores.amareloClaro,
      borderRadius: BorderRadius.circular(16),
      child: InkWell(
        key: chave,
        borderRadius: BorderRadius.circular(16),
        onTap: aoTocar,
        child: Container(
          constraints: const BoxConstraints(minHeight: 64),
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
          child: Row(
            children: [
              Icon(icone, size: 34, color: const Color(0xFFF2A900)),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      titulo,
                      style: const TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.w800,
                        color: Cores.marinho,
                      ),
                    ),
                    Text(
                      detalhe,
                      style: const TextStyle(
                        color: Cores.textoSuave,
                        fontSize: 12.5,
                      ),
                    ),
                  ],
                ),
              ),
              const Icon(Icons.chevron_right_rounded, color: Cores.marinho),
            ],
          ),
        ),
      ),
    );
  }
}

class _CartaoRascunho extends StatelessWidget {
  const _CartaoRascunho({
    required this.cliente,
    required this.itens,
    required this.total,
    required this.aoContinuar,
    required this.aoDescartar,
  });
  final String cliente;
  final int itens;
  final double total;
  final VoidCallback aoContinuar, aoDescartar;

  @override
  Widget build(BuildContext context) {
    return Card(
      key: const Key('cartao-rascunho'),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(14, 12, 8, 6),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const IconeCaixa(Icons.edit_note_rounded, tamanho: 44),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Continuar pedido de $cliente',
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontWeight: FontWeight.w800,
                          color: Cores.marinho,
                          fontSize: 15,
                        ),
                      ),
                      Text(
                        itens == 0
                            ? 'Sem itens ainda'
                            : '$itens ${itens == 1 ? 'item' : 'itens'} · ${moeda(total)}',
                        style: const TextStyle(color: Cores.textoSuave),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            Row(
              children: [
                Expanded(
                  child: TextButton(
                    onPressed: aoDescartar,
                    style: TextButton.styleFrom(
                      minimumSize: const Size(48, 48),
                      foregroundColor: Cores.erro,
                    ),
                    child: const Text('Descartar'),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: FilledButton(
                    key: const Key('continuar-pedido'),
                    onPressed: aoContinuar,
                    style: FilledButton.styleFrom(
                      minimumSize: const Size(0, 48),
                    ),
                    child: const Text('Continuar'),
                  ),
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
              style: TextStyle(
                color: Cores.marinho,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
