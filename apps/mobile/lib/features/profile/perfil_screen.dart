import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../core/carrinho_store.dart';
import '../../core/formatadores.dart' as fmt;
import '../../core/tenant_theme.dart';
import '../../widgets/convite_login.dart';
import '../../widgets/estados.dart';
import 'enderecos_screen.dart';
import 'notificacoes_screen.dart';
import 'perfil_dados_screen.dart';

/// Aba Perfil: dados cadastrais, endereços, notificações, sobre e sair.
class PerfilScreen extends StatefulWidget {
  const PerfilScreen({super.key});

  @override
  State<PerfilScreen> createState() => _PerfilScreenState();
}

class _PerfilScreenState extends State<PerfilScreen> {
  Map<String, dynamic>? _perfil;
  String? _erro;

  @override
  void initState() {
    super.initState();
    // Recarrega quando o login muda (ex.: logou dentro do checkout, empilhado
    // por cima) — _carregar() já ignora a chamada se ainda não está logado.
    ApiClient.instance.addListener(_carregar);
    _carregar();
  }

  @override
  void dispose() {
    ApiClient.instance.removeListener(_carregar);
    super.dispose();
  }

  Future<void> _carregar() async {
    if (!ApiClient.instance.logado) return;
    setState(() {
      _perfil = null;
      _erro = null;
    });
    try {
      final r = await ApiClient.instance.get('/perfil') as Map<String, dynamic>;
      if (mounted) setState(() => _perfil = r);
    } on ApiException catch (e) {
      if (mounted) setState(() => _erro = e.message);
    } catch (_) {
      if (mounted) setState(() => _erro = 'Sem conexão — verifique sua internet');
    }
  }

  Future<void> _sair() async {
    final confirmar = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Sair da conta?'),
        content: const Text('Você precisará entrar novamente para fazer pedidos.'),
        actions: [
          TextButton(
              onPressed: () => Navigator.of(ctx).pop(false),
              child: const Text('Cancelar')),
          FilledButton(
              onPressed: () => Navigator.of(ctx).pop(true), child: const Text('Sair')),
        ],
      ),
    );
    if (confirmar != true || !mounted) return;
    await ApiClient.instance.sair();
    CarrinhoStore.instance.limpar();
    await CarrinhoStore.instance.carregar(); // carrinho novo do device
    if (mounted) setState(() {});
  }

  void _sobre() {
    final t = TenantTheme.instance;
    showAboutDialog(
      context: context,
      applicationName: t.appNome,
      applicationVersion: '1.0.0',
      applicationLegalese: t.distribuidora,
    );
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: ApiClient.instance,
      builder: (context, _) {
        if (!ApiClient.instance.logado) {
          return Scaffold(
            appBar: AppBar(title: const Text('Perfil')),
            body: ConviteLogin(
              icone: Icons.person_outline,
              titulo: 'Entre para ver seu perfil',
              onAutenticado: () {
                _carregar();
              },
            ),
          );
        }
        return _corpoLogado(context);
      },
    );
  }

  Widget _corpoLogado(BuildContext context) {
    final cor = Theme.of(context).colorScheme.primary;
    return Scaffold(
      appBar: AppBar(title: const Text('Perfil')),
      body: _erro != null
          ? EstadoErro(mensagem: _erro, onTentarNovamente: _carregar)
          : _perfil == null
              ? ListView(
                  physics: const NeverScrollableScrollPhysics(),
                  padding: const EdgeInsets.all(16),
                  children: const [
                    Esqueleto(height: 90, radius: 16),
                    SizedBox(height: 16),
                    Esqueleto(height: 260, radius: 16),
                  ],
                )
              : RefreshIndicator(
                  onRefresh: _carregar,
                  child: ListView(
                    padding: const EdgeInsets.all(16),
                    children: [
                      Card(
                        child: Padding(
                          padding: const EdgeInsets.all(16),
                          child: Row(
                            children: [
                              CircleAvatar(
                                radius: 26,
                                backgroundColor: cor.withValues(alpha: 0.12),
                                child: Icon(Icons.store, color: cor, size: 28),
                              ),
                              const SizedBox(width: 14),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                        _perfil!['nome_fantasia'] ??
                                            _perfil!['razao_social'] ??
                                            '',
                                        style: const TextStyle(
                                            fontSize: 16, fontWeight: FontWeight.w800)),
                                    const SizedBox(height: 2),
                                    Text(
                                        '${_perfil!['tipo']} ${fmt.documento(_perfil!['documento'] as String?)}',
                                        style: TextStyle(
                                            fontSize: 12.5,
                                            color: Colors.grey.shade600)),
                                    if (_perfil!['status'] != 'ativo')
                                      Padding(
                                        padding: const EdgeInsets.only(top: 4),
                                        child: Text(
                                            'Cadastro ${_perfil!['status']}',
                                            style: TextStyle(
                                                fontSize: 12,
                                                fontWeight: FontWeight.w700,
                                                color: Colors.orange.shade800)),
                                      ),
                                  ],
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                      const SizedBox(height: 14),
                      Card(
                        child: Column(
                          children: [
                            _opcao(Icons.badge_outlined, 'Dados cadastrais', () async {
                              final mudou = await Navigator.of(context)
                                  .push<bool>(MaterialPageRoute(
                                      builder: (_) =>
                                          PerfilDadosScreen(perfil: _perfil!)));
                              if (mudou == true) _carregar();
                            }),
                            _divisor(),
                            _opcao(Icons.location_on_outlined, 'Endereços de entrega',
                                () {
                              Navigator.of(context).push(MaterialPageRoute(
                                  builder: (_) => const EnderecosScreen()));
                            }),
                            _divisor(),
                            _opcao(Icons.notifications_outlined, 'Notificações', () {
                              Navigator.of(context).push(MaterialPageRoute(
                                  builder: (_) => const NotificacoesScreen()));
                            }),
                            _divisor(),
                            _opcao(Icons.info_outline, 'Sobre o app', _sobre),
                          ],
                        ),
                      ),
                      const SizedBox(height: 14),
                      Card(
                        child: _opcao(Icons.logout, 'Sair da conta', _sair,
                            cor: Colors.red.shade600),
                      ),
                    ],
                  ),
                ),
    );
  }

  Widget _opcao(IconData icone, String titulo, VoidCallback onTap, {Color? cor}) =>
      ListTile(
        onTap: onTap,
        leading: Icon(icone, color: cor ?? Colors.grey.shade700),
        title: Text(titulo,
            style: TextStyle(
                fontSize: 14.5, fontWeight: FontWeight.w600, color: cor)),
        trailing: Icon(Icons.chevron_right, color: Colors.grey.shade400),
      );

  Widget _divisor() => Divider(height: 1, indent: 56, color: Colors.grey.shade100);
}
