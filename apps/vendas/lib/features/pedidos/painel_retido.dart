import 'package:flutter/material.dart';

import '../../core/formatadores.dart';
import '../../core/tema.dart';
import '../../data/pedido_local.dart';
import '../../data/situacao_pedido.dart';
import '../../widgets/comuns.dart';

const _ambar = Color(0xFFB26A00);

/// "enviado → atual" de uma divergência, em texto ("Enviado R$ 10,00 → atual R$ 11,00"); nulo quando não se aplica.
String? comparacaoDaDivergencia(Divergencia d) => switch (d.tipo) {
      'preco' => 'Enviado ${moeda(d.enviado ?? 0)} → atual ${moeda(d.atual ?? 0)}',
      'estoque' => 'Pedido ${quantidade(d.enviado ?? 0)} → estoque ${quantidade(d.atual ?? 0)}',
      'credito' => 'Pedido ${moeda(d.enviado ?? 0)} → disponível ${moeda(d.atual ?? 0)}',
      _ => null,
    };

/// Estoque, crédito e produto sem preço não se confirmam: só o preço é "aceitar o valor atual".
bool divergenciaBloqueia(Divergencia d) => d.tipo != 'preco';

/// Painel "Este pedido está retido": cada motivo em palavras com enviado → atual, o novo total se
/// confirmar e as duas ações. Sem internet mostra o aviso e desliga os botões.
class PainelRetido extends StatelessWidget {
  const PainelRetido({
    super.key,
    required this.pedido,
    required this.online,
    required this.ocupado,
    required this.aoConfirmar,
    required this.aoCancelar,
  });
  final PedidoLocal pedido;
  final bool online, ocupado;
  final VoidCallback aoConfirmar, aoCancelar;

  @override
  Widget build(BuildContext context) {
    final divs = pedido.divergencias;
    final novoTotal = totalSeConfirmar(pedido);
    final bloqueia = divs.any(divergenciaBloqueia);
    final habilitado = online && !ocupado;
    return Container(
      key: const Key('painel-retido'),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Cores.amarelo.withValues(alpha: 0.16),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Cores.amarelo),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Row(
            children: [
              Icon(Icons.pause_circle_rounded, color: _ambar),
              SizedBox(width: 8),
              Expanded(
                child: Text('Este pedido está retido', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800, color: Cores.marinho)),
              ),
            ],
          ),
          const SizedBox(height: 4),
          const Text('Nada foi para o ERP. Alguma coisa mudou desde que você montou o pedido:', style: TextStyle(color: Cores.texto)),
          const SizedBox(height: 10),
          if (divs.isEmpty)
            const Text('O servidor não detalhou o motivo. Atualize a lista para ver os valores atuais.', style: TextStyle(color: Cores.textoSuave)),
          for (final d in divs) ...[
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(12), border: Border.all(color: Cores.linha)),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(d.titulo, style: const TextStyle(fontWeight: FontWeight.w800, color: Cores.marinho)),
                  const SizedBox(height: 2),
                  Text(d.descricao),
                  if (comparacaoDaDivergencia(d) != null) ...[
                    const SizedBox(height: 4),
                    Text(comparacaoDaDivergencia(d)!, style: const TextStyle(fontWeight: FontWeight.w700, color: _ambar)),
                  ],
                ],
              ),
            ),
            const SizedBox(height: 8),
          ],
          const SizedBox(height: 4),
          LinhaInfo('Total enviado', moeda(pedido.total)),
          if (novoTotal != null) LinhaInfo('Novo total se confirmar', moeda(novoTotal), destaque: true, corValor: Cores.marinho),
          if (bloqueia) ...[
            const SizedBox(height: 8),
            const CaixaAviso(
              key: Key('aviso-nao-confirma'),
              tom: TomAviso.info,
              texto: 'Estoque, limite de crédito e produto sem preço não se resolvem confirmando. '
                  'Se algo já foi resolvido, tente confirmar: o servidor confere de novo. Senão, cancele o pedido.',
            ),
          ],
          if (!online) ...[
            const SizedBox(height: 8),
            const CaixaAviso(
              key: Key('aviso-offline'),
              tom: TomAviso.info,
              icone: Icons.wifi_off_rounded,
              texto: 'Conecte-se à internet para confirmar ou cancelar.',
            ),
          ],
          const SizedBox(height: 12),
          FilledButton(
            key: const Key('confirmar-valores'),
            onPressed: habilitado ? aoConfirmar : null,
            child: ocupado
                ? const SizedBox(height: 22, width: 22, child: CircularProgressIndicator(strokeWidth: 2.5, color: Colors.white))
                : const Text('Confirmar com os valores atuais', textAlign: TextAlign.center),
          ),
          const SizedBox(height: 8),
          OutlinedButton(
            key: const Key('cancelar-pedido'),
            onPressed: habilitado ? aoCancelar : null,
            style: OutlinedButton.styleFrom(foregroundColor: Cores.erro, minimumSize: const Size.fromHeight(48)),
            child: const Text('Cancelar pedido'),
          ),
        ],
      ),
    );
  }
}
