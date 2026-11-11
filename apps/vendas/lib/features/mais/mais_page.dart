import 'package:flutter/material.dart';

import '../../app_servicos.dart';
import '../../core/config.dart';
import '../../core/formatadores.dart';
import '../../core/tema.dart';
import '../../services/sincronizacao_service.dart';
import '../catalogo/catalogo_page.dart';
import '../orcamentos/orcamentos_page.dart';

/// Frase do aviso ao sair com coisas que ainda não subiram ("Você tem 2 pedido(s) na fila. ...").
/// Nulo quando não há nada na fila.
String? mensagemDeSaida({required int pedidos, required int orcamentos}) {
  if (pedidos <= 0 && orcamentos <= 0) return null;
  final partes = [if (pedidos > 0) '$pedidos pedido(s)', if (orcamentos > 0) '$orcamentos orçamento(s)'];
  return 'Você tem ${partes.join(' e ')} na fila. Se sair agora eles serão perdidos.';
}

/// Aba "Mais": conta, atalhos (Orçamentos, Catálogo), sincronizar agora com a hora da última,
/// versão do app e Sair. Sair com pedidos ou orçamentos na fila exige confirmação explícita.
class MaisPage extends StatelessWidget {
  const MaisPage({super.key});

  Future<void> _sincronizar(BuildContext context) async {
    final r = await Servicos.of(context).sincronizacao.sincronizar();
    if (!context.mounted || r.ok || r.situacao == SituacaoSync.sessaoExpirada) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      content: Text(r.situacao == SituacaoSync.semConexao
          ? 'Sem internet. Mostrando os dados salvos no aparelho.'
          : (r.mensagem ?? 'Não foi possível sincronizar.')),
    ));
  }

  Future<void> _sair(BuildContext context) async {
    final s = Servicos.of(context);
    final pendentes = await s.fila.pendentes();
    if (!context.mounted) return;
    final aviso = mensagemDeSaida(pedidos: pendentes.pedidos, orcamentos: pendentes.orcamentos);
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(aviso == null ? 'Sair do aplicativo?' : 'Sair com itens na fila?'),
        content: Text(aviso ?? 'Os dados salvos neste aparelho serão apagados. Para entrar de novo é preciso internet.',
            key: const Key('texto-saida')),
        actionsOverflowDirection: VerticalDirection.down,
        actions: [
          TextButton(
              key: const Key('saida-voltar'),
              style: TextButton.styleFrom(minimumSize: const Size(48, 48)),
              onPressed: () => Navigator.pop(c, false),
              child: Text(aviso == null ? 'Cancelar' : 'Voltar e enviar')),
          TextButton(
              key: const Key('saida-confirmar'),
              style: TextButton.styleFrom(minimumSize: const Size(48, 48), foregroundColor: Cores.erro),
              onPressed: () => Navigator.pop(c, true),
              child: Text(aviso == null ? 'Sair' : 'Sair mesmo assim')),
        ],
      ),
    );
    if (ok == true) await s.sessao.sair();
  }

  void _abrir(BuildContext context, Widget tela) => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => tela));

  @override
  Widget build(BuildContext context) {
    final s = Servicos.of(context);
    final sessao = s.sessao;
    return ListenableBuilder(
      listenable: s.sincronizacao,
      builder: (context, _) {
        final sync = s.sincronizacao;
        final ultima = sync.ultimaSincronizacao?.toLocal();
        return ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Card(
              child: ListTile(
                leading: const CircleAvatar(backgroundColor: Cores.marinho, child: Icon(Icons.person, color: Colors.white)),
                title: Text(sessao.vendedor?.nome ?? '', style: const TextStyle(fontWeight: FontWeight.w700)),
                subtitle: Text(sessao.distribuidora ?? ''),
              ),
            ),
            const SizedBox(height: 12),
            Card(
              child: Column(children: [
                ListTile(
                  key: const Key('mais-orcamentos'),
                  minVerticalPadding: 12,
                  leading: const Icon(Icons.request_quote_outlined, color: Cores.azul),
                  title: const Text('Orçamentos'),
                  trailing: const Icon(Icons.chevron_right_rounded),
                  onTap: () => _abrir(context, const OrcamentosPage()),
                ),
                const Divider(height: 1),
                ListTile(
                  key: const Key('mais-catalogo'),
                  minVerticalPadding: 12,
                  leading: const Icon(Icons.inventory_2_outlined, color: Cores.azul),
                  title: const Text('Catálogo'),
                  trailing: const Icon(Icons.chevron_right_rounded),
                  onTap: () => _abrir(context, const CatalogoPage()),
                ),
                const Divider(height: 1),
                const ListTile(leading: Icon(Icons.flag_outlined), title: Text('Metas'), trailing: Text('em breve')),
                const Divider(height: 1),
                const ListTile(leading: Icon(Icons.route_outlined), title: Text('Rota do dia'), trailing: Text('em breve')),
              ]),
            ),
            const SizedBox(height: 12),
            Card(
              child: Padding(
                padding: const EdgeInsets.all(14),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('Sincronização', style: TextStyle(fontWeight: FontWeight.w800, color: Cores.marinho)),
                    const SizedBox(height: 4),
                    Text(
                      ultima == null ? 'Última sincronização: ainda não sincronizado' : 'Última sincronização: ${dataHoraCurta(ultima)}',
                      key: const Key('mais-ultima-sync'),
                      style: const TextStyle(color: Cores.textoSuave),
                    ),
                    const SizedBox(height: 12),
                    OutlinedButton.icon(
                      key: const Key('mais-sincronizar'),
                      onPressed: sync.sincronizando ? null : () => _sincronizar(context),
                      icon: sync.sincronizando
                          ? const SizedBox(height: 18, width: 18, child: CircularProgressIndicator(strokeWidth: 2.5))
                          : const Icon(Icons.sync_rounded),
                      label: Text(sync.sincronizando ? 'Sincronizando...' : 'Sincronizar agora'),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 12),
            Card(
              child: ListTile(
                key: const Key('mais-sair'),
                minVerticalPadding: 12,
                leading: const Icon(Icons.logout, color: Cores.erro),
                title: const Text('Sair', style: TextStyle(color: Cores.erro, fontWeight: FontWeight.w600)),
                onTap: () => _sair(context),
              ),
            ),
            const SizedBox(height: 16),
            Center(
              child: Text('Fluxo Vendas ${AppConfig.versao} · ${AppConfig.tenant}',
                  key: const Key('mais-versao'), style: const TextStyle(color: Cores.textoSuave, fontSize: 12)),
            ),
          ],
        );
      },
    );
  }
}
