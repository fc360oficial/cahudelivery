import 'package:flutter/material.dart';

import '../app_servicos.dart';
import '../core/tema.dart';
import '../widgets/comuns.dart';
import '../widgets/foto_campo.dart';
import 'home_shell.dart';

/// Não entregue: o motivo (cartões tocáveis), a foto do local e o aviso de que a mercadoria volta ao CD.
class NaoEntreguePage extends StatefulWidget {
  const NaoEntreguePage({super.key, required this.chave});
  final String chave;

  @override
  State<NaoEntreguePage> createState() => _NaoEntreguePageState();
}

class _NaoEntreguePageState extends State<NaoEntreguePage> {
  static const _motivos = <(String, IconData, String, String)>[
    ('cliente_fechado', Icons.storefront_outlined, 'Cliente fechado', 'Loja fechada na hora da entrega'),
    ('sem_recebedor', Icons.person_off_outlined, 'Ninguém para receber', 'Não tinha quem assinasse'),
    ('recusou', Icons.do_not_disturb_on_outlined, 'Cliente recusou', 'Não quis receber a mercadoria'),
    ('endereco_nao_encontrado', Icons.wrong_location_outlined, 'Não achei o endereço', 'Endereço errado ou não existe'),
    ('outro', Icons.edit_outlined, 'Outro motivo', 'Escrever o que aconteceu'),
  ];

  String _motivo = 'cliente_fechado';
  final _obs = TextEditingController();
  String? _foto;
  String? _erro;
  bool _enviando = false;

  @override
  void dispose() {
    _obs.dispose();
    super.dispose();
  }

  Future<void> _registrar() async {
    final s = Servicos.of(context);
    final p = s.carga.carga?.paradaPorChave(widget.chave);
    if (p == null) return;
    if (_motivo == 'outro' && _obs.text.trim().isEmpty) return setState(() => _erro = 'Escreva o que aconteceu.');
    setState(() {
      _erro = null;
      _enviando = true;
    });
    final gps = await s.localizacao.pontoAtual();
    await s.carga.naoEntregue(p, motivo: _motivo, observacao: _obs.text, fotoLocal: _foto, gps: gps);
    if (!mounted) return;
    Navigator.of(context).popUntil((r) => r.isFirst);
  }

  @override
  Widget build(BuildContext context) {
    final p = Servicos.of(context).carga.carga?.paradaPorChave(widget.chave);
    return Scaffold(
      appBar: AppBar(title: const Text('Não entregue')),
      bottomNavigationBar: const BarraNavegacaoEmpilhada(),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          const Text('O que aconteceu?', style: TextStyle(fontSize: 22, fontWeight: FontWeight.w800, color: Cores.marinho)),
          if (p != null) Text('${p.cliente} · ${p.rotuloNotas}', style: const TextStyle(color: Cores.textoSuave, fontWeight: FontWeight.w700)),
          const SizedBox(height: 12),
          for (final (codigo, icone, titulo, texto) in _motivos)
            CartaoOpcao(icone: icone, titulo: titulo, texto: texto, marcado: _motivo == codigo, aoTocar: () => setState(() => _motivo = codigo)),
          if (_motivo == 'outro') ...[
            const SizedBox(height: 4),
            TextField(controller: _obs, maxLines: 2, decoration: const InputDecoration(labelText: 'O que aconteceu')),
          ],
          const SizedBox(height: 12),
          FotoCampo(rotulo: 'Tirar foto do local', caminho: _foto, aoMudar: (f) => setState(() => _foto = f), altura: 70),
          const SizedBox(height: 12),
          const CaixaAviso(titulo: 'A mercadoria volta para o CD', texto: 'O gerente decide se entrega de novo.'),
          if (_erro != null) ...[const SizedBox(height: 12), CaixaAviso(tom: TomAviso.erro, texto: _erro!)],
          const SizedBox(height: 16),
          FilledButton(onPressed: _enviando ? null : _registrar, child: const Text('Registrar e ir para a próxima')),
        ],
      ),
    );
  }
}

/// Opção em cartão tocável (no lugar de bolinha de escolha), como a escolha da tabela no Fluxo Vendas.
class CartaoOpcao extends StatelessWidget {
  const CartaoOpcao({super.key, required this.icone, required this.titulo, required this.texto, required this.marcado, required this.aoTocar});
  final IconData icone;
  final String titulo, texto;
  final bool marcado;
  final VoidCallback aoTocar;

  @override
  Widget build(BuildContext context) {
    return Cartao(
      margin: const EdgeInsets.only(bottom: 9),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18), side: BorderSide(color: marcado ? Cores.azul : Colors.transparent, width: 2)),
      child: Semantics(
        selected: marcado,
        button: true,
        child: InkWell(
          onTap: aoTocar,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
            child: Row(
              children: [
                IconeCaixa(icone, tamanho: 44),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(titulo, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
                    Text(texto, style: const TextStyle(color: Cores.textoSuave, fontSize: 13.5)),
                  ]),
                ),
                Icon(marcado ? Icons.check_circle_rounded : Icons.chevron_right_rounded, color: marcado ? Cores.azul : Cores.textoSuave, size: marcado ? 28 : 24),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
