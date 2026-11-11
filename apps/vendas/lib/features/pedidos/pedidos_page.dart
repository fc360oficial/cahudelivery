import 'package:flutter/material.dart';

import '../../app_servicos.dart';
import '../../core/formatadores.dart';
import '../../core/tema.dart';
import '../../data/pedido_local.dart';
import '../../data/situacao_pedido.dart';
import '../../widgets/comuns.dart';
import '../../widgets/pilulas.dart';
import 'pedido_detalhe_page.dart';

/// Aba Pedidos: um só lista com a fila do aparelho e os pedidos do servidor (já reconciliados
/// por `idDispositivo` pelo [PedidosService]). Filtros em chips, puxar para atualizar.
class PedidosPage extends StatefulWidget {
  const PedidosPage({super.key});

  @override
  State<PedidosPage> createState() => _PedidosPageState();
}

class _PedidosPageState extends State<PedidosPage> {
  AppServicos? _s;
  List<({PedidoLocal pedido, String cliente})> _linhas = const [];
  bool _carregando = true;
  String? _erro;
  int _geracao = 0;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final s = Servicos.of(context);
    if (!identical(s, _s)) {
      _desligar();
      _s = s;
      s.pedidos.addListener(_carregar);
      s.fila.addListener(_carregar);
      s.sincronizacao.cargaVersao.addListener(_carregar);
      _carregar();
      s.pedidos.reconciliar();
    }
  }

  void _desligar() {
    final s = _s;
    if (s == null) return;
    s.pedidos.removeListener(_carregar);
    s.fila.removeListener(_carregar);
    s.sincronizacao.cargaVersao.removeListener(_carregar);
  }

  @override
  void dispose() {
    _desligar();
    super.dispose();
  }

  Future<void> _carregar() async {
    final minha = ++_geracao;
    final s = _s!;
    try {
      final pedidos = await s.pedidosLocais.listar();
      final clientes = {for (final c in await s.clientes.buscar()) c.id: c.nomeFantasia};
      if (!mounted || minha != _geracao) return;
      setState(() {
        _linhas = [for (final p in pedidos) (pedido: p, cliente: clientes[p.clienteId] ?? 'Cliente fora da carteira')];
        _carregando = false;
        _erro = null;
      });
    } catch (_) {
      if (!mounted || minha != _geracao) return;
      setState(() {
        _carregando = false;
        _erro = 'Não foi possível ler os pedidos deste aparelho.';
      });
    }
  }

  /// Puxar para atualizar: envia a fila, baixa a carga e confere os pedidos com o servidor.
  Future<void> _atualizar() async {
    final s = _s!;
    await s.sincronizacao.sincronizar();
    final ok = await s.pedidos.reconciliar();
    if (!mounted || ok) return;
    ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Sem internet. Mostrando os pedidos salvos no aparelho.')));
  }

  void _abrir(PedidoLocal p) => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => PedidoDetalhePage(pedidoId: p.id)));

  @override
  Widget build(BuildContext context) {
    final s = Servicos.of(context);
    return ValueListenableBuilder<FiltroPedido>(
      valueListenable: s.pedidos.filtro,
      builder: (context, filtro, _) {
        final visiveis = _linhas.where((l) => filtro.aceita(situacaoDe(l.pedido))).toList();
        return Column(
          children: [
            Container(
              key: const Key('filtros-pedidos'),
              color: Colors.white,
              height: 56,
              child: ListView(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.symmetric(horizontal: 16),
                children: [
                  for (final f in FiltroPedido.values)
                    ChipFiltro(rotulo: f.rotulo, ativo: f == filtro, aoTocar: () => s.pedidos.filtro.value = f),
                ],
              ),
            ),
            const Divider(height: 1),
            Expanded(child: _corpo(visiveis, filtro)),
          ],
        );
      },
    );
  }

  Widget _corpo(List<({PedidoLocal pedido, String cliente})> visiveis, FiltroPedido filtro) {
    if (_carregando) return const Center(child: CircularProgressIndicator());
    if (_erro != null) return EstadoErro(mensagem: _erro!, aoTentarDeNovo: _carregar);
    return ListaAtualizavel(
      aoAtualizar: _atualizar,
      vazio: _vazio(filtro),
      itens: [
        for (final l in visiveis) ...[
          LinhaPedido(pedido: l.pedido, cliente: l.cliente, aoTocar: () => _abrir(l.pedido)),
          const SizedBox(height: 8),
        ],
      ],
    );
  }

  Widget _vazio(FiltroPedido filtro) {
    if (filtro == FiltroPedido.todos) {
      return const EstadoVazio(
        key: Key('vazio-pedidos'),
        icone: Icons.receipt_long_outlined,
        titulo: 'Nenhum pedido ainda',
        texto: 'Os pedidos que você enviar aparecem aqui, com a situação de cada um.',
      );
    }
    final (titulo, texto) = switch (filtro) {
      FiltroPedido.naFila => ('Nada na fila', 'Todos os pedidos já foram enviados.'),
      FiltroPedido.retidos => ('Nenhum pedido retido', 'Quando preço, estoque ou crédito mudarem, o pedido aparece aqui para você confirmar ou cancelar.'),
      FiltroPedido.enviados => ('Nenhum pedido enviado', 'Pedidos enviados e ainda não faturados aparecem aqui.'),
      FiltroPedido.faturados => ('Nenhum pedido faturado', 'Pedidos faturados aparecem aqui.'),
      _ => ('Nenhum pedido cancelado ou recusado', 'Pedidos cancelados ou recusados aparecem aqui.'),
    };
    return EstadoVazio(key: const Key('vazio-filtro'), icone: Icons.filter_list_off_rounded, titulo: titulo, texto: texto);
  }
}

/// Linha da lista: cliente, data e hora, total, pílula de situação e número do pedido quando há.
class LinhaPedido extends StatelessWidget {
  const LinhaPedido({super.key, required this.pedido, required this.cliente, required this.aoTocar});
  final PedidoLocal pedido;
  final String cliente;
  final VoidCallback aoTocar;

  @override
  Widget build(BuildContext context) {
    final sit = situacaoDe(pedido);
    final numero = pedido.servidorNumero;
    final quando = dataHoraCurta(pedido.criadoEm.toLocal());
    return Card(
      margin: EdgeInsets.zero,
      child: InkWell(
        borderRadius: BorderRadius.circular(16),
        onTap: aoTocar,
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: 48),
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(
                      child: Text(cliente,
                          maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w800, color: Cores.marinho, fontSize: 15)),
                    ),
                    const SizedBox(width: 8),
                    Text(moeda(pedido.totalServidor), style: const TextStyle(fontWeight: FontWeight.w800, color: Cores.marinho)),
                  ],
                ),
                const SizedBox(height: 4),
                Row(
                  children: [
                    Expanded(
                      child: Text(numero == null ? quando : '$quando · Pedido nº $numero',
                          maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(color: Cores.textoSuave, fontSize: 13)),
                    ),
                    const SizedBox(width: 8),
                    Flexible(child: PilulaPedido(sit)),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
