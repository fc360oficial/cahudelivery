import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/api_client.dart';
import '../../core/carrinho_store.dart';
import '../../core/formatadores.dart';
import '../../widgets/estados.dart';
import 'status_pedido.dart';

/// Detalhe do pedido (GET /v1/pedidos/:id): linha do tempo, itens,
/// cobrança (PIX copia-e-cola / boleto) e NF quando o ERP fatura.
class PedidoDetalheScreen extends StatefulWidget {
  const PedidoDetalheScreen({super.key, required this.pedidoId});
  final String pedidoId;

  @override
  State<PedidoDetalheScreen> createState() => _PedidoDetalheScreenState();
}

class _PedidoDetalheScreenState extends State<PedidoDetalheScreen> {
  Map<String, dynamic>? _p;
  String? _erro;
  bool _repetindo = false;

  @override
  void initState() {
    super.initState();
    _carregar();
  }

  Future<void> _carregar() async {
    setState(() {
      _p = null;
      _erro = null;
    });
    try {
      final r = await ApiClient.instance.get('/pedidos/${widget.pedidoId}')
          as Map<String, dynamic>;
      if (mounted) setState(() => _p = r);
    } on ApiException catch (e) {
      if (mounted) setState(() => _erro = e.message);
    } catch (_) {
      if (mounted) setState(() => _erro = 'Sem conexão — verifique sua internet');
    }
  }

  Future<void> _copiar(String texto, String aviso) async {
    await Clipboard.setData(ClipboardData(text: texto));
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(aviso), behavior: SnackBarBehavior.floating));
    }
  }

  Future<void> _abrirUrl(String url) async {
    final ok = await launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);
    if (!ok && mounted) {
      ScaffoldMessenger.of(context)
          .showSnackBar(const SnackBar(content: Text('Não foi possível abrir o arquivo')));
    }
  }

  Future<void> _repetir() async {
    setState(() => _repetindo = true);
    try {
      final r = await ApiClient.instance.post('/pedidos/${widget.pedidoId}/repetir');
      // A API devolve o carrinho atualizado — reaproveita no store global.
      CarrinhoStore.instance.limpar();
      await CarrinhoStore.instance.carregar();
      if (!mounted) return;
      final itens = (r as Map<String, dynamic>)['itens'] as List? ?? const [];
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text('${itens.length} produto(s) adicionados ao carrinho'),
        behavior: SnackBarBehavior.floating,
      ));
      Navigator.of(context).popUntil((rota) => rota.isFirst);
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
      if (mounted) setState(() => _repetindo = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_erro != null) {
      return Scaffold(
          appBar: AppBar(),
          body: EstadoErro(mensagem: _erro, onTentarNovamente: _carregar));
    }
    if (_p == null) {
      return Scaffold(
        appBar: AppBar(),
        body: ListView(
          physics: const NeverScrollableScrollPhysics(),
          padding: const EdgeInsets.all(16),
          children: const [
            Esqueleto(height: 90, radius: 16),
            SizedBox(height: 12),
            Esqueleto(height: 200, radius: 16),
            SizedBox(height: 12),
            Esqueleto(height: 140, radius: 16),
          ],
        ),
      );
    }

    final p = _p!;
    final eventos = List<Map<String, dynamic>>.from(p['eventos'] as List? ?? const []);
    final itens = List<Map<String, dynamic>>.from(p['itens'] as List? ?? const []);
    final cobranca = p['cobranca'] as Map<String, dynamic>?;
    final nota = p['nota'] as Map<String, dynamic>?;
    final endereco = p['endereco_snapshot_json'] as Map<String, dynamic>?;

    return Scaffold(
      appBar: AppBar(title: Text('Pedido nº ${p['numero']}')),
      body: RefreshIndicator(
        onRefresh: _carregar,
        child: ListView(
          padding: EdgeInsets.fromLTRB(16, 16, 16, 16 + MediaQuery.of(context).padding.bottom),
          children: [
            // Cabeçalho: status + total
            Card(
              child: Padding(
                padding: const EdgeInsets.all(14),
                child: Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          ChipStatus(status: p['status'] as String?),
                          const SizedBox(height: 8),
                          Text(dataHora(p['criado_em']),
                              style: TextStyle(
                                  fontSize: 12.5, color: Colors.grey.shade600)),
                        ],
                      ),
                    ),
                    Text(moeda(p['total']),
                        style: TextStyle(
                            fontSize: 22,
                            fontWeight: FontWeight.w800,
                            color: Theme.of(context).colorScheme.primary)),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 12),

            // Cobrança (aparece quando o ERP fatura)
            if (cobranca != null) _cartaoCobranca(cobranca),

            // Nota fiscal
            if (nota != null) _cartaoNota(nota),

            // Linha do tempo
            if (eventos.isNotEmpty) ...[
              _titulo('Acompanhamento'),
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(14),
                  child: Column(
                    children: [
                      for (var i = 0; i < eventos.length; i++)
                        _eventoTimeline(eventos[i], i == eventos.length - 1),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 12),
            ],

            // Itens
            _titulo('Itens (${itens.length})'),
            Card(
              child: Padding(
                padding: const EdgeInsets.all(14),
                child: Column(
                  children: [
                    for (final i in itens)
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
                              child: Text(i['descricao'] ?? '',
                                  maxLines: 2,
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(fontSize: 13.5)),
                            ),
                            Text(moeda(i['total']),
                                style: const TextStyle(
                                    fontSize: 13.5, fontWeight: FontWeight.w600)),
                          ],
                        ),
                      ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 12),

            // Entrega
            if (endereco != null) ...[
              _titulo('Entrega'),
              Card(
                child: ListTile(
                  leading: Icon(Icons.location_on_outlined,
                      color: Colors.grey.shade600),
                  title: Text(
                    '${endereco['logradouro']}, ${endereco['numero']}'
                    '${endereco['complemento'] != null ? ' — ${endereco['complemento']}' : ''}',
                    style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w600),
                  ),
                  subtitle: Text(
                      '${endereco['bairro']} · ${endereco['cidade']}/${endereco['uf']} · CEP ${cep('${endereco['cep']}')}',
                      style: const TextStyle(fontSize: 12.5)),
                ),
              ),
              const SizedBox(height: 12),
            ] else if (p['tipo_entrega'] == 'retirada') ...[
              _titulo('Entrega'),
              Card(
                child: ListTile(
                  leading: Icon(Icons.storefront_outlined, color: Colors.grey.shade600),
                  title: const Text('Retirada na distribuidora',
                      style: TextStyle(fontSize: 13.5, fontWeight: FontWeight.w600)),
                ),
              ),
              const SizedBox(height: 12),
            ],

            if ((p['observacoes'] ?? '').toString().isNotEmpty) ...[
              _titulo('Observações'),
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(14),
                  child: Text('${p['observacoes']}',
                      style: const TextStyle(fontSize: 13.5, height: 1.4)),
                ),
              ),
              const SizedBox(height: 12),
            ],

            const SizedBox(height: 8),
            OutlinedButton.icon(
              onPressed: _repetindo ? null : _repetir,
              style: OutlinedButton.styleFrom(
                minimumSize: const Size.fromHeight(52),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
              ),
              icon: _repetindo
                  ? const SizedBox(
                      width: 18, height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2))
                  : const Icon(Icons.replay),
              label: const Text('Repetir pedido'),
            ),
          ],
        ),
      ),
    );
  }

  Widget _titulo(String t) => Padding(
        padding: const EdgeInsets.only(bottom: 8, left: 2),
        child:
            Text(t, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w800)),
      );

  Widget _eventoTimeline(Map<String, dynamic> e, bool ultimo) {
    final s = StatusPedido.de(e['status'] as String?);
    return IntrinsicHeight(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Column(
            children: [
              Icon(s.icone, size: 20, color: s.cor),
              if (!ultimo)
                Expanded(
                    child: Container(
                        width: 2,
                        margin: const EdgeInsets.symmetric(vertical: 3),
                        color: Colors.grey.shade300)),
            ],
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Padding(
              padding: EdgeInsets.only(bottom: ultimo ? 0 : 16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(s.rotulo,
                      style:
                          const TextStyle(fontSize: 14, fontWeight: FontWeight.w700)),
                  if ((e['detalhe'] ?? '').toString().isNotEmpty)
                    Text('${e['detalhe']}',
                        style: TextStyle(fontSize: 12.5, color: Colors.grey.shade700)),
                  Text(dataHora(e['em']),
                      style: TextStyle(fontSize: 11.5, color: Colors.grey.shade500)),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _cartaoCobranca(Map<String, dynamic> c) {
    final pago = c['pago_em'] != null;
    final ehPix = c['tipo'] == 'pix';
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _titulo('Pagamento'),
        Card(
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(16),
            side: BorderSide(
                color: pago ? Colors.green.shade200 : Colors.orange.shade200),
          ),
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Icon(ehPix ? Icons.qr_code_2 : Icons.receipt_outlined,
                        color: Colors.grey.shade700),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                          '${ehPix ? 'PIX' : 'Boleto'} · ${moeda(c['valor'])}',
                          style: const TextStyle(
                              fontSize: 15, fontWeight: FontWeight.w700)),
                    ),
                    Container(
                      padding:
                          const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                      decoration: BoxDecoration(
                        color: pago ? Colors.green.shade50 : Colors.orange.shade50,
                        borderRadius: BorderRadius.circular(20),
                      ),
                      child: Text(pago ? 'Pago' : 'Em aberto',
                          style: TextStyle(
                              fontSize: 12,
                              fontWeight: FontWeight.w700,
                              color: pago
                                  ? Colors.green.shade700
                                  : Colors.orange.shade800)),
                    ),
                  ],
                ),
                if (c['vencimento'] != null && !pago) ...[
                  const SizedBox(height: 6),
                  Text('Vencimento: ${dataCurta(c['vencimento'])}',
                      style: TextStyle(fontSize: 12.5, color: Colors.grey.shade700)),
                ],
                if (!pago && ehPix && c['pix_copia_cola'] != null) ...[
                  const SizedBox(height: 12),
                  FilledButton.icon(
                    onPressed: () =>
                        _copiar('${c['pix_copia_cola']}', 'Código PIX copiado!'),
                    icon: const Icon(Icons.copy, size: 18),
                    label: const Text('Copiar código PIX'),
                  ),
                ],
                if (!pago && !ehPix) ...[
                  const SizedBox(height: 12),
                  if (c['linha_digitavel'] != null)
                    FilledButton.icon(
                      onPressed: () => _copiar(
                          '${c['linha_digitavel']}', 'Linha digitável copiada!'),
                      icon: const Icon(Icons.copy, size: 18),
                      label: const Text('Copiar linha digitável'),
                    ),
                  if (c['pdf_url'] != null) ...[
                    const SizedBox(height: 8),
                    OutlinedButton.icon(
                      onPressed: () => _abrirUrl('${c['pdf_url']}'),
                      style: OutlinedButton.styleFrom(
                        minimumSize: const Size.fromHeight(48),
                        shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(14)),
                      ),
                      icon: const Icon(Icons.picture_as_pdf_outlined, size: 18),
                      label: const Text('Abrir boleto (PDF)'),
                    ),
                  ],
                ],
              ],
            ),
          ),
        ),
        const SizedBox(height: 12),
      ],
    );
  }

  Widget _cartaoNota(Map<String, dynamic> n) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _titulo('Nota fiscal'),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('NF-e nº ${n['numero_nf']}',
                    style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700)),
                if (n['emitida_em'] != null)
                  Text('Emitida em ${dataCurta(n['emitida_em'])}',
                      style: TextStyle(fontSize: 12.5, color: Colors.grey.shade600)),
                if (n['chave_acesso'] != null) ...[
                  const SizedBox(height: 8),
                  InkWell(
                    onTap: () =>
                        _copiar('${n['chave_acesso']}', 'Chave de acesso copiada!'),
                    child: Row(
                      children: [
                        Expanded(
                          child: Text('${n['chave_acesso']}',
                              style: TextStyle(
                                  fontSize: 11.5,
                                  fontFamily: 'monospace',
                                  color: Colors.grey.shade700)),
                        ),
                        Icon(Icons.copy, size: 16, color: Colors.grey.shade500),
                      ],
                    ),
                  ),
                ],
                if (n['pdf_url'] != null) ...[
                  const SizedBox(height: 12),
                  OutlinedButton.icon(
                    onPressed: () => _abrirUrl('${n['pdf_url']}'),
                    style: OutlinedButton.styleFrom(
                      minimumSize: const Size.fromHeight(48),
                      shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(14)),
                    ),
                    icon: const Icon(Icons.picture_as_pdf_outlined, size: 18),
                    label: const Text('Abrir DANFE (PDF)'),
                  ),
                ],
              ],
            ),
          ),
        ),
        const SizedBox(height: 12),
      ],
    );
  }
}
