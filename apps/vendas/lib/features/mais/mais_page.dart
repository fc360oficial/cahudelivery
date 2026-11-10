import 'package:flutter/material.dart';

import '../../app_servicos.dart';
import '../../core/config.dart';
import '../../core/tema.dart';

/// Aba "Mais": conta, versão, sair. Metas e Rota já reservam o lugar ("em breve").
/// As próximas tarefas acrescentam itens aqui.
class MaisPage extends StatelessWidget {
  const MaisPage({super.key});

  Future<void> _sair(BuildContext context) async {
    final sessao = Servicos.of(context).sessao;
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: const Text('Sair do aplicativo?'),
        content: const Text('Os dados salvos neste aparelho serão apagados. Para entrar de novo é preciso internet.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Cancelar')),
          TextButton(onPressed: () => Navigator.pop(c, true), child: const Text('Sair')),
        ],
      ),
    );
    if (ok == true) await sessao.sair();
  }

  @override
  Widget build(BuildContext context) {
    final sessao = Servicos.of(context).sessao;
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
        const Card(
          child: Column(children: [
            ListTile(leading: Icon(Icons.flag_outlined), title: Text('Metas'), trailing: Text('em breve')),
            Divider(height: 1),
            ListTile(leading: Icon(Icons.route_outlined), title: Text('Rota do dia'), trailing: Text('em breve')),
          ]),
        ),
        const SizedBox(height: 12),
        Card(
          child: ListTile(
            leading: const Icon(Icons.logout, color: Cores.erro),
            title: const Text('Sair', style: TextStyle(color: Cores.erro, fontWeight: FontWeight.w600)),
            onTap: () => _sair(context),
          ),
        ),
        const SizedBox(height: 16),
        Center(child: Text('Fluxo Vendas ${AppConfig.versao} · ${AppConfig.tenant}', style: const TextStyle(color: Cores.textoSuave, fontSize: 12))),
      ],
    );
  }
}
