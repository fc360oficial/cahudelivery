import 'package:flutter/material.dart';

import '../app_servicos.dart';
import '../core/formatadores.dart';
import '../core/tema.dart';
import '../data/modelos.dart';
import '../widgets/comuns.dart';
import '../widgets/foto_campo.dart';
import 'home_shell.dart';
import 'nao_entregue_page.dart';

/// Ocorrência numa nota da parada: avaria (foto obrigatória), falta, troca ou item recusado.
/// A entrega continua; o CD resolve com o cliente pelo Dlinks.
class OcorrenciaPage extends StatefulWidget {
  const OcorrenciaPage({super.key, required this.chave});
  final String chave;

  @override
  State<OcorrenciaPage> createState() => _OcorrenciaPageState();
}

class _OcorrenciaPageState extends State<OcorrenciaPage> {
  static const _tipos = <(String, IconData, String, String)>[
    ('avaria', Icons.warning_amber_rounded, 'Produto avariado', 'Amassado, vazando ou quebrado'),
    ('falta', Icons.remove_circle_outline_rounded, 'Faltou produto', 'Está na nota e não veio no caminhão'),
    ('troca', Icons.swap_horiz_rounded, 'Veio produto trocado', 'Diferente do que está na nota'),
    ('recusa_item', Icons.do_not_disturb_on_outlined, 'Cliente não quis um item', 'Recusou parte da entrega'),
  ];

  String _tipo = 'avaria';
  ItemParada? _item;
  double _quantidade = 1;
  String? _foto;
  final _obs = TextEditingController();
  String? _erro;
  bool _enviando = false;

  @override
  void dispose() {
    _obs.dispose();
    super.dispose();
  }

  Future<void> _escolherItem(Parada p) async {
    final escolhido = await showModalBottomSheet<ItemParada>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (c) => SafeArea(
        child: ConstrainedBox(
          constraints: BoxConstraints(maxHeight: MediaQuery.of(c).size.height * 0.7),
          child: ListView(
            shrinkWrap: true,
            children: [
              const Padding(padding: EdgeInsets.fromLTRB(20, 0, 20, 8), child: Text('Qual produto?', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800))),
              for (final i in p.itens)
                ListTile(
                  title: Text(i.descricao, style: const TextStyle(fontWeight: FontWeight.w700)),
                  subtitle: Text('${i.notaNumero == null ? '' : 'Nota ${i.notaNumero} · '}na nota: ${numero(i.quantidade)}'),
                  onTap: () => Navigator.pop(c, i),
                ),
            ],
          ),
        ),
      ),
    );
    if (escolhido != null) setState(() => _item = escolhido);
  }

  Future<void> _salvar(Parada p) async {
    if (_tipo == 'avaria' && _foto == null) return setState(() => _erro = 'Tire a foto da avaria.');
    if (p.itens.isNotEmpty && _item == null) return setState(() => _erro = 'Escolha o produto.');
    setState(() {
      _erro = null;
      _enviando = true;
    });
    // A ocorrência fica presa à nota do produto escolhido (ou à primeira nota da parada).
    final indiceNota = _item == null ? 0 : p.notas.indexWhere((n) => n.numero == _item!.notaNumero);
    final linhaId = p.linhaIds[indiceNota < 0 || indiceNota >= p.linhaIds.length ? 0 : indiceNota];
    await Servicos.of(context).carga.ocorrencia(p, linhaId: linhaId, tipo: _tipo, item: _item, quantidade: _quantidade, observacao: _obs.text, foto: _foto);
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Ocorrência registrada. A entrega continua.')));
    Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    final p = Servicos.of(context).carga.carga?.paradaPorChave(widget.chave);
    if (p == null) return Scaffold(appBar: AppBar(title: const Text('Ocorrência')));
    final maximo = _item?.quantidade ?? 9999;
    return Scaffold(
      appBar: AppBar(title: const Text('Ocorrência')),
      bottomNavigationBar: const BarraNavegacaoEmpilhada(),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          const Text('O que aconteceu?', style: TextStyle(fontSize: 22, fontWeight: FontWeight.w800, color: Cores.marinho)),
          Text('${p.cliente} · ${p.rotuloNotas}', style: const TextStyle(color: Cores.textoSuave, fontWeight: FontWeight.w700)),
          const SizedBox(height: 12),
          for (final (codigo, icone, titulo, texto) in _tipos)
            CartaoOpcao(icone: icone, titulo: titulo, texto: texto, marcado: _tipo == codigo, aoTocar: () => setState(() => _tipo = codigo)),
          const SizedBox(height: 4),
          Cartao(
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Row(
                children: [
                  Expanded(
                    child: InkWell(
                      onTap: p.itens.isEmpty ? null : () => _escolherItem(p),
                      child: Row(children: [
                        const IconeCaixa(Icons.inventory_2_outlined, tamanho: 44),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                            Text(_item?.descricao ?? (p.itens.isEmpty ? 'Produto' : 'Escolher o produto'),
                                maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
                            if (_item != null) Text('Na nota: ${numero(_item!.quantidade)}', style: const TextStyle(color: Cores.textoSuave, fontSize: 13.5)),
                          ]),
                        ),
                      ]),
                    ),
                  ),
                  Container(
                    decoration: BoxDecoration(border: Border.all(color: Cores.linha, width: 1.5), borderRadius: BorderRadius.circular(30)),
                    child: Row(mainAxisSize: MainAxisSize.min, children: [
                      IconButton(
                        tooltip: 'Diminuir quantidade',
                        onPressed: _quantidade > 1 ? () => setState(() => _quantidade--) : null,
                        icon: const Icon(Icons.remove_rounded, color: Cores.azul),
                      ),
                      Text(numero(_quantidade), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 18)),
                      IconButton(
                        tooltip: 'Aumentar quantidade',
                        onPressed: _quantidade < maximo ? () => setState(() => _quantidade++) : null,
                        icon: const Icon(Icons.add_rounded, color: Cores.azul),
                      ),
                    ]),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 12),
          FotoCampo(rotulo: _tipo == 'avaria' ? 'Tirar foto da avaria (obrigatória)' : 'Tirar foto (opcional)', caminho: _foto, aoMudar: (f) => setState(() => _foto = f), altura: 70),
          const SizedBox(height: 12),
          TextField(controller: _obs, decoration: const InputDecoration(labelText: 'Observação (opcional)')),
          if (_erro != null) ...[const SizedBox(height: 12), CaixaAviso(tom: TomAviso.erro, texto: _erro!)],
          const SizedBox(height: 12),
          const CaixaAviso(tom: TomAviso.info, texto: 'A entrega continua. O CD recebe na hora.'),
          const SizedBox(height: 16),
          FilledButton(onPressed: _enviando ? null : () => _salvar(p), child: const Text('Salvar ocorrência')),
        ],
      ),
    );
  }
}
