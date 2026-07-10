import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../core/formatadores.dart';
import '../../widgets/estados.dart';
import 'pedido_detalhe_screen.dart';
import 'status_pedido.dart';

/// Aba Pedidos: histórico paginado com status colorido (GET /v1/pedidos).
class PedidosScreen extends StatefulWidget {
  const PedidosScreen({super.key});

  @override
  State<PedidosScreen> createState() => _PedidosScreenState();
}

class _PedidosScreenState extends State<PedidosScreen> {
  static const _porPagina = 20;

  final _scroll = ScrollController();
  final List<Map<String, dynamic>> _pedidos = [];
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
      _pedidos.clear();
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
      final r = await ApiClient.instance.get('/pedidos?pagina=$_pagina')
          as Map<String, dynamic>;
      final novos = List<Map<String, dynamic>>.from(r['dados'] as List? ?? const []);
      if (!mounted) return;
      setState(() {
        _pedidos.addAll(novos);
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

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Meus pedidos')),
      body: _corpo(),
    );
  }

  Widget _corpo() {
    if (_erro != null && _pedidos.isEmpty) {
      return EstadoErro(mensagem: _erro, onTentarNovamente: _recarregar);
    }
    if (_carregando && _pedidos.isEmpty) {
      return ListView(
        physics: const NeverScrollableScrollPhysics(),
        padding: const EdgeInsets.all(16),
        children: List.generate(
            5,
            (_) => const Padding(
                padding: EdgeInsets.only(bottom: 12),
                child: Esqueleto(height: 84, radius: 16))),
      );
    }
    if (_pedidos.isEmpty) {
      return const EstadoVazio(
        icone: Icons.receipt_long_outlined,
        titulo: 'Nenhum pedido ainda',
        mensagem: 'Seus pedidos e o andamento de cada um aparecem aqui.',
      );
    }
    return RefreshIndicator(
      onRefresh: _recarregar,
      child: ListView.separated(
        controller: _scroll,
        padding: const EdgeInsets.all(16),
        itemCount: _pedidos.length + (_fim ? 0 : 1),
        separatorBuilder: (_, i) => const SizedBox(height: 10),
        itemBuilder: (_, i) {
          if (i >= _pedidos.length) {
            return const Center(
                child: Padding(
                    padding: EdgeInsets.all(16),
                    child: SizedBox(
                        width: 26, height: 26,
                        child: CircularProgressIndicator(strokeWidth: 2.5))));
          }
          final p = _pedidos[i];
          return Card(
            clipBehavior: Clip.antiAlias,
            child: ListTile(
              onTap: () async {
                await Navigator.of(context).push(MaterialPageRoute(
                    builder: (_) => PedidoDetalheScreen(pedidoId: p['id'] as String)));
                _recarregar();
              },
              contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              title: Row(
                children: [
                  Expanded(
                    child: Text('Pedido nº ${p['numero']}',
                        style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700)),
                  ),
                  ChipStatus(status: p['status'] as String?),
                ],
              ),
              subtitle: Padding(
                padding: const EdgeInsets.only(top: 6),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(dataHora(p['criado_em']),
                          style: TextStyle(fontSize: 12.5, color: Colors.grey.shade600)),
                    ),
                    Text(moeda(p['total']),
                        style: const TextStyle(
                            fontSize: 14.5, fontWeight: FontWeight.w800)),
                  ],
                ),
              ),
            ),
          );
        },
      ),
    );
  }
}
