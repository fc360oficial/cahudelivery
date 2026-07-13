import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../core/carrinho_store.dart';
import '../../core/formatadores.dart';
import '../../core/tenant_theme.dart';
import '../../widgets/estados.dart';
import '../../widgets/stepper_quantidade.dart';
import '../auth/entrar_ou_criar_screen.dart';
import '../checkout/checkout_screen.dart';

/// Aba Carrinho: itens com stepper e swipe para remover, subtotal em tempo
/// real e barra de progresso do pedido mínimo ("faltam R$ X").
class CarrinhoScreen extends StatelessWidget {
  const CarrinhoScreen({super.key, this.onVerProdutos});
  final VoidCallback? onVerProdutos;

  double get _pedidoMinimo =>
      asDouble((TenantTheme.instance.configuracoes['pedido_minimo']
          as Map<String, dynamic>?)?['valor']);

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Carrinho')),
      body: ListenableBuilder(
        listenable: CarrinhoStore.instance,
        builder: (context, _) {
          final store = CarrinhoStore.instance;
          if (store.carregando && store.itens.isEmpty) {
            return ListView(
              physics: const NeverScrollableScrollPhysics(),
              padding: const EdgeInsets.all(16),
              children: List.generate(
                  4,
                  (_) => const Padding(
                      padding: EdgeInsets.only(bottom: 12),
                      child: Esqueleto(height: 88, radius: 16))),
            );
          }
          if (store.erro != null && store.itens.isEmpty) {
            return EstadoErro(mensagem: store.erro, onTentarNovamente: store.carregar);
          }
          if (store.itens.isEmpty) {
            return EstadoVazio(
              icone: Icons.shopping_cart_outlined,
              titulo: 'Seu carrinho está vazio',
              mensagem: 'Explore o catálogo e adicione produtos.',
              acaoLabel: 'Ver produtos',
              onAcao: onVerProdutos,
            );
          }
          return RefreshIndicator(
            onRefresh: store.carregar,
            child: ListView.separated(
              padding: const EdgeInsets.all(16),
              itemCount: store.itens.length,
              separatorBuilder: (_, i) => const SizedBox(height: 10),
              itemBuilder: (_, i) => _ItemCarrinho(item: store.itens[i]),
            ),
          );
        },
      ),
      bottomNavigationBar: ListenableBuilder(
        listenable: CarrinhoStore.instance,
        builder: (context, _) {
          final store = CarrinhoStore.instance;
          if (store.itens.isEmpty) return const SizedBox.shrink();
          final minimo = _pedidoMinimo;
          final falta = minimo - store.subtotal;
          final atingiu = falta <= 0;
          return SafeArea(
            child: Container(
              padding: const EdgeInsets.fromLTRB(16, 14, 16, 14),
              decoration: BoxDecoration(
                color: Colors.white,
                boxShadow: [
                  BoxShadow(
                      color: Colors.black.withValues(alpha: 0.06),
                      blurRadius: 12,
                      offset: const Offset(0, -4)),
                ],
              ),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  if (minimo > 0) ...[
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            atingiu
                                ? 'Pedido mínimo atingido!'
                                : 'Faltam ${moeda(falta)} para o pedido mínimo',
                            style: TextStyle(
                                fontSize: 13,
                                fontWeight: FontWeight.w600,
                                color: atingiu
                                    ? Colors.green.shade700
                                    : Colors.orange.shade800),
                          ),
                        ),
                        Text('mín. ${moeda(minimo)}',
                            style: TextStyle(fontSize: 12, color: Colors.grey.shade600)),
                      ],
                    ),
                    const SizedBox(height: 6),
                    ClipRRect(
                      borderRadius: BorderRadius.circular(6),
                      child: LinearProgressIndicator(
                        value: minimo > 0 ? (store.subtotal / minimo).clamp(0.0, 1.0) : 1,
                        minHeight: 6,
                        backgroundColor: Colors.grey.shade200,
                        color: atingiu ? Colors.green.shade600 : Colors.orange.shade600,
                      ),
                    ),
                    const SizedBox(height: 12),
                  ],
                  Row(
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text('Subtotal',
                                style: TextStyle(
                                    fontSize: 13, color: Colors.grey.shade600)),
                            Text(moeda(store.subtotal),
                                style: const TextStyle(
                                    fontSize: 20, fontWeight: FontWeight.w800)),
                          ],
                        ),
                      ),
                      Expanded(
                        child: FilledButton(
                          onPressed: atingiu || minimo <= 0
                              ? () async {
                                  if (!ApiClient.instance.logado) {
                                    final ok = await Navigator.of(context).push<bool>(
                                        MaterialPageRoute(
                                            builder: (_) => const EntrarOuCriarScreen()));
                                    if (ok != true) return;
                                    await CarrinhoStore.instance
                                        .carregar(); // carrinho já mesclado pela API
                                  }
                                  if (context.mounted) {
                                    Navigator.of(context).push(MaterialPageRoute(
                                        builder: (_) => const CheckoutScreen()));
                                  }
                                }
                              : null,
                          child: const Text('Finalizar pedido'),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          );
        },
      ),
    );
  }
}

class _ItemCarrinho extends StatelessWidget {
  const _ItemCarrinho({required this.item});
  final Map<String, dynamic> item;

  @override
  Widget build(BuildContext context) {
    final store = CarrinhoStore.instance;
    final produtoId = item['produto_id'] as String;
    final qtd = asDouble(item['quantidade']);
    final preco = asDouble(item['preco_atual']);
    final minima = asDouble(item['qtd_minima']);
    final estoque = asDouble(item['estoque']);

    Future<void> mudar(double v) async {
      try {
        await store.definirQuantidade(produtoId, v);
      } catch (e) {
        if (context.mounted) {
          ScaffoldMessenger.of(context)
              .showSnackBar(SnackBar(content: Text(e.toString())));
        }
      }
    }

    return Dismissible(
      key: ValueKey(produtoId),
      direction: DismissDirection.endToStart,
      background: Container(
        alignment: Alignment.centerRight,
        padding: const EdgeInsets.only(right: 24),
        decoration: BoxDecoration(
            color: Colors.red.shade600, borderRadius: BorderRadius.circular(16)),
        child: const Icon(Icons.delete_outline, color: Colors.white),
      ),
      onDismissed: (_) => store.remover(produtoId).catchError((_) => store.carregar()),
      child: Card(
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(item['nome'] ?? '',
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600)),
                    const SizedBox(height: 4),
                    Text(
                      '${moeda(preco)} / ${item['unidade_venda'] ?? 'UN'}'
                      '${estoque < qtd ? '  •  estoque: ${estoque.toInt()}' : ''}',
                      style: TextStyle(
                          fontSize: 12,
                          color: estoque < qtd ? Colors.red.shade600 : Colors.grey.shade600),
                    ),
                    const SizedBox(height: 8),
                    Text(moeda(preco * qtd),
                        style: TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.w800,
                            color: Theme.of(context).colorScheme.primary)),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              StepperQuantidade(
                quantidade: qtd,
                minimo: minima > 1 ? minima : 1,
                maximo: estoque > 0 ? estoque : null,
                permitirRemover: true,
                compacto: true,
                onMudar: mudar,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
