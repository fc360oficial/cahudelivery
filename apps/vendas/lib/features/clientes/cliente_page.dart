import 'package:flutter/material.dart';

import '../../app_servicos.dart';
import '../../core/formatadores.dart';
import '../../core/tema.dart';
import '../../data/modelos.dart';
import '../../widgets/comuns.dart';
import '../pedido/iniciar_pedido.dart';

/// Detalhe do cliente: dados, financeiro (limite, em aberto, títulos) e histórico de pedidos.
class ClientePage extends StatefulWidget {
  const ClientePage({super.key, required this.clienteId});
  final String clienteId;

  @override
  State<ClientePage> createState() => _ClientePageState();
}

class _Dados {
  _Dados(this.cliente, this.titulos, this.historico);
  final Cliente? cliente;
  final List<Titulo> titulos;
  final List<PedidoHistorico> historico;
}

class _ClientePageState extends State<ClientePage> {
  Future<_Dados>? _futuro;
  AppServicos? _s;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final s = Servicos.of(context);
    if (!identical(s, _s)) {
      _s = s;
      _futuro = _carregar();
    }
  }

  Future<_Dados> _carregar() async {
    final s = _s!;
    final c = await s.clientes.porId(widget.clienteId);
    final t = await s.titulos.porCliente(widget.clienteId);
    final h = await s.historico.porCliente(widget.clienteId);
    return _Dados(c, t, h);
  }

  void _recarregar() => setState(() => _futuro = _carregar());

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<_Dados>(
      future: _futuro,
      builder: (context, snap) {
        if (snap.hasError) {
          return Scaffold(
            appBar: AppBar(title: const Text('Cliente')),
            body: EstadoErro(mensagem: 'Não foi possível ler os dados deste cliente.', aoTentarDeNovo: _recarregar),
          );
        }
        if (!snap.hasData) {
          return Scaffold(appBar: AppBar(title: const Text('Cliente')), body: const Center(child: CircularProgressIndicator()));
        }
        final d = snap.data!;
        final c = d.cliente;
        if (c == null) {
          return Scaffold(
            appBar: AppBar(title: const Text('Cliente')),
            body: const EstadoVazio(
                icone: Icons.person_off_outlined,
                titulo: 'Cliente não encontrado',
                texto: 'Ele pode ter saído da sua carteira na última sincronização.'),
          );
        }
        final pode = !c.bloqueado && c.temCadastroErp;
        return DefaultTabController(
          length: 3,
          child: Scaffold(
            appBar: AppBar(
              title: Text(c.nomeFantasia, maxLines: 1, overflow: TextOverflow.ellipsis),
              bottom: const TabBar(
                indicatorColor: Cores.amarelo,
                labelColor: Colors.white,
                unselectedLabelColor: Color(0xB3FFFFFF),
                tabs: [Tab(text: 'Dados'), Tab(text: 'Financeiro'), Tab(text: 'Histórico')],
              ),
            ),
            body: TabBarView(children: [
              _AbaDados(cliente: c),
              _AbaFinanceiro(cliente: c, titulos: d.titulos, agora: _s!.agora()),
              _AbaHistorico(historico: d.historico),
            ]),
            bottomNavigationBar: SafeArea(
              child: Container(
                color: Colors.white,
                padding: const EdgeInsets.fromLTRB(16, 10, 16, 10),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    if (!pode) ...[
                      CaixaAviso(
                        tom: TomAviso.erro,
                        texto: c.bloqueado
                            ? 'Cliente bloqueado. Não é possível fazer pedido. Fale com o supervisor.'
                            : 'Cliente ainda sem cadastro no ERP. Não é possível vender.',
                      ),
                      const SizedBox(height: 10),
                    ],
                    FilledButton.icon(
                      key: const Key('novo-pedido-cliente'),
                      onPressed: pode ? () => iniciarNovoPedido(context, cliente: c) : null,
                      icon: const Icon(Icons.add_shopping_cart_rounded),
                      label: const Text('Novo pedido'),
                    ),
                  ],
                ),
              ),
            ),
          ),
        );
      },
    );
  }
}

class _AbaDados extends StatelessWidget {
  const _AbaDados({required this.cliente});
  final Cliente cliente;

  @override
  Widget build(BuildContext context) {
    final c = cliente;
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Card(
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Column(
              children: [
                if ((c.razaoSocial ?? '').isNotEmpty) LinhaInfo('Razão social', c.razaoSocial!),
                LinhaInfo('Nome fantasia', c.nomeFantasia),
                LinhaInfo('CNPJ/CPF', documentoFormatado(c.documento)),
                LinhaInfo('Código no ERP', c.temCadastroErp ? c.erpClienteId! : 'sem cadastro'),
                LinhaInfo('Telefone', (c.telefone ?? '').isEmpty ? 'não informado' : c.telefone!),
                LinhaInfo('Endereço', c.endereco == null || c.endereco!.resumo.isEmpty ? 'não informado' : c.endereco!.resumo),
                if ((c.endereco?.cep ?? '').isNotEmpty) LinhaInfo('CEP', c.endereco!.cep!),
                LinhaInfo('Situação', c.bloqueado ? 'Bloqueado' : 'Liberado', corValor: c.bloqueado ? Cores.erro : Cores.ok),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

class _AbaFinanceiro extends StatelessWidget {
  const _AbaFinanceiro({required this.cliente, required this.titulos, required this.agora});
  final Cliente cliente;
  final List<Titulo> titulos;
  final DateTime agora;

  @override
  Widget build(BuildContext context) {
    final c = cliente;
    final disp = c.creditoDisponivel;
    final vencidos = titulos.where((t) => t.vencido(agora)).toList();
    final totalVencido = vencidos.fold<double>(0, (a, t) => a + t.valor);
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Card(
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Column(
              children: [
                LinhaInfo('Limite de crédito', c.limiteCredito == null ? 'não informado' : moeda(c.limiteCredito!)),
                LinhaInfo('Em aberto', moeda(c.emAberto)),
                LinhaInfo('Pedidos em trânsito', moeda(c.pedidosEmTransito)),
                const Divider(height: 18),
                LinhaInfo('Disponível', disp == null ? 'sem limite' : moeda(disp),
                    destaque: true, corValor: disp != null && disp < 0 ? Cores.erro : Cores.marinho),
              ],
            ),
          ),
        ),
        const SizedBox(height: 16),
        const TituloSecao('TÍTULOS EM ABERTO'),
        if (vencidos.isNotEmpty) ...[
          CaixaAviso(
            tom: TomAviso.erro,
            icone: Icons.event_busy_rounded,
            texto: vencidos.length == 1
                ? '1 título vencido: ${moeda(totalVencido)}'
                : '${vencidos.length} títulos vencidos: ${moeda(totalVencido)}',
          ),
          const SizedBox(height: 8),
        ],
        if (titulos.isEmpty)
          const Padding(
            padding: EdgeInsets.symmetric(vertical: 24),
            child: EstadoVazio(icone: Icons.check_circle_outline_rounded, titulo: 'Nenhum título em aberto'),
          )
        else
          for (final t in titulos) ...[
            _LinhaTitulo(titulo: t, vencido: t.vencido(agora)),
            const SizedBox(height: 8),
          ],
      ],
    );
  }
}

class _LinhaTitulo extends StatelessWidget {
  const _LinhaTitulo({required this.titulo, required this.vencido});
  final Titulo titulo;
  final bool vencido;

  @override
  Widget build(BuildContext context) {
    final cor = vencido ? Cores.erro : Cores.texto;
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: vencido ? const Color(0xFFFDECEC) : Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: vencido ? const Color(0xFFF0B5B5) : Cores.linha),
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Título ${titulo.numero}', style: TextStyle(fontWeight: FontWeight.w700, color: cor)),
                Text('Vence em ${dataCompleta(titulo.vencimento)}', style: TextStyle(color: vencido ? Cores.erro : Cores.textoSuave, fontSize: 13)),
              ],
            ),
          ),
          if (vencido) const Padding(padding: EdgeInsets.only(right: 8), child: Etiqueta('Vencido', cor: Cores.erro)),
          Text(moeda(titulo.valor), style: TextStyle(fontWeight: FontWeight.w800, color: cor)),
        ],
      ),
    );
  }
}

class _AbaHistorico extends StatelessWidget {
  const _AbaHistorico({required this.historico});
  final List<PedidoHistorico> historico;

  @override
  Widget build(BuildContext context) {
    if (historico.isEmpty) {
      return const EstadoVazio(
          icone: Icons.receipt_long_outlined, titulo: 'Sem pedidos recentes', texto: 'Os pedidos dos últimos 90 dias aparecem aqui.');
    }
    return ListView.separated(
      padding: const EdgeInsets.all(16),
      itemCount: historico.length,
      separatorBuilder: (_, _) => const SizedBox(height: 8),
      itemBuilder: (_, i) {
        final p = historico[i];
        final origem = switch (p.origem) {
          'app_cliente' => const Etiqueta('App do cliente', icone: Icons.smartphone_rounded),
          'vendedor' => const Etiqueta('Vendedor', cor: Cores.marinho, icone: Icons.badge_outlined),
          _ => null,
        };
        return Card(
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(child: Text('Pedido nº ${p.numero}', style: const TextStyle(fontWeight: FontWeight.w800, color: Cores.marinho, fontSize: 16))),
                    Text(moeda(p.total), style: const TextStyle(fontWeight: FontWeight.w800)),
                  ],
                ),
                const SizedBox(height: 4),
                Text('${dataHoraCurta(p.criadoEm.toLocal())} · ${p.itens.length} ${p.itens.length == 1 ? 'item' : 'itens'}',
                    style: const TextStyle(color: Cores.textoSuave)),
                const SizedBox(height: 8),
                Wrap(
                  spacing: 8,
                  runSpacing: 6,
                  children: [Etiqueta(rotuloStatusPedido(p.status), cor: p.status.toUpperCase() == 'CANCELADO' ? Cores.erro : Cores.ok), ?origem],
                ),
              ],
            ),
          ),
        );
      },
    );
  }
}
