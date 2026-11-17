import 'package:flutter/material.dart';

import '../app_servicos.dart';
import '../core/formatadores.dart';
import '../core/tema.dart';
import '../widgets/comuns.dart';
import '../widgets/foto_campo.dart';
import 'home_shell.dart';
import 'parada_page.dart';

/// Comprovante: foto da linha assinada no romaneio (ou do canhoto) e quem recebeu.
class ComprovantePage extends StatefulWidget {
  const ComprovantePage({super.key, required this.chave});
  final String chave;

  @override
  State<ComprovantePage> createState() => _ComprovantePageState();
}

class _ComprovantePageState extends State<ComprovantePage> {
  final _nome = TextEditingController();
  final _documento = TextEditingController();
  String? _assinatura;
  String? _mercadoria;
  String? _erro;
  bool _enviando = false;

  @override
  void dispose() {
    _nome.dispose();
    _documento.dispose();
    super.dispose();
  }

  Future<void> _confirmar() async {
    final s = Servicos.of(context);
    final p = s.carga.carga?.paradaPorChave(widget.chave);
    if (p == null) return;
    if (_assinatura == null) return setState(() => _erro = 'Tire a foto da linha assinada no romaneio.');
    if (_nome.text.trim().length < 2) return setState(() => _erro = 'Escreva o nome de quem recebeu.');
    setState(() {
      _erro = null;
      _enviando = true;
    });
    final gps = await s.localizacao.pontoAtual();
    await s.carga.entregue(p,
        recebedorNome: _nome.text, recebedorDocumento: _documento.text, fotoAssinatura: _assinatura!, fotoMercadoria: _mercadoria, gps: gps);
    if (!mounted) return;
    Navigator.of(context).pushReplacement(MaterialPageRoute<void>(builder: (_) => EntregaConfirmadaPage(chave: widget.chave)));
  }

  @override
  Widget build(BuildContext context) {
    final p = Servicos.of(context).carga.carga?.paradaPorChave(widget.chave);
    return Scaffold(
      appBar: AppBar(title: const Text('Comprovante')),
      bottomNavigationBar: const BarraNavegacaoEmpilhada(),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          const Text('Assinatura do cliente', style: TextStyle(fontSize: 22, fontWeight: FontWeight.w800, color: Cores.marinho)),
          if (p != null) Text('${p.cliente} · ${p.rotuloNotas}', style: const TextStyle(color: Cores.textoSuave, fontWeight: FontWeight.w700)),
          const SizedBox(height: 14),
          Cartao(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const Row(children: [
                    Expanded(child: Text('Foto do romaneio assinado', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800))),
                    Etiqueta('Obrigatória', cor: Cores.erro),
                  ]),
                  const SizedBox(height: 10),
                  FotoCampo(rotulo: 'Tirar foto da linha assinada', caminho: _assinatura, aoMudar: (f) => setState(() => _assinatura = f)),
                  const SizedBox(height: 8),
                  const Text('O nome e a assinatura precisam aparecer. Se o cliente assinou o canhoto da nota, vale a foto do canhoto.',
                      style: TextStyle(color: Cores.textoSuave)),
                ],
              ),
            ),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _nome,
            textCapitalization: TextCapitalization.words,
            decoration: const InputDecoration(labelText: 'Quem recebeu', prefixIcon: Icon(Icons.person_outline)),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _documento,
            keyboardType: TextInputType.number,
            decoration: const InputDecoration(labelText: 'CPF ou RG (opcional)', prefixIcon: Icon(Icons.badge_outlined)),
          ),
          const SizedBox(height: 12),
          if (_mercadoria == null)
            OutlinedButton.icon(
              onPressed: () async {
                final f = await Servicos.of(context).fotos.tirar();
                if (f != null) setState(() => _mercadoria = f);
              },
              icon: const Icon(Icons.inventory_2_outlined),
              label: const Text('Foto da mercadoria (opcional)'),
            )
          else
            FotoCampo(rotulo: 'Foto da mercadoria', caminho: _mercadoria, aoMudar: (f) => setState(() => _mercadoria = f), altura: 90),
          if (_erro != null) ...[const SizedBox(height: 12), CaixaAviso(tom: TomAviso.erro, texto: _erro!)],
          const SizedBox(height: 16),
          const Text('Hora e local da entrega são gravados sozinhos.', textAlign: TextAlign.center, style: TextStyle(color: Cores.textoSuave)),
          const SizedBox(height: 8),
          FilledButton.icon(
            key: const Key('confirmar-entrega'),
            onPressed: _enviando ? null : _confirmar,
            icon: const Icon(Icons.check_rounded),
            label: const Text('Confirmar entrega'),
          ),
        ],
      ),
    );
  }
}

/// Entrega confirmada: resumo da parada e ir para a próxima.
class EntregaConfirmadaPage extends StatelessWidget {
  const EntregaConfirmadaPage({super.key, required this.chave});
  final String chave;

  @override
  Widget build(BuildContext context) {
    final s = Servicos.of(context);
    return ListenableBuilder(
      listenable: s.carga,
      builder: (context, _) {
        final carga = s.carga.carga;
        final p = carga?.paradaPorChave(chave);
        final proxima = carga?.proxima;
        return Scaffold(
          appBar: AppBar(title: const Text('Entrega confirmada'), automaticallyImplyLeading: false),
          bottomNavigationBar: const BarraNavegacaoEmpilhada(),
          body: ListView(
            padding: const EdgeInsets.all(20),
            children: [
              const SizedBox(height: 10),
              Center(
                child: Container(
                  width: 112,
                  height: 112,
                  decoration: const BoxDecoration(color: Color(0xFFDCEAE4), shape: BoxShape.circle),
                  child: const Icon(Icons.check_circle_rounded, color: Cores.ok, size: 72),
                ),
              ),
              const SizedBox(height: 16),
              const Text('Entrega confirmada', textAlign: TextAlign.center, style: TextStyle(fontSize: 26, fontWeight: FontWeight.w800, color: Cores.marinho)),
              if (p != null) ...[
                Text(p.cliente, textAlign: TextAlign.center, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
                Text('${p.rotuloNotas} · ${volumes(p.volumes)}', textAlign: TextAlign.center, style: const TextStyle(color: Cores.textoSuave)),
                const SizedBox(height: 18),
                Cartao(
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                    child: Column(children: [
                      if (p.chegadaEm != null) LinhaInfo('Chegada', hora(p.chegadaEm!), destaque: true),
                      if (p.concluidaEm != null) LinhaInfo('Saída', hora(p.concluidaEm!), destaque: true),
                      if (p.chegadaEm != null && p.concluidaEm != null) LinhaInfo('Tempo no cliente', duracao(p.concluidaEm!.difference(p.chegadaEm!)), destaque: true),
                    ]),
                  ),
                ),
              ],
              const SizedBox(height: 12),
              CaixaAviso(
                tom: TomAviso.info,
                icone: s.carga.pendentes > 0 ? Icons.cloud_upload_outlined : Icons.cloud_done_outlined,
                texto: s.carga.pendentes > 0 ? 'Comprovante guardado no celular. Sobe para o CD assim que houver sinal.' : 'Comprovante enviado ao CD.',
              ),
              const SizedBox(height: 22),
              if (proxima != null)
                FilledButton(
                  onPressed: () => Navigator.of(context).pushReplacement(MaterialPageRoute<void>(builder: (_) => ParadaPage(chave: proxima.chave))),
                  child: const Text('Ir para a próxima parada'),
                ),
              const SizedBox(height: 10),
              OutlinedButton(onPressed: () => Navigator.of(context).popUntil((r) => r.isFirst), child: const Text('Voltar ao início')),
            ],
          ),
        );
      },
    );
  }
}

