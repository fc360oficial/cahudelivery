import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/api_client.dart';
import '../../core/formatadores.dart';
import '../../widgets/estados.dart';
import '../orders/pedido_detalhe_screen.dart';

/// Lista de notas fiscais do cliente (GET /v1/pedidos/notas) — só pedidos
/// que já têm NF emitida, paginado por scroll infinito.
class NotasFiscaisScreen extends StatefulWidget {
  const NotasFiscaisScreen({super.key});

  @override
  State<NotasFiscaisScreen> createState() => _NotasFiscaisScreenState();
}

class _NotasFiscaisScreenState extends State<NotasFiscaisScreen> {
  static const _porPagina = 20;

  final _scroll = ScrollController();
  final List<Map<String, dynamic>> _notas = [];
  int _pagina = 1;
  bool _carregando = false;
  bool _fim = false;
  String? _erro;

  @override
  void initState() {
    super.initState();
    _scroll.addListener(() {
      if (_scroll.position.pixels > _scroll.position.maxScrollExtent - 300) {
        _carregarMais();
      }
    });
    _recarregar();
  }

  @override
  void dispose() {
    _scroll.dispose();
    super.dispose();
  }

  Future<void> _recarregar() async {
    setState(() {
      _notas.clear();
      _pagina = 1;
      _fim = false;
      _erro = null;
    });
    await _carregarMais();
  }

  Future<void> _carregarMais() async {
    if (_carregando || _fim) return;
    setState(() => _carregando = true);
    try {
      final r = await ApiClient.instance.get('/pedidos/notas?pagina=$_pagina')
          as Map<String, dynamic>;
      final novos = List<Map<String, dynamic>>.from(r['dados'] as List? ?? const []);
      if (!mounted) return;
      setState(() {
        _notas.addAll(novos);
        _pagina++;
        if (novos.length < _porPagina) _fim = true;
      });
    } on ApiException catch (e) {
      if (mounted) setState(() => _erro = e.message);
    } catch (_) {
      if (mounted) setState(() => _erro = 'Sem conexão — verifique sua internet');
    } finally {
      if (mounted) setState(() => _carregando = false);
    }
  }

  Future<void> _abrirPdf(String url) async {
    final ok = await launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);
    if (!ok && mounted) {
      ScaffoldMessenger.of(context)
          .showSnackBar(const SnackBar(content: Text('Não foi possível abrir o arquivo')));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Notas fiscais')),
      body: _corpo(),
    );
  }

  Widget _corpo() {
    if (_erro != null && _notas.isEmpty) {
      return EstadoErro(mensagem: _erro, onTentarNovamente: _recarregar);
    }
    if (_carregando && _notas.isEmpty) {
      return ListView(
        physics: const NeverScrollableScrollPhysics(),
        padding: const EdgeInsets.all(16),
        children: List.generate(
            5,
            (_) => const Padding(
                padding: EdgeInsets.only(bottom: 12),
                child: Esqueleto(height: 76, radius: 16))),
      );
    }
    if (_notas.isEmpty) {
      return const EstadoVazio(
        icone: Icons.description_outlined,
        titulo: 'Nenhuma nota fiscal ainda',
        mensagem: 'Suas notas fiscais aparecem aqui assim que a distribuidora faturar seus pedidos.',
      );
    }
    return RefreshIndicator(
      onRefresh: _recarregar,
      child: ListView.separated(
        controller: _scroll,
        padding: const EdgeInsets.all(16),
        itemCount: _notas.length + (_fim ? 0 : 1),
        separatorBuilder: (_, i) => const SizedBox(height: 10),
        itemBuilder: (_, i) {
          if (i >= _notas.length) {
            return const Center(
                child: Padding(
                    padding: EdgeInsets.all(16),
                    child: SizedBox(
                        width: 26, height: 26,
                        child: CircularProgressIndicator(strokeWidth: 2.5))));
          }
          final n = _notas[i];
          final pdfUrl = n['pdf_url'] as String?;
          return Card(
            clipBehavior: Clip.antiAlias,
            child: ListTile(
              onTap: () async {
                await Navigator.of(context).push(MaterialPageRoute(
                    builder: (_) =>
                        PedidoDetalheScreen(pedidoId: n['pedido_id'] as String)));
              },
              contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              title: Row(
                children: [
                  Expanded(
                    child: Text('NF-e nº ${n['numero_nf']}',
                        style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700)),
                  ),
                  Text(moeda(n['total']),
                      style: const TextStyle(fontSize: 14.5, fontWeight: FontWeight.w800)),
                ],
              ),
              subtitle: Padding(
                padding: const EdgeInsets.only(top: 4),
                child: Text('${dataCurta(n['emitida_em'])} · Pedido nº ${n['numero']}',
                    style: TextStyle(fontSize: 12.5, color: Colors.grey.shade600)),
              ),
              trailing: IconButton(
                icon: const Icon(Icons.picture_as_pdf_outlined),
                onPressed: pdfUrl == null ? null : () => _abrirPdf(pdfUrl),
              ),
            ),
          );
        },
      ),
    );
  }
}