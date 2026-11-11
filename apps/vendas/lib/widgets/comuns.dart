import 'package:flutter/material.dart';

import '../core/tema.dart';

/// Tela vazia (lista sem itens, busca sem resultado).
class EstadoVazio extends StatelessWidget {
  const EstadoVazio({super.key, required this.icone, required this.titulo, this.texto, this.acao});
  final IconData icone;
  final String titulo;
  final String? texto;
  final Widget? acao;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icone, size: 52, color: Cores.textoSuave.withValues(alpha: 0.6)),
            const SizedBox(height: 12),
            Text(titulo, textAlign: TextAlign.center, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700, color: Cores.marinho)),
            if (texto != null) ...[
              const SizedBox(height: 6),
              Text(texto!, textAlign: TextAlign.center, style: const TextStyle(color: Cores.textoSuave)),
            ],
            if (acao != null) ...[const SizedBox(height: 16), acao!],
          ],
        ),
      ),
    );
  }
}

/// Erro com botão de tentar de novo.
class EstadoErro extends StatelessWidget {
  const EstadoErro({super.key, required this.mensagem, required this.aoTentarDeNovo});
  final String mensagem;
  final VoidCallback aoTentarDeNovo;

  @override
  Widget build(BuildContext context) => EstadoVazio(
        icone: Icons.error_outline_rounded,
        titulo: 'Algo deu errado',
        texto: mensagem,
        acao: OutlinedButton(
          onPressed: aoTentarDeNovo,
          style: OutlinedButton.styleFrom(minimumSize: const Size(180, 48)),
          child: const Text('Tentar de novo'),
        ),
      );
}

enum TomAviso { info, atencao, erro }

/// Caixa de aviso colorida (limite de crédito, dados antigos, cliente bloqueado...).
class CaixaAviso extends StatelessWidget {
  const CaixaAviso({super.key, required this.texto, this.tom = TomAviso.atencao, this.icone, this.titulo});
  final String texto;
  final String? titulo;
  final TomAviso tom;
  final IconData? icone;

  @override
  Widget build(BuildContext context) {
    final (fundo, borda, cor, ic) = switch (tom) {
      TomAviso.info => (const Color(0xFFEAF1FF), const Color(0xFFBFD3FA), Cores.marinho, Icons.info_outline_rounded),
      TomAviso.atencao => (Cores.amarelo.withValues(alpha: 0.18), Cores.amarelo, Cores.marinho, Icons.warning_amber_rounded),
      TomAviso.erro => (const Color(0xFFFDECEC), const Color(0xFFF0B5B5), Cores.erro, Icons.block_rounded),
    };
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(color: fundo, borderRadius: BorderRadius.circular(14), border: Border.all(color: borda)),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icone ?? ic, color: cor, size: 22),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (titulo != null) Text(titulo!, style: TextStyle(color: cor, fontWeight: FontWeight.w800)),
                Text(texto, style: TextStyle(color: cor, fontWeight: FontWeight.w600)),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// Etiqueta pequena (Entrega, Retirada, App do cliente...).
class Etiqueta extends StatelessWidget {
  const Etiqueta(this.texto, {super.key, this.cor = Cores.azul, this.icone});
  final String texto;
  final Color cor;
  final IconData? icone;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(color: cor.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(8)),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icone != null) ...[Icon(icone, size: 14, color: cor), const SizedBox(width: 4)],
          Flexible(
            child: Text(texto, overflow: TextOverflow.ellipsis, style: TextStyle(color: cor, fontSize: 12, fontWeight: FontWeight.w700)),
          ),
        ],
      ),
    );
  }
}

/// Campo de busca padrão das listas.
class CampoBusca extends StatelessWidget {
  const CampoBusca({super.key, required this.controlador, required this.dica, required this.aoMudar, this.chave});
  final TextEditingController controlador;
  final String dica;
  final ValueChanged<String> aoMudar;
  final Key? chave;

  @override
  Widget build(BuildContext context) {
    return TextField(
      key: chave,
      controller: controlador,
      onChanged: aoMudar,
      textInputAction: TextInputAction.search,
      decoration: InputDecoration(
        hintText: dica,
        prefixIcon: const Icon(Icons.search_rounded),
        suffixIcon: ListenableBuilder(
          listenable: controlador,
          builder: (_, _) => controlador.text.isEmpty
              ? const SizedBox.shrink()
              : IconButton(
                  tooltip: 'Limpar busca',
                  icon: const Icon(Icons.close_rounded),
                  onPressed: () {
                    controlador.clear();
                    aoMudar('');
                  },
                ),
        ),
        contentPadding: const EdgeInsets.symmetric(vertical: 14),
      ),
    );
  }
}

/// Título de seção.
class TituloSecao extends StatelessWidget {
  const TituloSecao(this.texto, {super.key});
  final String texto;
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(top: 4, bottom: 8),
        child: Text(texto, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w800, color: Cores.textoSuave, letterSpacing: 0.3)),
      );
}

/// Linha "rótulo: valor" dos cartões de detalhe.
class LinhaInfo extends StatelessWidget {
  const LinhaInfo(this.rotulo, this.valor, {super.key, this.destaque = false, this.corValor});
  final String rotulo, valor;
  final bool destaque;
  final Color? corValor;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 5),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(flex: 4, child: Text(rotulo, style: const TextStyle(color: Cores.textoSuave))),
          const SizedBox(width: 8),
          Expanded(
            flex: 6,
            child: Text(valor,
                textAlign: TextAlign.right,
                style: TextStyle(fontWeight: destaque ? FontWeight.w800 : FontWeight.w600, color: corValor ?? Cores.texto)),
          ),
        ],
      ),
    );
  }
}
