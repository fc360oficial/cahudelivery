import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../core/carrinho_store.dart';
import '../../core/formatadores.dart';
import '../../core/tenant_theme.dart';
import '../../widgets/estados.dart';
import '../profile/endereco_form_screen.dart';
import 'pedido_sucesso_screen.dart';

/// Checkout em 3 passos (fluxo aprovado): 1. endereço de entrega,
/// 2. pagamento (PIX/boleto — cobrança emitida pelo ERP), 3. revisão +
/// observações. Confirmar → POST /v1/pedidos → tela de sucesso.
class CheckoutScreen extends StatefulWidget {
  const CheckoutScreen({super.key});

  @override
  State<CheckoutScreen> createState() => _CheckoutScreenState();
}

class _CheckoutScreenState extends State<CheckoutScreen> {
  int _passo = 0;
  List<Map<String, dynamic>>? _enderecos;
  String? _erro;
  String? _enderecoId;
  String _tipoEntrega = 'entrega';
  String _pagamento = 'pix';
  String? _condicaoPagamento;
  final _observacoes = TextEditingController();
  bool _confirmando = false;

  @override
  void initState() {
    super.initState();
    _carregarEnderecos();
  }

  @override
  void dispose() {
    _observacoes.dispose();
    super.dispose();
  }

  Future<void> _carregarEnderecos() async {
    setState(() {
      _enderecos = null;
      _erro = null;
    });
    try {
      final r = await ApiClient.instance.get('/perfil/enderecos') as List;
      if (!mounted) return;
      final lista = List<Map<String, dynamic>>.from(r);
      setState(() {
        _enderecos = lista;
        _enderecoId ??= lista
            .cast<Map<String, dynamic>?>()
            .firstWhere((e) => e!['padrao'] == true, orElse: () => lista.isEmpty ? null : lista.first)
            ?['id'] as String?;
      });
    } on ApiException catch (e) {
      if (mounted) setState(() => _erro = e.message);
    } catch (_) {
      if (mounted) setState(() => _erro = 'Sem conexão — verifique sua internet');
    }
  }

  Future<void> _novoEndereco() async {
    final criado = await Navigator.of(context).push<Map<String, dynamic>>(
        MaterialPageRoute(builder: (_) => const EnderecoFormScreen()));
    if (criado != null) {
      setState(() => _enderecoId = criado['id'] as String?);
      _carregarEnderecos();
    }
  }

  Future<void> _confirmar() async {
    setState(() => _confirmando = true);
    try {
      final pedido = await ApiClient.instance.post('/pedidos', {
        if (_tipoEntrega == 'entrega') 'enderecoId': _enderecoId,
        'tipoEntrega': _tipoEntrega,
        'formaPagamento': _pagamento,
        if (_pagamento == 'boleto' && _condicaoPagamento != null)
          'condicaoPagamento': _condicaoPagamento,
        if (_observacoes.text.trim().isNotEmpty) 'observacoes': _observacoes.text.trim(),
      }) as Map<String, dynamic>;
      CarrinhoStore.instance.limpar();
      if (!mounted) return;
      Navigator.of(context).pushReplacement(
          MaterialPageRoute(builder: (_) => PedidoSucessoScreen(pedido: pedido)));
    } on ApiException catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(const SnackBar(content: Text('Sem conexão — tente novamente')));
      }
    } finally {
      if (mounted) setState(() => _confirmando = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Finalizar pedido')),
      body: Column(
        children: [
          _indicadorPassos(),
          Expanded(
            child: switch (_passo) {
              0 => _passoEndereco(),
              1 => _passoPagamento(),
              _ => _passoRevisao(),
            },
          ),
        ],
      ),
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Row(
            children: [
              if (_passo > 0) ...[
                Expanded(
                  child: OutlinedButton(
                    onPressed: () => setState(() => _passo--),
                    style: OutlinedButton.styleFrom(
                      minimumSize: const Size.fromHeight(52),
                      shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(14)),
                    ),
                    child: const Text('Voltar'),
                  ),
                ),
                const SizedBox(width: 12),
              ],
              Expanded(
                flex: 2,
                child: FilledButton(
                  onPressed: _confirmando
                      ? null
                      : _passo == 0
                          ? ((_tipoEntrega == 'retirada' || _enderecoId != null)
                              ? () => setState(() => _passo = 1)
                              : null)
                          : _passo == 1
                              ? () => setState(() => _passo = 2)
                              : _confirmar,
                  child: _confirmando
                      ? const SizedBox(
                          width: 22, height: 22,
                          child: CircularProgressIndicator(
                              strokeWidth: 2.5, color: Colors.white))
                      : Text(_passo == 2 ? 'Confirmar pedido' : 'Continuar'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _indicadorPassos() {
    const nomes = ['Entrega', 'Pagamento', 'Revisão'];
    final cor = Theme.of(context).colorScheme.primary;
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
      child: Row(
        children: List.generate(3, (i) {
          final ativo = i <= _passo;
          return Expanded(
            child: Column(
              children: [
                Row(
                  children: [
                    if (i > 0)
                      Expanded(
                          child: Container(
                              height: 2,
                              color: ativo ? cor : Colors.grey.shade300)),
                    CircleAvatar(
                      radius: 13,
                      backgroundColor: ativo ? cor : Colors.grey.shade300,
                      child: i < _passo
                          ? const Icon(Icons.check, size: 15, color: Colors.white)
                          : Text('${i + 1}',
                              style: TextStyle(
                                  fontSize: 12,
                                  fontWeight: FontWeight.w700,
                                  color: ativo ? Colors.white : Colors.grey.shade600)),
                    ),
                    if (i < 2)
                      Expanded(
                          child: Container(
                              height: 2,
                              color: i < _passo ? cor : Colors.grey.shade300)),
                  ],
                ),
                const SizedBox(height: 4),
                Text(nomes[i],
                    style: TextStyle(
                        fontSize: 11,
                        fontWeight: ativo ? FontWeight.w700 : FontWeight.w400,
                        color: ativo ? Colors.black87 : Colors.grey.shade500)),
              ],
            ),
          );
        }),
      ),
    );
  }

  /// Alterna entre "Entrega" e "Retirar na loja" (retirada não exige endereço
  /// — o pedido vai ao ERP sem endereço de entrega).
  Widget _toggleTipoEntrega() {
    final cor = Theme.of(context).colorScheme.primary;
    Widget opcao(String valor, IconData icone, String rotulo) {
      final ativo = _tipoEntrega == valor;
      return Expanded(
        child: InkWell(
          onTap: () => setState(() => _tipoEntrega = valor),
          borderRadius: BorderRadius.circular(14),
          child: Container(
            padding: const EdgeInsets.symmetric(vertical: 12),
            decoration: BoxDecoration(
              color: ativo ? cor.withValues(alpha: 0.12) : Colors.grey.shade100,
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: ativo ? cor : Colors.transparent, width: 1.5),
            ),
            child: Column(
              children: [
                Icon(icone, color: ativo ? cor : Colors.grey.shade600),
                const SizedBox(height: 4),
                Text(rotulo,
                    style: TextStyle(
                        fontSize: 12.5,
                        fontWeight: FontWeight.w700,
                        color: ativo ? cor : Colors.grey.shade700)),
              ],
            ),
          ),
        ),
      );
    }

    return Row(
      children: [
        opcao('entrega', Icons.local_shipping_outlined, 'Entrega'),
        const SizedBox(width: 10),
        opcao('retirada', Icons.storefront_outlined, 'Retirar na loja'),
      ],
    );
  }

  // ---------- Passo 1: endereço ----------
  Widget _passoEndereco() {
    if (_erro != null) {
      return EstadoErro(mensagem: _erro, onTentarNovamente: _carregarEnderecos);
    }
    if (_enderecos == null) {
      return ListView(
        physics: const NeverScrollableScrollPhysics(),
        padding: const EdgeInsets.all(16),
        children: List.generate(
            2,
            (_) => const Padding(
                padding: EdgeInsets.only(bottom: 12),
                child: Esqueleto(height: 90, radius: 16))),
      );
    }
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        const Text('Como você quer receber?',
            style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800)),
        const SizedBox(height: 12),
        _toggleTipoEntrega(),
        const SizedBox(height: 16),
        if (_tipoEntrega == 'retirada')
          Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: Colors.grey.shade100,
              borderRadius: BorderRadius.circular(14),
            ),
            child: Row(
              children: [
                Icon(Icons.storefront_outlined, color: Colors.grey.shade700, size: 22),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(
                    'Seu pedido ficará disponível para retirada na distribuidora '
                    'após o faturamento. Sem custo de entrega.',
                    style: TextStyle(fontSize: 13, color: Colors.grey.shade800, height: 1.4),
                  ),
                ),
              ],
            ),
          )
        else if (_enderecos!.isEmpty)
          EstadoVazio(
            icone: Icons.location_on_outlined,
            titulo: 'Nenhum endereço cadastrado',
            mensagem: 'Cadastre o endereço de entrega do seu negócio.',
            acaoLabel: 'Cadastrar endereço',
            onAcao: _novoEndereco,
          )
        else ...[
          for (final e in _enderecos!)
            Card(
              margin: const EdgeInsets.only(bottom: 10),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(16),
                side: BorderSide(
                  color: _enderecoId == e['id']
                      ? Theme.of(context).colorScheme.primary
                      : Colors.grey.shade200,
                  width: _enderecoId == e['id'] ? 2 : 1,
                ),
              ),
              child: ListTile(
                onTap: () => setState(() => _enderecoId = e['id'] as String),
                title: Text(
                    e['apelido'] ?? '${e['logradouro']}, ${e['numero']}',
                    style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14)),
                subtitle: Text(
                  '${e['logradouro']}, ${e['numero']}'
                  '${e['complemento'] != null ? ' — ${e['complemento']}' : ''}\n'
                  '${e['bairro']} · ${e['cidade']}/${e['uf']} · CEP ${cep(e['cep'])}',
                  style: const TextStyle(fontSize: 12.5, height: 1.4),
                ),
                isThreeLine: true,
                trailing: _enderecoId == e['id']
                    ? Icon(Icons.check_circle,
                        color: Theme.of(context).colorScheme.primary)
                    : Icon(Icons.circle_outlined, color: Colors.grey.shade300),
              ),
            ),
          OutlinedButton.icon(
            onPressed: _novoEndereco,
            style: OutlinedButton.styleFrom(
              minimumSize: const Size.fromHeight(52),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
            ),
            icon: const Icon(Icons.add),
            label: const Text('Novo endereço'),
          ),
        ],
      ],
    );
  }

  // ---------- Passo 2: pagamento ----------
  Widget _passoPagamento() {
    Widget opcao(String valor, IconData icone, String titulo, String descricao) {
      final ativo = _pagamento == valor;
      final cor = Theme.of(context).colorScheme.primary;
      return Card(
        margin: const EdgeInsets.only(bottom: 10),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
          side: BorderSide(
              color: ativo ? cor : Colors.grey.shade200, width: ativo ? 2 : 1),
        ),
        child: ListTile(
          onTap: () => setState(() => _pagamento = valor),
          leading: Icon(icone, color: ativo ? cor : Colors.grey.shade600, size: 30),
          title: Text(titulo,
              style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15)),
          subtitle: Text(descricao, style: const TextStyle(fontSize: 12.5)),
          trailing: ativo ? Icon(Icons.check_circle, color: cor) : null,
          contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
        ),
      );
    }

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        const Text('Como pagar?',
            style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800)),
        const SizedBox(height: 12),
        opcao('pix', Icons.qr_code_2, 'PIX',
            'Código copia-e-cola liberado após o faturamento'),
        opcao('boleto', Icons.receipt_outlined, 'Boleto',
            'Boleto emitido junto com a nota fiscal'),
        if (_pagamento == 'boleto') _condicoesBoleto(),
        const SizedBox(height: 8),
        Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: Colors.blue.shade50,
            borderRadius: BorderRadius.circular(14),
          ),
          child: Row(
            children: [
              Icon(Icons.info_outline, color: Colors.blue.shade700, size: 20),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  'A cobrança é gerada pela distribuidora no faturamento do pedido. '
                  'Você acompanha tudo na aba Pedidos.',
                  style: TextStyle(fontSize: 12.5, color: Colors.blue.shade900, height: 1.4),
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }

  /// Prazos de boleto disponíveis pro cliente. Placeholder até a integração
  /// com o ERP trazer o limite de crédito real por cliente (Fase 4) — por
  /// ora, lista configurável pela retaguarda (config 'condicoes_boleto'),
  /// igual pra todo mundo.
  Widget _condicoesBoleto() {
    final lista = (TenantTheme.instance.configuracoes['condicoes_boleto'] as List?)
            ?.cast<String>() ??
        const ['À vista'];
    _condicaoPagamento ??= lista.first;
    final cor = Theme.of(context).colorScheme.primary;
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Wrap(
        spacing: 8,
        runSpacing: 8,
        children: [
          for (final c in lista)
            ChoiceChip(
              label: Text(c),
              selected: _condicaoPagamento == c,
              onSelected: (_) => setState(() => _condicaoPagamento = c),
              selectedColor: cor.withValues(alpha: 0.15),
              labelStyle: TextStyle(
                fontWeight: FontWeight.w700,
                color: _condicaoPagamento == c ? cor : Colors.grey.shade700,
              ),
              side: BorderSide(color: _condicaoPagamento == c ? cor : Colors.grey.shade300),
            ),
        ],
      ),
    );
  }

  // ---------- Passo 3: revisão ----------
  Widget _passoRevisao() {
    final store = CarrinhoStore.instance;
    final endereco = _enderecos
        ?.cast<Map<String, dynamic>?>()
        .firstWhere((e) => e!['id'] == _enderecoId, orElse: () => null);
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        const Text('Revise seu pedido',
            style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800)),
        const SizedBox(height: 12),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _linhaResumo(
                  _tipoEntrega == 'retirada'
                      ? Icons.storefront_outlined
                      : Icons.location_on_outlined,
                  _tipoEntrega == 'retirada'
                      ? 'Retirar na distribuidora'
                      : (endereco == null
                          ? '—'
                          : '${endereco['logradouro']}, ${endereco['numero']} — ${endereco['cidade']}/${endereco['uf']}'),
                ),
                const Divider(height: 20),
                _linhaResumo(
                  _pagamento == 'pix' ? Icons.qr_code_2 : Icons.receipt_outlined,
                  _pagamento == 'pix'
                      ? 'PIX'
                      : 'Boleto — ${_condicaoPagamento ?? 'À vista'}',
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 12),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Column(
              children: [
                for (final i in store.itens)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: Row(
                      children: [
                        Text('${asDouble(i['quantidade']).toInt()}x',
                            style: TextStyle(
                                fontSize: 13,
                                fontWeight: FontWeight.w700,
                                color: Colors.grey.shade600)),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(i['nome'] ?? '',
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(fontSize: 13.5)),
                        ),
                        Text(moeda(asDouble(i['preco_atual']) * asDouble(i['quantidade'])),
                            style: const TextStyle(
                                fontSize: 13.5, fontWeight: FontWeight.w600)),
                      ],
                    ),
                  ),
                const Divider(height: 16),
                Row(
                  children: [
                    const Expanded(
                        child: Text('Total',
                            style: TextStyle(fontSize: 16, fontWeight: FontWeight.w800))),
                    Text(moeda(store.subtotal),
                        style: TextStyle(
                            fontSize: 18,
                            fontWeight: FontWeight.w800,
                            color: Theme.of(context).colorScheme.primary)),
                  ],
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _observacoes,
          maxLines: 3,
          decoration: const InputDecoration(
            labelText: 'Observações (opcional)',
            hintText: 'Ex.: entregar no período da manhã',
            alignLabelWithHint: true,
          ),
        ),
      ],
    );
  }

  Widget _linhaResumo(IconData icone, String texto) => Row(
        children: [
          Icon(icone, size: 20, color: Colors.grey.shade600),
          const SizedBox(width: 10),
          Expanded(
              child: Text(texto,
                  style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w600))),
        ],
      );
}
