import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:webview_flutter/webview_flutter.dart';

import '../../core/api_client.dart';

/// Caminho da página de retorno do 3DS na nossa API (`/v1/pagamentos/3ds/{tenant}/ok|falhou`).
/// Quando o WebView chega nele, o desafio do banco acabou.
const _caminhoRetorno = '/v1/pagamentos/3ds/';

/// Desafio 3DS do banco emissor: o cliente confirma a compra no app/site do
/// banco. No app nativo abre num WebView e fecha sozinho na página de retorno;
/// no app web abre em outra aba e o cliente toca em "Já confirmei".
/// Devolve o status do pagamento depois de consultar a Rede
/// ('pago', 'pendente', 'expirado'...).
class Autenticacao3dsScreen extends StatefulWidget {
  const Autenticacao3dsScreen({super.key, required this.pedidoId, required this.url});
  final String pedidoId;
  final String url;

  @override
  State<Autenticacao3dsScreen> createState() => _Autenticacao3dsScreenState();
}

class _Autenticacao3dsScreenState extends State<Autenticacao3dsScreen> {
  WebViewController? _web;
  bool _conferindo = false;
  bool _terminou = false;

  @override
  void initState() {
    super.initState();
    if (kIsWeb) {
      launchUrl(Uri.parse(widget.url), webOnlyWindowName: '_blank');
      return;
    }
    _web = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setNavigationDelegate(NavigationDelegate(
        // POST do banco pra página de retorno não passa por onNavigationRequest
        // no Android — onPageStarted pega os dois casos.
        onNavigationRequest: (req) {
          if (req.url.contains(_caminhoRetorno)) {
            _voltouDoBanco();
            return NavigationDecision.prevent;
          }
          return NavigationDecision.navigate;
        },
        onPageStarted: (url) {
          if (url.contains(_caminhoRetorno)) _voltouDoBanco();
        },
      ))
      ..loadRequest(Uri.parse(widget.url));
  }

  /// A página de retorno não diz se pagou: quem decide é a consulta na Rede.
  /// A autorização sai logo depois da autenticação, então tenta por ~30 s.
  Future<void> _voltouDoBanco() async {
    if (_terminou || _conferindo) return;
    setState(() => _conferindo = true);
    var status = 'pendente';
    for (var i = 0; i < 10; i++) {
      try {
        final r = await ApiClient.instance.post('/pedidos/${widget.pedidoId}/pagar-cartao/confirmar', {})
            as Map<String, dynamic>;
        status = '${r['status']}';
      } catch (_) {
        // sem rede: tenta de novo na próxima volta
      }
      if (status != 'pendente' || !mounted) break;
      await Future.delayed(const Duration(seconds: 3));
    }
    _terminou = true;
    if (mounted) Navigator.of(context).pop(status);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Confirmação no banco'),
        leading: IconButton(
          icon: const Icon(Icons.close),
          onPressed: _conferindo ? null : () => Navigator.of(context).pop('pendente'),
        ),
      ),
      body: Stack(
        children: [
          if (_web != null)
            WebViewWidget(controller: _web!)
          else
            Padding(
              padding: const EdgeInsets.all(24),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(Icons.verified_user_outlined, size: 56, color: Theme.of(context).colorScheme.primary),
                  const SizedBox(height: 16),
                  const Text(
                    'Abrimos a página do seu banco em outra aba. Confirme a compra lá e volte aqui.',
                    textAlign: TextAlign.center,
                    style: TextStyle(fontSize: 15, height: 1.4),
                  ),
                  const SizedBox(height: 20),
                  FilledButton(onPressed: _conferindo ? null : _voltouDoBanco, child: const Text('Já confirmei')),
                  TextButton(
                    onPressed: () => launchUrl(Uri.parse(widget.url), webOnlyWindowName: '_blank'),
                    child: const Text('Abrir a página do banco de novo'),
                  ),
                ],
              ),
            ),
          if (_conferindo)
            Container(
              color: Colors.white.withValues(alpha: 0.92),
              alignment: Alignment.center,
              child: const Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  CircularProgressIndicator(),
                  SizedBox(height: 16),
                  Text('Conferindo o pagamento…', style: TextStyle(fontSize: 15)),
                ],
              ),
            ),
        ],
      ),
    );
  }
}
