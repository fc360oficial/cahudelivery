import 'package:flutter/material.dart';

import '../core/tema.dart';
import '../data/situacao_pedido.dart';

const _ambar = Color(0xFFB26A00);

Color corDaSituacao(SituacaoPedido s) => switch (s) {
      SituacaoPedido.naFila || SituacaoPedido.enviando || SituacaoPedido.noErp => Cores.azul,
      SituacaoPedido.retido => _ambar,
      SituacaoPedido.aguardandoErp => Cores.marinho,
      SituacaoPedido.faturado => Cores.ok,
      SituacaoPedido.cancelado => Cores.textoSuave,
      SituacaoPedido.recusado => Cores.erro,
    };

/// Pílula de situação do pedido ("Na fila", "Retido", "Faturado"...).
class PilulaPedido extends StatelessWidget {
  const PilulaPedido(this.situacao, {super.key});
  final SituacaoPedido situacao;

  @override
  Widget build(BuildContext context) => _Pilula(situacao.rotulo, corDaSituacao(situacao));
}

/// Pílula de situação do orçamento ("Aberto", "Convertido"...).
class PilulaOrcamento extends StatelessWidget {
  const PilulaOrcamento(this.situacao, {super.key});
  final SituacaoOrcamento situacao;

  @override
  Widget build(BuildContext context) => _Pilula(
        situacao.rotulo,
        switch (situacao) {
          SituacaoOrcamento.aberto => Cores.azul,
          SituacaoOrcamento.aguardandoEnvio => _ambar,
          SituacaoOrcamento.convertido => Cores.ok,
          SituacaoOrcamento.cancelado => Cores.textoSuave,
          SituacaoOrcamento.recusado => Cores.erro,
        },
      );
}

class _Pilula extends StatelessWidget {
  const _Pilula(this.texto, this.cor);
  final String texto;
  final Color cor;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(color: cor.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(20)),
      child: Text(texto, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(color: cor, fontSize: 12, fontWeight: FontWeight.w800)),
    );
  }
}
