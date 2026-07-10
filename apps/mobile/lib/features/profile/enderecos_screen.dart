import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../core/formatadores.dart' as fmt;
import '../../widgets/estados.dart';
import 'endereco_form_screen.dart';

/// Gestão dos endereços de entrega (GET/POST/PUT/DELETE /v1/perfil/enderecos).
class EnderecosScreen extends StatefulWidget {
  const EnderecosScreen({super.key});

  @override
  State<EnderecosScreen> createState() => _EnderecosScreenState();
}

class _EnderecosScreenState extends State<EnderecosScreen> {
  List<Map<String, dynamic>>? _enderecos;
  String? _erro;

  @override
  void initState() {
    super.initState();
    _carregar();
  }

  Future<void> _carregar() async {
    setState(() {
      _enderecos = null;
      _erro = null;
    });
    try {
      final r = await ApiClient.instance.get('/perfil/enderecos') as List;
      if (mounted) setState(() => _enderecos = List<Map<String, dynamic>>.from(r));
    } on ApiException catch (e) {
      if (mounted) setState(() => _erro = e.message);
    } catch (_) {
      if (mounted) setState(() => _erro = 'Sem conexão — verifique sua internet');
    }
  }

  Future<void> _abrirForm([Map<String, dynamic>? endereco]) async {
    final salvo = await Navigator.of(context).push<Map<String, dynamic>>(
        MaterialPageRoute(builder: (_) => EnderecoFormScreen(endereco: endereco)));
    if (salvo != null) _carregar();
  }

  Future<void> _remover(Map<String, dynamic> e) async {
    final confirmar = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Remover endereço?'),
        content: Text('${e['logradouro']}, ${e['numero']} — ${e['cidade']}/${e['uf']}'),
        actions: [
          TextButton(
              onPressed: () => Navigator.of(ctx).pop(false),
              child: const Text('Cancelar')),
          FilledButton(
              onPressed: () => Navigator.of(ctx).pop(true),
              child: const Text('Remover')),
        ],
      ),
    );
    if (confirmar != true) return;
    try {
      await ApiClient.instance.delete('/perfil/enderecos/${e['id']}');
      _carregar();
    } on ApiException catch (err) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(err.message)));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Endereços de entrega')),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _abrirForm(),
        icon: const Icon(Icons.add),
        label: const Text('Novo'),
      ),
      body: _erro != null
          ? EstadoErro(mensagem: _erro, onTentarNovamente: _carregar)
          : _enderecos == null
              ? ListView(
                  physics: const NeverScrollableScrollPhysics(),
                  padding: const EdgeInsets.all(16),
                  children: List.generate(
                      3,
                      (_) => const Padding(
                          padding: EdgeInsets.only(bottom: 12),
                          child: Esqueleto(height: 90, radius: 16))),
                )
              : _enderecos!.isEmpty
                  ? EstadoVazio(
                      icone: Icons.location_on_outlined,
                      titulo: 'Nenhum endereço',
                      mensagem: 'Cadastre onde a distribuidora deve entregar.',
                      acaoLabel: 'Cadastrar endereço',
                      onAcao: () => _abrirForm(),
                    )
                  : RefreshIndicator(
                      onRefresh: _carregar,
                      child: ListView.separated(
                        padding: const EdgeInsets.fromLTRB(16, 16, 16, 90),
                        itemCount: _enderecos!.length,
                        separatorBuilder: (_, i) => const SizedBox(height: 10),
                        itemBuilder: (_, i) {
                          final e = _enderecos![i];
                          return Card(
                            child: ListTile(
                              onTap: () => _abrirForm(e),
                              contentPadding: const EdgeInsets.symmetric(
                                  horizontal: 16, vertical: 6),
                              title: Row(
                                children: [
                                  Flexible(
                                    child: Text(
                                        e['apelido'] ??
                                            '${e['logradouro']}, ${e['numero']}',
                                        overflow: TextOverflow.ellipsis,
                                        style: const TextStyle(
                                            fontSize: 14.5,
                                            fontWeight: FontWeight.w700)),
                                  ),
                                  if (e['padrao'] == true) ...[
                                    const SizedBox(width: 8),
                                    Container(
                                      padding: const EdgeInsets.symmetric(
                                          horizontal: 8, vertical: 2),
                                      decoration: BoxDecoration(
                                        color: Theme.of(context)
                                            .colorScheme
                                            .primary
                                            .withValues(alpha: 0.12),
                                        borderRadius: BorderRadius.circular(20),
                                      ),
                                      child: Text('Padrão',
                                          style: TextStyle(
                                              fontSize: 11,
                                              fontWeight: FontWeight.w700,
                                              color: Theme.of(context)
                                                  .colorScheme
                                                  .primary)),
                                    ),
                                  ],
                                ],
                              ),
                              subtitle: Text(
                                '${e['logradouro']}, ${e['numero']}'
                                '${e['complemento'] != null ? ' — ${e['complemento']}' : ''}\n'
                                '${e['bairro']} · ${e['cidade']}/${e['uf']} · CEP ${fmt.cep(e['cep'] as String?)}',
                                style: const TextStyle(fontSize: 12.5, height: 1.4),
                              ),
                              isThreeLine: true,
                              trailing: IconButton(
                                icon: Icon(Icons.delete_outline,
                                    color: Colors.grey.shade500),
                                onPressed: () => _remover(e),
                              ),
                            ),
                          );
                        },
                      ),
                    ),
    );
  }
}
