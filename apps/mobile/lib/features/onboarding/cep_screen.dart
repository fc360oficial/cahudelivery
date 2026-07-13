import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

import '../shell/home_shell.dart';

/// Primeira tela do visitante: captura o CEP de entrega (pode pular).
/// Só salva localmente — validação de área de entrega depende de decisão
/// de negócio da CAHU (pergunta 6 do ESCOPO).
class CepScreen extends StatefulWidget {
  const CepScreen({super.key});

  @override
  State<CepScreen> createState() => _CepScreenState();
}

class _CepScreenState extends State<CepScreen> {
  final _cep = TextEditingController();
  String? _localidade; // "Bairro · Cidade/UF" vindo do ViaCEP
  bool _buscando = false;

  @override
  void dispose() {
    _cep.dispose();
    super.dispose();
  }

  Future<void> _buscar() async {
    final cep = _cep.text.replaceAll(RegExp(r'\D'), '');
    if (cep.length != 8) return;
    setState(() => _buscando = true);
    try {
      final r = await http
          .get(Uri.parse('https://viacep.com.br/ws/$cep/json/'))
          .timeout(const Duration(seconds: 6));
      final d = jsonDecode(r.body) as Map<String, dynamic>;
      if (mounted && d['erro'] != true) {
        setState(() => _localidade =
            '${d['bairro'] ?? ''} · ${d['localidade']}/${d['uf']}'.replaceFirst(RegExp(r'^ · '), ''));
      }
    } catch (_) {
      // ViaCEP fora do ar não impede confirmar
    } finally {
      if (mounted) setState(() => _buscando = false);
    }
  }

  Future<void> _seguir({required bool salvarCep}) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool('cepVisto', true);
    if (salvarCep) await prefs.setString('cep', _cep.text.replaceAll(RegExp(r'\D'), ''));
    if (!mounted) return;
    Navigator.of(context)
        .pushReplacement(MaterialPageRoute(builder: (_) => const HomeShell()));
  }

  @override
  Widget build(BuildContext context) {
    final cepOk = _cep.text.replaceAll(RegExp(r'\D'), '').length == 8;
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Icon(Icons.location_on_outlined,
                      size: 56, color: Theme.of(context).colorScheme.primary),
                  const SizedBox(height: 16),
                  const Text('Qual o CEP de entrega?',
                      textAlign: TextAlign.center,
                      style: TextStyle(fontSize: 22, fontWeight: FontWeight.w800)),
                  const SizedBox(height: 8),
                  Text('Usamos para preparar seu cadastro de entrega.',
                      textAlign: TextAlign.center,
                      style: TextStyle(fontSize: 14, color: Colors.grey.shade600)),
                  const SizedBox(height: 24),
                  TextField(
                    controller: _cep,
                    keyboardType: TextInputType.number,
                    maxLength: 9,
                    decoration: InputDecoration(
                      labelText: 'CEP',
                      counterText: '',
                      suffixIcon: _buscando
                          ? const Padding(
                              padding: EdgeInsets.all(12),
                              child: SizedBox(
                                  width: 20, height: 20,
                                  child: CircularProgressIndicator(strokeWidth: 2)))
                          : null,
                    ),
                    onChanged: (v) {
                      setState(() {});
                      if (v.replaceAll(RegExp(r'\D'), '').length == 8) _buscar();
                    },
                  ),
                  if (_localidade != null) ...[
                    const SizedBox(height: 8),
                    Text(_localidade!,
                        textAlign: TextAlign.center,
                        style: TextStyle(
                            fontSize: 14,
                            fontWeight: FontWeight.w600,
                            color: Colors.green.shade700)),
                  ],
                  const SizedBox(height: 20),
                  FilledButton(
                    onPressed: cepOk ? () => _seguir(salvarCep: true) : null,
                    child: const Text('Confirmar'),
                  ),
                  TextButton(
                    onPressed: () => _seguir(salvarCep: false),
                    child: const Text('Pular por agora'),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
