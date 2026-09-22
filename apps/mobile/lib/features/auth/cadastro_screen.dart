import 'dart:convert';

import 'package:flutter/material.dart';
import '../../widgets/campo_senha.dart';
import 'package:http/http.dart' as http;

import '../../core/api_client.dart';
import '../../core/tenant_theme.dart';
import '../shell/home_shell.dart';

/// Cadastro do cliente da distribuidora (POST /v1/auth/registrar).
/// A resposta já traz os tokens — o cadastro auto-loga o cliente.
class CadastroScreen extends StatefulWidget {
  const CadastroScreen({super.key, this.retornarAoLogar = false});
  final bool retornarAoLogar;

  @override
  State<CadastroScreen> createState() => _CadastroScreenState();
}

/// Categorias de estabelecimento (segmenta o cliente para catálogo/promoções).
const categoriasEstabelecimento = [
  'Açougue e Frigorífico',
  'Atacarejo e Supermercado',
  'Restaurante',
  'Bar e Petiscos',
  'Padaria e Confeitaria',
  'Cafeteria',
  'Mercearia e Conveniência',
  'Distribuidor',
  'Outro',
];

class _CadastroScreenState extends State<CadastroScreen> {
  final _form = GlobalKey<FormState>();
  String _tipo = 'CNPJ';
  final _documento = TextEditingController();
  final _nomeFantasia = TextEditingController();
  final _razaoSocial = TextEditingController();
  final _email = TextEditingController();
  final _telefone = TextEditingController();
  final _senha = TextEditingController();
  final _codigoIndicacao = TextEditingController();
  final _cep = TextEditingController();
  final _logradouro = TextEditingController();
  final _numero = TextEditingController();
  final _complemento = TextEditingController();
  final _bairro = TextEditingController();
  final _cidade = TextEditingController();
  final _uf = TextEditingController();
  final _inscricaoEstadual = TextEditingController();
  bool _isentoIe = false;
  String? _codigoMunicipio;
  String? _categoria;
  bool _enviando = false;
  bool _buscandoCep = false;
  /// Só a busca de CEP mais recente pode escrever no formulário: sem isso, duas
  /// buscas em voo podem responder fora de ordem e a do CEP antigo vence.
  int _buscaCepSeq = 0;

  @override
  void dispose() {
    for (final c in [
      _documento,
      _nomeFantasia,
      _razaoSocial,
      _email,
      _telefone,
      _senha,
      _codigoIndicacao,
      _cep,
      _logradouro,
      _numero,
      _complemento,
      _bairro,
      _cidade,
      _uf,
      _inscricaoEstadual,
    ]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _buscarCep() async {
    final cep = _cep.text.replaceAll(RegExp(r'\D'), '');
    if (cep.length != 8) return;
    final seq = ++_buscaCepSeq;
    setState(() => _buscandoCep = true);
    try {
      final r = await http
          .get(Uri.parse('https://viacep.com.br/ws/$cep/json/'))
          .timeout(const Duration(seconds: 6));
      final d = jsonDecode(r.body) as Map<String, dynamic>;
      if (d['erro'] != true && mounted && seq == _buscaCepSeq) {
        _logradouro.text = d['logradouro'] ?? _logradouro.text;
        _bairro.text = d['bairro'] ?? _bairro.text;
        _cidade.text = d['localidade'] ?? _cidade.text;
        _uf.text = d['uf'] ?? _uf.text;
        // O ViaCEP já devolve o código IBGE do município: o ERP precisa dele e
        // o cliente não saberia informar. Nenhum campo é mostrado na tela.
        _codigoMunicipio = (d['ibge'] as String?)?.trim();
      }
    } catch (_) {
      // ViaCEP fora do ar não bloqueia o preenchimento manual
    } finally {
      if (mounted && seq == _buscaCepSeq) setState(() => _buscandoCep = false);
    }
  }

  Future<void> _cadastrar() async {
    if (!_form.currentState!.validate()) return;
    final ehCnpjSelecionado = _tipo == 'CNPJ';
    setState(() => _enviando = true);
    try {
      final r =
          await ApiClient.instance.post('/auth/registrar', {
                'tipo': _tipo,
                'documento': _documento.text.replaceAll(RegExp(r'\D'), ''),
                'nomeFantasia': _nomeFantasia.text.trim(),
                if (_razaoSocial.text.trim().isNotEmpty)
                  'razaoSocial': _razaoSocial.text.trim(),
                if (_email.text.trim().isNotEmpty) 'email': _email.text.trim(),
                'telefone': _telefone.text.trim(),
                'endereco': {
                  'cep': _cep.text.replaceAll(RegExp(r'\D'), ''),
                  'logradouro': _logradouro.text.trim(),
                  'numero': _numero.text.trim(),
                  if (_complemento.text.trim().isNotEmpty)
                    'complemento': _complemento.text.trim(),
                  'bairro': _bairro.text.trim(),
                  'cidade': _cidade.text.trim(),
                  'uf': _uf.text.trim().toUpperCase(),
                  if (_codigoMunicipio != null && _codigoMunicipio!.isNotEmpty)
                    'codigoMunicipio': _codigoMunicipio,
                },
                if (_categoria != null) 'categoria': _categoria,
                if (ehCnpjSelecionado && _isentoIe) 'isentoIe': true,
                if (ehCnpjSelecionado && !_isentoIe && _inscricaoEstadual.text.trim().isNotEmpty)
                  'inscricaoEstadual': _inscricaoEstadual.text.replaceAll(RegExp(r'\D'), ''),
                'senha': _senha.text,
                if (_codigoIndicacao.text.trim().isNotEmpty)
                  'codigoIndicacao': _codigoIndicacao.text.trim(),
              })
              as Map<String, dynamic>;
      await ApiClient.instance.salvarTokens(
        r['accessToken'],
        r['refreshToken'],
      );
      if (!mounted) return;
      if (r['status'] != 'aprovado' && r['status'] != 'ativo') {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text(
              'Cadastro em análise pela distribuidora — você já pode navegar e montar pedidos.',
            ),
          ),
        );
      }
      if (widget.retornarAoLogar) {
        Navigator.of(context).pop(true);
      } else {
        Navigator.of(context).pushAndRemoveUntil(
          MaterialPageRoute(builder: (_) => const HomeShell()),
          (_) => false,
        );
      }
    } on ApiException catch (e) {
      if (e.codigo == 'CLIENTE_JA_EXISTE_PRIMEIRO_ACESSO' && mounted) {
        final irLogin = await showDialog<bool>(
          context: context,
          builder: (ctx) => AlertDialog(
            title: const Text('Você já é cliente'),
            content: Text(e.message),
            actions: [
              TextButton(
                onPressed: () => Navigator.of(ctx).pop(false),
                child: const Text('Fechar'),
              ),
              FilledButton(
                onPressed: () => Navigator.of(ctx).pop(true),
                child: const Text('Ir para Entrar'),
              ),
            ],
          ),
        );
        if (irLogin == true && mounted) Navigator.of(context).pop(false);
        return;
      }
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(e.message)));
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Sem conexão — tente novamente')),
        );
      }
    } finally {
      if (mounted) setState(() => _enviando = false);
    }
  }

  String? _obrigatorio(String? v) =>
      (v == null || v.trim().isEmpty) ? 'Campo obrigatório' : null;

  @override
  Widget build(BuildContext context) {
    final ehCnpj = _tipo == 'CNPJ';
    return Scaffold(
      appBar: AppBar(title: const Text('Criar minha conta')),
      body: SafeArea(
        child: Form(
          key: _form,
          child: ListView(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
            children: [
              SegmentedButton<String>(
                segments: const [
                  ButtonSegment(value: 'CNPJ', label: Text('Empresa (CNPJ)')),
                  ButtonSegment(
                    value: 'CPF',
                    label: Text('Pessoa física (CPF)'),
                  ),
                ],
                selected: {_tipo},
                onSelectionChanged: (s) => setState(() {
                  _tipo = s.first;
                  // CPF não tem IE: limpar evita mandar IE de pessoa física no payload.
                  if (_tipo != 'CNPJ') {
                    _inscricaoEstadual.clear();
                    _isentoIe = false;
                  }
                }),
              ),
              const SizedBox(height: 16),
              TextFormField(
                controller: _documento,
                keyboardType: TextInputType.number,
                decoration: InputDecoration(labelText: ehCnpj ? 'CNPJ' : 'CPF'),
                validator: (v) {
                  final d = (v ?? '').replaceAll(RegExp(r'\D'), '');
                  final esperado = ehCnpj ? 14 : 11;
                  return d.length == esperado
                      ? null
                      : '${ehCnpj ? 'CNPJ' : 'CPF'} inválido';
                },
              ),
              const SizedBox(height: 14),
              TextFormField(
                controller: _nomeFantasia,
                decoration: InputDecoration(
                  labelText: ehCnpj ? 'Nome fantasia' : 'Nome do negócio',
                ),
                validator: _obrigatorio,
              ),
              if (ehCnpj) ...[
                const SizedBox(height: 14),
                TextFormField(
                  controller: _razaoSocial,
                  decoration: const InputDecoration(
                    labelText: 'Razão social (opcional)',
                  ),
                ),
                const SizedBox(height: 14),
                TextFormField(
                  controller: _inscricaoEstadual,
                  enabled: !_isentoIe,
                  keyboardType: TextInputType.number,
                  decoration: const InputDecoration(
                    labelText: 'Inscrição Estadual',
                  ),
                  validator: (v) {
                    if (!ehCnpj || _isentoIe) return null;
                    final d = (v ?? '').replaceAll(RegExp(r'\D'), '');
                    if (d.isEmpty) return 'Informe a IE ou marque Isento';
                    return d.length >= 8 && d.length <= 14
                        ? null
                        : 'Inscrição Estadual inválida';
                  },
                ),
                CheckboxListTile(
                  value: _isentoIe,
                  onChanged: (v) => setState(() {
                    _isentoIe = v ?? false;
                    if (_isentoIe) _inscricaoEstadual.clear();
                  }),
                  title: const Text('Isento de Inscrição Estadual'),
                  contentPadding: EdgeInsets.zero,
                  controlAffinity: ListTileControlAffinity.leading,
                ),
              ],
              const SizedBox(height: 14),
              TextFormField(
                controller: _email,
                keyboardType: TextInputType.emailAddress,
                decoration: const InputDecoration(
                  labelText: 'E-mail (opcional)',
                ),
                validator: (v) =>
                    (v ?? '').trim().isEmpty ||
                        ((v ?? '').contains('@') && (v ?? '').contains('.'))
                    ? null
                    : 'E-mail inválido',
              ),
              const SizedBox(height: 14),
              TextFormField(
                controller: _telefone,
                keyboardType: TextInputType.phone,
                decoration: const InputDecoration(
                  labelText: 'Telefone / WhatsApp',
                ),
                validator: (v) =>
                    (v ?? '').replaceAll(RegExp(r'\D'), '').length >= 10
                    ? null
                    : 'Informe o telefone com DDD',
              ),
              const SizedBox(height: 22),
              const Text(
                'Endereço',
                style: TextStyle(fontWeight: FontWeight.w700),
              ),
              const SizedBox(height: 8),
              TextFormField(
                controller: _cep,
                keyboardType: TextInputType.number,
                decoration: InputDecoration(
                  labelText: 'CEP',
                  suffixIcon: _buscandoCep
                      ? const Padding(
                          padding: EdgeInsets.all(12),
                          child: SizedBox(
                            width: 16,
                            height: 16,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          ),
                        )
                      : null,
                ),
                onChanged: (v) {
                  _codigoMunicipio = null;
                  if (v.replaceAll(RegExp(r'\D'), '').length == 8) _buscarCep();
                },
                validator: (v) =>
                    (v ?? '').replaceAll(RegExp(r'\D'), '').length == 8
                    ? null
                    : 'CEP inválido',
              ),
              const SizedBox(height: 14),
              TextFormField(
                controller: _logradouro,
                decoration: const InputDecoration(labelText: 'Rua / Avenida'),
                validator: _obrigatorio,
              ),
              const SizedBox(height: 14),
              Row(
                children: [
                  Expanded(
                    child: TextFormField(
                      controller: _numero,
                      decoration: const InputDecoration(labelText: 'Número'),
                      validator: _obrigatorio,
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    flex: 2,
                    child: TextFormField(
                      controller: _complemento,
                      decoration: const InputDecoration(
                        labelText: 'Complemento (opcional)',
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 14),
              TextFormField(
                controller: _bairro,
                decoration: const InputDecoration(labelText: 'Bairro'),
                validator: _obrigatorio,
              ),
              const SizedBox(height: 14),
              Row(
                children: [
                  Expanded(
                    flex: 3,
                    child: TextFormField(
                      controller: _cidade,
                      decoration: const InputDecoration(labelText: 'Cidade'),
                      validator: _obrigatorio,
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: TextFormField(
                      controller: _uf,
                      textCapitalization: TextCapitalization.characters,
                      maxLength: 2,
                      decoration: const InputDecoration(
                        labelText: 'UF',
                        counterText: '',
                      ),
                      validator: (v) =>
                          (v ?? '').trim().length == 2 ? null : 'UF',
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 14),
              DropdownButtonFormField<String>(
                initialValue: _categoria,
                decoration: const InputDecoration(
                  labelText: 'Categoria do estabelecimento (opcional)',
                ),
                items: categoriasEstabelecimento
                    .map((c) => DropdownMenuItem(value: c, child: Text(c)))
                    .toList(),
                onChanged: (v) => setState(() => _categoria = v),
              ),
              const SizedBox(height: 14),
              CampoSenha(
                controller: _senha,
                labelText: 'Senha (mín. 6 caracteres)',
                validator: (v) =>
                    (v ?? '').length >= 6 ? null : 'Mínimo de 6 caracteres',
              ),
              if (TenantTheme.instance.configuracoes['indicacoes_ativas'] ==
                  true) ...[
                const SizedBox(height: 14),
                TextFormField(
                  controller: _codigoIndicacao,
                  textCapitalization: TextCapitalization.characters,
                  decoration: const InputDecoration(
                    labelText: 'Código de indicação (opcional)',
                  ),
                ),
              ],
              const SizedBox(height: 22),
              FilledButton(
                onPressed: _enviando ? null : _cadastrar,
                child: _enviando
                    ? const SizedBox(
                        width: 22,
                        height: 22,
                        child: CircularProgressIndicator(
                          strokeWidth: 2.5,
                          color: Colors.white,
                        ),
                      )
                    : const Text('Criar conta'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
