import 'package:flutter/material.dart';

import '../../core/formatadores.dart';
import '../../core/tema.dart';
import '../../data/situacao_pedido.dart';
import '../../services/fila_envio_service.dart';
import '../../widgets/comuns.dart';
import '../shell/home_shell.dart';
import 'iniciar_pedido.dart';

/// Tela depois de "Enviar pedido" / "Salvar como orçamento": enviado (com número),
/// na fila (sem internet), retido (motivos em palavras) ou recusado (mensagem).
class ResultadoEnvioPage extends StatelessWidget {
  const ResultadoEnvioPage({super.key, required this.resultado, required this.cliente});
  final ResultadoEnvio resultado;
  final String cliente;

  void _inicio(BuildContext context, [AbaVendas aba = AbaVendas.inicio, FiltroPedido? filtro]) {
    Navigator.of(context).popUntil((r) => r.isFirst);
    HomeShell.ativo?.irPara(aba, filtro: filtro);
  }

  @override
  Widget build(BuildContext context) {
    final r = resultado;
    final orc = r.orcamento;
    final (icone, cor, titulo) = switch (r.desfecho) {
      DesfechoEnvio.enviado => (Icons.check_circle_rounded, Cores.ok, orc ? 'Orçamento salvo' : 'Pedido enviado'),
      DesfechoEnvio.naFila => (Icons.schedule_send_rounded, Cores.azul, orc ? 'Orçamento guardado' : 'Pedido guardado'),
      DesfechoEnvio.retido => (Icons.pause_circle_rounded, const Color(0xFFB26A00), 'Pedido retido'),
      DesfechoEnvio.recusado => (Icons.cancel_rounded, Cores.erro, orc ? 'Orçamento não enviado' : 'Pedido não enviado'),
    };
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _inicio(context);
      },
      child: Scaffold(
        appBar: AppBar(automaticallyImplyLeading: false, title: Text(titulo)),
        body: SafeArea(
          child: Column(
            children: [
              Expanded(
                child: ListView(
                  padding: const EdgeInsets.all(20),
                  children: [
                    const SizedBox(height: 12),
                    Icon(icone, size: 76, color: cor, key: const Key('icone-resultado')),
                    const SizedBox(height: 12),
                    Text(titulo,
                        textAlign: TextAlign.center, style: Theme.of(context).textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w800, color: Cores.marinho)),
                    const SizedBox(height: 8),
                    ..._detalhes(context),
                  ],
                ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
                child: Column(
                  children: [
                    if (r.desfecho == DesfechoEnvio.retido)
                      FilledButton(
                        key: const Key('ver-retidos'),
                        onPressed: () => _inicio(context, AbaVendas.pedidos, FiltroPedido.retidos),
                        child: const Text('Ver pedidos retidos'),
                      )
                    else
                      FilledButton(
                        key: const Key('novo-pedido-resultado'),
                        onPressed: () {
                          final nav = Navigator.of(context);
                          nav.popUntil((r) => r.isFirst);
                          iniciarNovoPedido(nav.context);
                        },
                        child: const Text('Fazer outro pedido'),
                      ),
                    const SizedBox(height: 8),
                    OutlinedButton(key: const Key('voltar-inicio'), onPressed: () => _inicio(context), child: const Text('Voltar ao início')),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  List<Widget> _detalhes(BuildContext context) {
    final r = resultado;
    final orc = r.orcamento;
    TextStyle suave() => const TextStyle(color: Cores.textoSuave, fontSize: 15);
    Widget centro(String t, {TextStyle? estilo}) => Padding(
          padding: const EdgeInsets.only(bottom: 4),
          child: Text(t, textAlign: TextAlign.center, style: estilo ?? suave()),
        );
    switch (r.desfecho) {
      case DesfechoEnvio.enviado:
        return [
          if (!orc && r.numero != null)
            centro('Pedido nº ${r.numero}', estilo: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: Cores.texto)),
          centro(cliente),
          if (r.total != null) centro(moeda(r.total!), estilo: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800, color: Cores.marinho)),
          if (orc) centro('Você acha o orçamento na lista de orçamentos para alterar ou transformar em pedido.'),
        ];
      case DesfechoEnvio.naFila:
        return [
          centro(cliente),
          if (r.total != null) centro(moeda(r.total!), estilo: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800, color: Cores.marinho)),
          const SizedBox(height: 8),
          const CaixaAviso(
            key: Key('aviso-na-fila'),
            tom: TomAviso.info,
            icone: Icons.wifi_off_rounded,
            texto: 'Vai ser enviado quando a internet voltar.',
          ),
        ];
      case DesfechoEnvio.retido:
        return [
          if (r.numero != null) centro('Pedido nº ${r.numero}', estilo: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: Cores.texto)),
          centro(cliente),
          const SizedBox(height: 8),
          const CaixaAviso(
            texto: 'Alguma coisa mudou desde a última sincronização. Nada foi para o ERP: confirme com os valores atuais ou cancele em Pedidos.',
          ),
          const SizedBox(height: 12),
          const TituloSecao('O QUE MUDOU'),
          for (final d in r.divergencias) ...[
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(14), border: Border.all(color: Cores.linha)),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(d.titulo, style: const TextStyle(fontWeight: FontWeight.w800, color: Cores.marinho)),
                  const SizedBox(height: 2),
                  Text(d.descricao),
                ],
              ),
            ),
            const SizedBox(height: 8),
          ],
        ];
      case DesfechoEnvio.recusado:
        return [
          centro(cliente),
          const SizedBox(height: 8),
          CaixaAviso(key: const Key('aviso-recusa'), tom: TomAviso.erro, texto: r.mensagem ?? 'O servidor recusou o envio.'),
          const SizedBox(height: 8),
          centro(orc ? 'O orçamento não foi salvo no servidor.' : 'O pedido não foi enviado e não será tentado de novo sozinho.'),
        ];
    }
  }
}
