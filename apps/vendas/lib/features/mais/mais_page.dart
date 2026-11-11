import 'package:flutter/material.dart';

import '../../app_servicos.dart';
import '../../core/config.dart';
import '../../core/formatadores.dart';
import '../../core/tema.dart';
import '../../services/sincronizacao_service.dart';
import '../../widgets/comuns.dart';
import '../catalogo/catalogo_page.dart';
import '../orcamentos/orcamentos_page.dart';
import '../shell/home_shell.dart';

/// Frase do aviso ao sair com coisas que ainda não subiram ("Você tem 2 pedido(s) na fila. ...").
/// Nulo quando não há nada na fila.
String? mensagemDeSaida({required int pedidos, required int orcamentos}) {
  if (pedidos <= 0 && orcamentos <= 0) return null;
  final partes = [
    if (pedidos > 0) '$pedidos pedido(s)',
    if (orcamentos > 0) '$orcamentos orçamento(s)',
  ];
  return 'Você tem ${partes.join(' e ')} na fila. Se sair agora eles serão perdidos.';
}

/// Aba "Mais": conta, atalhos (Orçamentos, Catálogo), sincronizar agora com a hora da última,
/// versão do app e Sair. Sair com pedidos ou orçamentos na fila exige confirmação explícita.
class MaisPage extends StatelessWidget {
  const MaisPage({super.key});

  Future<void> _sincronizar(BuildContext context) async {
    final r = await Servicos.of(context).sincronizacao.sincronizar();
    if (!context.mounted || r.ok || r.situacao == SituacaoSync.sessaoExpirada) {
      return;
    }
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(
          r.situacao == SituacaoSync.semConexao
              ? 'Sem internet. Mostrando os dados salvos no aparelho.'
              : (r.mensagem ?? 'Não foi possível sincronizar.'),
        ),
      ),
    );
  }

  Future<void> _sair(BuildContext context) async {
    final s = Servicos.of(context);
    final pendentes = await s.fila.pendentes();
    if (!context.mounted) return;
    final aviso = mensagemDeSaida(
      pedidos: pendentes.pedidos,
      orcamentos: pendentes.orcamentos,
    );
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(
          aviso == null ? 'Sair do aplicativo?' : 'Sair com itens na fila?',
        ),
        content: Text(
          aviso ??
              'Os dados salvos neste aparelho serão apagados. Para entrar de novo é preciso internet.',
          key: const Key('texto-saida'),
        ),
        actionsOverflowDirection: VerticalDirection.down,
        actions: [
          TextButton(
            key: const Key('saida-voltar'),
            style: TextButton.styleFrom(minimumSize: const Size(48, 48)),
            onPressed: () => Navigator.pop(c, false),
            child: Text(aviso == null ? 'Cancelar' : 'Voltar e enviar'),
          ),
          TextButton(
            key: const Key('saida-confirmar'),
            style: TextButton.styleFrom(
              minimumSize: const Size(48, 48),
              foregroundColor: Cores.erro,
            ),
            onPressed: () => Navigator.pop(c, true),
            child: Text(aviso == null ? 'Sair' : 'Sair mesmo assim'),
          ),
        ],
      ),
    );
    if (ok == true) await s.sessao.sair();
  }

  void _abrir(BuildContext context, Widget tela) =>
      Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => tela));

  @override
  Widget build(BuildContext context) {
    final s = Servicos.of(context);
    final sessao = s.sessao;
    return ListenableBuilder(
      listenable: s.sincronizacao,
      builder: (context, _) {
        final sync = s.sincronizacao;
        final ultima = sync.ultimaSincronizacao?.toLocal();
        return Column(
          children: [
            TopoTela(
              titulo: 'Mais',
              aoVoltar: () => HomeShell.ativo?.irPara(AbaVendas.inicio),
            ),
            Expanded(
              child: SingleChildScrollView(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                  Cartao(
                    child: Padding(
                      padding: const EdgeInsets.all(14),
                      child: Row(
                        children: [
                          const CircleAvatar(
                            radius: 26,
                            backgroundColor: Cores.marinho,
                            child: Icon(
                              Icons.person_rounded,
                              color: Colors.white,
                              size: 30,
                            ),
                          ),
                          const SizedBox(width: 14),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  sessao.vendedor?.nome ?? '',
                                  style: const TextStyle(
                                    fontSize: 17,
                                    fontWeight: FontWeight.w800,
                                    color: Cores.marinho,
                                  ),
                                ),
                                if ((sessao.distribuidora ?? '').isNotEmpty)
                                  Text(
                                    sessao.distribuidora!,
                                    style: const TextStyle(
                                      color: Cores.textoSuave,
                                    ),
                                  ),
                              ],
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(height: 14),
                  Cartao(
                    child: Column(
                      children: [
                        _ItemMais(
                          chave: const Key('mais-orcamentos'),
                          icone: Icons.request_quote_rounded,
                          titulo: 'Orçamentos',
                          aoTocar: () =>
                              _abrir(context, const OrcamentosPage()),
                        ),
                        const Divider(height: 1, indent: 70),
                        _ItemMais(
                          chave: const Key('mais-catalogo'),
                          icone: Icons.inventory_2_rounded,
                          titulo: 'Catálogo',
                          aoTocar: () => _abrir(context, const CatalogoPage()),
                        ),
                        const Divider(height: 1, indent: 70),
                        const _ItemMais(
                          icone: Icons.flag_rounded,
                          titulo: 'Metas',
                          emBreve: true,
                        ),
                        const Divider(height: 1, indent: 70),
                        const _ItemMais(
                          icone: Icons.route_rounded,
                          titulo: 'Rota do dia',
                          emBreve: true,
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 14),
                  Cartao(
                    child: Padding(
                      padding: const EdgeInsets.all(14),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Row(
                            children: [
                              IconeCaixa(Icons.sync_rounded, tamanho: 40),
                              SizedBox(width: 12),
                              Flexible(
                                child: Text(
                                  'Sincronização',
                                  style: TextStyle(
                                    fontSize: 16,
                                    fontWeight: FontWeight.w800,
                                    color: Cores.marinho,
                                  ),
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 8),
                          Text(
                            ultima == null
                                ? 'Última sincronização: ainda não sincronizado'
                                : 'Última sincronização: ${dataHoraCurta(ultima)}',
                            key: const Key('mais-ultima-sync'),
                            style: const TextStyle(color: Cores.textoSuave),
                          ),
                          const SizedBox(height: 12),
                          OutlinedButton.icon(
                            key: const Key('mais-sincronizar'),
                            onPressed: sync.sincronizando
                                ? null
                                : () => _sincronizar(context),
                            icon: sync.sincronizando
                                ? const SizedBox(
                                    height: 18,
                                    width: 18,
                                    child: CircularProgressIndicator(
                                      strokeWidth: 2.5,
                                    ),
                                  )
                                : const Icon(Icons.sync_rounded),
                            label: Text(
                              sync.sincronizando
                                  ? 'Sincronizando...'
                                  : 'Sincronizar agora',
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(height: 14),
                  Cartao(
                    child: ListTile(
                      key: const Key('mais-sair'),
                      minVerticalPadding: 12,
                      leading: const IconeCaixa(
                        Icons.logout_rounded,
                        tamanho: 40,
                        cor: Cores.erro,
                        fundo: Color(0xFFFDECEC),
                      ),
                      title: const Text(
                        'Sair',
                        style: TextStyle(
                          color: Cores.erro,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      onTap: () => _sair(context),
                    ),
                  ),
                  const SizedBox(height: 16),
                  Center(
                    child: Text(
                      'Fluxo Vendas ${AppConfig.versao} · ${AppConfig.tenant}',
                      key: const Key('mais-versao'),
                      style: const TextStyle(
                        color: Cores.textoSuave,
                        fontSize: 12,
                      ),
                    ),
                  ),
                ],
                ),
              ),
            ),
          ],
        );
      },
    );
  }
}

class _ItemMais extends StatelessWidget {
  const _ItemMais({
    this.chave,
    required this.icone,
    required this.titulo,
    this.aoTocar,
    this.emBreve = false,
  });
  final Key? chave;
  final IconData icone;
  final String titulo;
  final VoidCallback? aoTocar;
  final bool emBreve;

  @override
  Widget build(BuildContext context) {
    return ListTile(
      key: chave,
      minVerticalPadding: 12,
      leading: IconeCaixa(icone, tamanho: 40),
      title: Text(
        titulo,
        style: const TextStyle(
          fontWeight: FontWeight.w700,
          color: Cores.marinho,
        ),
      ),
      trailing: emBreve
          ? const Etiqueta('em breve', cor: Cores.textoSuave)
          : const Icon(Icons.chevron_right_rounded, color: Cores.textoSuave),
      onTap: aoTocar,
    );
  }
}
