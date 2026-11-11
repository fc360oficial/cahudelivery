import 'package:flutter/material.dart';

import '../../app_servicos.dart';
import '../../core/formatadores.dart';
import '../../core/tema.dart';
import '../../data/modelos.dart';
import '../../widgets/barra_navegacao.dart';
import '../../widgets/comuns.dart';
import '../pedido/iniciar_pedido.dart';
import 'clientes_page.dart';

/// Detalhe do cliente: cartão com os dados e duas abas, Histórico (últimas compras e títulos
/// pendentes) e Financeiro (limite, em aberto e os títulos um a um).
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
  int _aba = 0; // 0 = Histórico, 1 = Financeiro

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

  Widget _casca(Widget corpo, {Widget? acao}) => Scaffold(
    appBar: AppBar(title: const Text('Cliente')),
    body: corpo,
    bottomNavigationBar: Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        ?acao,
        const BarraNavegacaoEmpilhada(atual: AbaVendas.clientes),
      ],
    ),
  );

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<_Dados>(
      future: _futuro,
      builder: (context, snap) {
        if (snap.hasError) {
          return _casca(
            EstadoErro(
              mensagem: 'Não foi possível ler os dados deste cliente.',
              aoTentarDeNovo: _recarregar,
            ),
          );
        }
        if (!snap.hasData) {
          return _casca(const Center(child: CircularProgressIndicator()));
        }
        final d = snap.data!;
        final c = d.cliente;
        if (c == null) {
          return _casca(
            const EstadoVazio(
              icone: Icons.person_off_outlined,
              titulo: 'Cliente não encontrado',
              texto:
                  'Ele pode ter saído da sua carteira na última sincronização.',
            ),
          );
        }
        final pode = !c.bloqueado && c.temCadastroErp;
        final agora = _s!.agora();
        return _casca(
          SingleChildScrollView(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
              _CartaoDados(cliente: c),
              const SizedBox(height: 14),
              _Abas(atual: _aba, aoTrocar: (i) => setState(() => _aba = i)),
              const SizedBox(height: 12),
              if (_aba == 0)
                ..._historico(d, agora)
              else
                ..._financeiro(c, d.titulos, agora),
              ],
            ),
          ),
          acao: Container(
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
                  onPressed: pode
                      ? () => iniciarNovoPedido(context, cliente: c)
                      : null,
                  icon: const Icon(Icons.shopping_cart_rounded),
                  label: const Text('Novo pedido'),
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  List<Widget> _historico(_Dados d, DateTime agora) {
    final compras = d.historico;
    return [
      const Text(
        'Últimas compras',
        style: TextStyle(
          fontSize: 16,
          fontWeight: FontWeight.w800,
          color: Cores.marinho,
        ),
      ),
      const SizedBox(height: 8),
      if (compras.isEmpty)
        const _VazioInline(
          icone: Icons.receipt_long_outlined,
          titulo: 'Sem pedidos recentes',
          texto: 'Os pedidos dos últimos 90 dias aparecem aqui.',
        )
      else
        Card(
          child: Column(
            children: [
              for (var i = 0; i < compras.length; i++) ...[
                if (i > 0) const Divider(height: 1, indent: 14, endIndent: 14),
                _LinhaCompra(pedido: compras[i]),
              ],
            ],
          ),
        ),
      if (d.titulos.isNotEmpty) ...[
        const SizedBox(height: 16),
        _CartaoTitulosPendentes(
          titulos: d.titulos,
          agora: agora,
          aoVerDetalhes: () => setState(() => _aba = 1),
        ),
      ],
    ];
  }

  List<Widget> _financeiro(Cliente c, List<Titulo> titulos, DateTime agora) {
    final disp = c.creditoDisponivel;
    final vencidos = titulos.where((t) => t.vencido(agora)).toList();
    final totalVencido = vencidos.fold<double>(0, (a, t) => a + t.valor);
    return [
      Card(
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            children: [
              LinhaInfo(
                'Limite de crédito',
                c.limiteCredito == null
                    ? 'não informado'
                    : moeda(c.limiteCredito!),
              ),
              LinhaInfo('Em aberto', moeda(c.emAberto)),
              LinhaInfo('Pedidos em trânsito', moeda(c.pedidosEmTransito)),
              const Divider(height: 18),
              LinhaInfo(
                'Disponível',
                disp == null ? 'sem limite' : moeda(disp),
                destaque: true,
                corValor: disp != null && disp < 0 ? Cores.erro : Cores.marinho,
              ),
            ],
          ),
        ),
      ),
      const SizedBox(height: 16),
      const Text(
        'Títulos em aberto',
        style: TextStyle(
          fontSize: 16,
          fontWeight: FontWeight.w800,
          color: Cores.marinho,
        ),
      ),
      const SizedBox(height: 8),
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
        const _VazioInline(
          icone: Icons.check_circle_outline_rounded,
          titulo: 'Nenhum título em aberto',
        )
      else
        for (final t in titulos) ...[
          _LinhaTitulo(titulo: t, vencido: t.vencido(agora)),
          const SizedBox(height: 8),
        ],
    ];
  }
}

/// Estado vazio que cabe dentro de uma lista (sem ocupar a tela inteira).
class _VazioInline extends StatelessWidget {
  const _VazioInline({required this.icone, required this.titulo, this.texto});
  final IconData icone;
  final String titulo;
  final String? texto;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 24),
      child: Column(
        children: [
          Icon(icone, size: 44, color: Cores.textoSuave.withValues(alpha: 0.6)),
          const SizedBox(height: 10),
          Text(
            titulo,
            textAlign: TextAlign.center,
            style: const TextStyle(
              fontSize: 16,
              fontWeight: FontWeight.w700,
              color: Cores.marinho,
            ),
          ),
          if (texto != null) ...[
            const SizedBox(height: 4),
            Text(
              texto!,
              textAlign: TextAlign.center,
              style: const TextStyle(color: Cores.textoSuave),
            ),
          ],
        ],
      ),
    );
  }
}

/// Cartão do topo: nome e situação, CNPJ, telefone e endereço.
class _CartaoDados extends StatelessWidget {
  const _CartaoDados({required this.cliente});
  final Cliente cliente;

  @override
  Widget build(BuildContext context) {
    final c = cliente;
    final tel = (c.telefone ?? '').isEmpty
        ? 'Telefone não informado'
        : c.telefone!;
    final end = c.endereco == null || c.endereco!.resumo.isEmpty
        ? 'Endereço não informado'
        : c.endereco!.resumo;
    Widget linha(IconData i, String t) => Padding(
      padding: const EdgeInsets.only(top: 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(i, size: 19, color: Cores.azul),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              t,
              style: const TextStyle(color: Cores.texto, fontSize: 14.5),
            ),
          ),
        ],
      ),
    );
    return Card(
      key: const Key('cartao-cliente'),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const IconeCaixa(
                  Icons.storefront_rounded,
                  tamanho: 46,
                  redondo: true,
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(
                    c.nomeFantasia,
                    style: const TextStyle(
                      fontSize: 18,
                      fontWeight: FontWeight.w800,
                      color: Cores.marinho,
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                etiquetaDoCliente(c),
              ],
            ),
            if ((c.razaoSocial ?? '').isNotEmpty &&
                c.razaoSocial != c.nomeFantasia)
              Padding(
                padding: const EdgeInsets.only(top: 6),
                child: Text(
                  c.razaoSocial!,
                  style: const TextStyle(color: Cores.textoSuave),
                ),
              ),
            linha(
              Icons.badge_outlined,
              'CNPJ/CPF: ${documentoFormatado(c.documento)}',
            ),
            linha(
              Icons.tag_rounded,
              c.temCadastroErp
                  ? 'Código no ERP: ${c.erpClienteId}'
                  : 'Sem cadastro no ERP',
            ),
            linha(Icons.phone_outlined, tel),
            linha(
              Icons.location_on_outlined,
              (c.endereco?.cep ?? '').isEmpty
                  ? end
                  : '$end · CEP ${c.endereco!.cep}',
            ),
          ],
        ),
      ),
    );
  }
}

/// As duas abas (Histórico e Financeiro): texto azul e traço azul embaixo na ativa.
class _Abas extends StatelessWidget {
  const _Abas({required this.atual, required this.aoTrocar});
  final int atual;
  final ValueChanged<int> aoTrocar;

  @override
  Widget build(BuildContext context) {
    Widget aba(int i, String t) {
      final ativa = atual == i;
      return Expanded(
        child: InkWell(
          onTap: () => aoTrocar(i),
          child: Container(
            constraints: const BoxConstraints(minHeight: 48),
            alignment: Alignment.center,
            decoration: BoxDecoration(
              border: Border(
                bottom: BorderSide(
                  color: ativa ? Cores.azul : Cores.linha,
                  width: ativa ? 3 : 1,
                ),
              ),
            ),
            child: Text(
              t,
              style: TextStyle(
                fontSize: 15,
                fontWeight: ativa ? FontWeight.w800 : FontWeight.w500,
                color: ativa ? Cores.azul : Cores.textoSuave,
              ),
            ),
          ),
        ),
      );
    }

    return Row(children: [aba(0, 'Histórico'), aba(1, 'Financeiro')]);
  }
}

class _LinhaCompra extends StatelessWidget {
  const _LinhaCompra({required this.pedido});
  final PedidoHistorico pedido;

  @override
  Widget build(BuildContext context) {
    final p = pedido;
    final cancelado = p.status.toUpperCase() == 'CANCELADO';
    final origem = switch (p.origem) {
      'app_cliente' => const Etiqueta(
        'App do cliente',
        icone: Icons.smartphone_rounded,
      ),
      'vendedor' => const Etiqueta(
        'Vendedor',
        cor: Cores.marinho,
        icone: Icons.badge_outlined,
      ),
      _ => null,
    };
    return Padding(
      padding: const EdgeInsets.all(14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(
                Icons.calendar_today_outlined,
                size: 17,
                color: Cores.azul,
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  dataCompleta(p.criadoEm.toLocal()),
                  style: const TextStyle(
                    fontWeight: FontWeight.w600,
                    color: Cores.marinho,
                  ),
                ),
              ),
              Text(
                moeda(p.total),
                style: const TextStyle(
                  fontWeight: FontWeight.w800,
                  color: Cores.marinho,
                ),
              ),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            'Pedido nº ${p.numero} · ${p.itens.length} ${p.itens.length == 1 ? 'item' : 'itens'}',
            style: const TextStyle(color: Cores.textoSuave, fontSize: 13),
          ),
          const SizedBox(height: 6),
          Wrap(
            spacing: 8,
            runSpacing: 6,
            children: [
              Etiqueta(
                rotuloStatusPedido(p.status),
                cor: cancelado ? Cores.erro : Cores.ok,
              ),
              ?origem,
            ],
          ),
        ],
      ),
    );
  }
}

/// Resumo dos títulos em aberto: valor, próximo vencimento e "Ver detalhes".
class _CartaoTitulosPendentes extends StatelessWidget {
  const _CartaoTitulosPendentes({
    required this.titulos,
    required this.agora,
    required this.aoVerDetalhes,
  });
  final List<Titulo> titulos;
  final DateTime agora;
  final VoidCallback aoVerDetalhes;

  @override
  Widget build(BuildContext context) {
    final total = titulos.fold<double>(0, (a, t) => a + t.valor);
    final proximo = titulos.first; // já vêm por vencimento
    final vencido = proximo.vencido(agora);
    return Card(
      key: const Key('cartao-titulos'),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Títulos pendentes',
              style: TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w800,
                color: Cores.marinho,
              ),
            ),
            const SizedBox(height: 6),
            Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      FittedBox(
                        fit: BoxFit.scaleDown,
                        alignment: Alignment.centerLeft,
                        child: Text(
                          moeda(total),
                          style: const TextStyle(
                            fontSize: 24,
                            fontWeight: FontWeight.w800,
                            color: Cores.marinho,
                          ),
                        ),
                      ),
                      Text(
                        'Vencimento: ${dataCompleta(proximo.vencimento)}',
                        style: TextStyle(
                          color: vencido ? Cores.erro : Cores.textoSuave,
                          fontWeight: vencido
                              ? FontWeight.w700
                              : FontWeight.w400,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                FilledButton(
                  key: const Key('ver-detalhes-titulos'),
                  onPressed: aoVerDetalhes,
                  style: FilledButton.styleFrom(
                    minimumSize: const Size(48, 48),
                    padding: const EdgeInsets.symmetric(horizontal: 18),
                  ),
                  child: const Text(
                    'Ver detalhes',
                    style: TextStyle(fontSize: 14),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
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
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: vencido ? const Color(0xFFF0B5B5) : Cores.linha,
        ),
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Título ${titulo.numero}',
                  style: TextStyle(fontWeight: FontWeight.w700, color: cor),
                ),
                Text(
                  'Vence em ${dataCompleta(titulo.vencimento)}',
                  style: TextStyle(
                    color: vencido ? Cores.erro : Cores.textoSuave,
                    fontSize: 13,
                  ),
                ),
              ],
            ),
          ),
          if (vencido)
            const Padding(
              padding: EdgeInsets.only(right: 8),
              child: Etiqueta('Vencido', cor: Cores.erro),
            ),
          Text(
            moeda(titulo.valor),
            style: TextStyle(fontWeight: FontWeight.w800, color: cor),
          ),
        ],
      ),
    );
  }
}
