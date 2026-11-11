import 'package:flutter/material.dart';

import '../core/tema.dart';

/// Tela vazia (lista sem itens, busca sem resultado).
class EstadoVazio extends StatelessWidget {
  const EstadoVazio({
    super.key,
    required this.icone,
    required this.titulo,
    this.texto,
    this.acao,
  });
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
            Icon(
              icone,
              size: 52,
              color: Cores.textoSuave.withValues(alpha: 0.6),
            ),
            const SizedBox(height: 12),
            Text(
              titulo,
              textAlign: TextAlign.center,
              style: const TextStyle(
                fontSize: 17,
                fontWeight: FontWeight.w700,
                color: Cores.marinho,
              ),
            ),
            if (texto != null) ...[
              const SizedBox(height: 6),
              Text(
                texto!,
                textAlign: TextAlign.center,
                style: const TextStyle(color: Cores.textoSuave),
              ),
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
  const EstadoErro({
    super.key,
    required this.mensagem,
    required this.aoTentarDeNovo,
  });
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
  const CaixaAviso({
    super.key,
    required this.texto,
    this.tom = TomAviso.atencao,
    this.icone,
    this.titulo,
  });
  final String texto;
  final String? titulo;
  final TomAviso tom;
  final IconData? icone;

  @override
  Widget build(BuildContext context) {
    final (fundo, borda, cor, ic) = switch (tom) {
      TomAviso.info => (
        const Color(0xFFEAF1FF),
        const Color(0xFFBFD3FA),
        Cores.marinho,
        Icons.info_outline_rounded,
      ),
      TomAviso.atencao => (
        Cores.amarelo.withValues(alpha: 0.18),
        Cores.amarelo,
        Cores.marinho,
        Icons.warning_amber_rounded,
      ),
      TomAviso.erro => (
        const Color(0xFFFDECEC),
        const Color(0xFFF0B5B5),
        Cores.erro,
        Icons.block_rounded,
      ),
    };
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: fundo,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: borda),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icone ?? ic, color: cor, size: 22),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (titulo != null)
                  Text(
                    titulo!,
                    style: TextStyle(color: cor, fontWeight: FontWeight.w800),
                  ),
                Text(
                  texto,
                  style: TextStyle(color: cor, fontWeight: FontWeight.w600),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// Etiqueta pequena em pílula (Ativo, Pendente, Entrega, Retirada, App do cliente...).
class Etiqueta extends StatelessWidget {
  const Etiqueta(this.texto, {super.key, this.cor = Cores.azul, this.icone});
  final String texto;
  final Color cor;
  final IconData? icone;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 3),
      decoration: BoxDecoration(
        color: cor.withValues(alpha: 0.13),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icone != null) ...[
            Icon(icone, size: 14, color: cor),
            const SizedBox(width: 4),
          ],
          Flexible(
            child: Text(
              texto,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                color: cor,
                fontSize: 12,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Cartão branco da referência: cantos de 16, sombra suave azul-marinho (desenhada como BoxShadow, que sai igual
/// em qualquer aparelho) e o conteúdo recortado nos cantos. Aceita um [shape] para o contorno de "selecionado".
class Cartao extends StatelessWidget {
  const Cartao({super.key, required this.child, this.color = Colors.white, this.shape, this.margin, this.clipBehavior = Clip.antiAlias});
  final Widget child;
  final Color color;
  final ShapeBorder? shape;
  final EdgeInsetsGeometry? margin;
  final Clip clipBehavior;

  @override
  Widget build(BuildContext context) {
    final forma = shape ?? RoundedRectangleBorder(borderRadius: BorderRadius.circular(16));
    return Container(
      margin: margin,
      decoration: ShapeDecoration(
        color: color,
        shape: forma,
        shadows: const [BoxShadow(color: Color(0x0F0B1F4B), blurRadius: 24, spreadRadius: -4, offset: Offset(0, 8))],
      ),
      child: Material(type: MaterialType.transparency, shape: forma, clipBehavior: clipBehavior, child: child),
    );
  }
}

/// Ícone azul dentro de um quadrado (ou círculo) azul-claro, como nos cartões da referência.
class IconeCaixa extends StatelessWidget {
  const IconeCaixa(
    this.icone, {
    super.key,
    this.tamanho = 48,
    this.redondo = false,
    this.cor = Cores.azul,
    this.fundo = Cores.azulClaro,
  });
  final IconData icone;
  final double tamanho;
  final bool redondo;
  final Color cor, fundo;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: tamanho,
      height: tamanho,
      decoration: BoxDecoration(
        color: fundo,
        shape: redondo ? BoxShape.circle : BoxShape.rectangle,
        borderRadius: redondo ? null : BorderRadius.circular(tamanho * 0.3),
      ),
      child: Icon(icone, color: cor, size: tamanho * 0.52),
    );
  }
}

/// Barra azul-marinho das telas que moram dentro da casca (abas): título centralizado, seta de voltar
/// e ações. Telas empilhadas usam o `AppBar` do tema, que tem o mesmo desenho.
class TopoTela extends StatelessWidget {
  const TopoTela({
    super.key,
    required this.titulo,
    this.aoVoltar,
    this.acoes = const [],
  });
  final String titulo;
  final VoidCallback? aoVoltar;
  final List<Widget> acoes;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Cores.marinho,
      child: SafeArea(
        bottom: false,
        child: SizedBox(
          height: kToolbarHeight,
          child: Row(
            children: [
              SizedBox(
                width: 56,
                child: aoVoltar == null
                    ? null
                    : IconButton(
                        tooltip: 'Voltar',
                        color: Colors.white,
                        icon: const Icon(Icons.arrow_back_rounded),
                        onPressed: aoVoltar,
                      ),
              ),
              Expanded(
                child: Text(
                  titulo,
                  textAlign: TextAlign.center,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 20,
                    fontWeight: FontWeight.w700,
                    color: Colors.white,
                  ),
                ),
              ),
              SizedBox(
                width: 56,
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.end,
                  children: acoes,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Campo de busca padrão das listas: cinza-azulado, bem arredondado, sem borda.
class CampoBusca extends StatelessWidget {
  const CampoBusca({
    super.key,
    required this.controlador,
    required this.dica,
    required this.aoMudar,
    this.chave,
    this.foco,
  });
  final TextEditingController controlador;
  final String dica;
  final ValueChanged<String> aoMudar;
  final Key? chave;
  final FocusNode? foco;

  @override
  Widget build(BuildContext context) {
    const sem = OutlineInputBorder(
      borderRadius: BorderRadius.all(Radius.circular(16)),
      borderSide: BorderSide.none,
    );
    return TextField(
      key: chave,
      controller: controlador,
      focusNode: foco,
      onChanged: aoMudar,
      textInputAction: TextInputAction.search,
      decoration: InputDecoration(
        hintText: dica,
        hintStyle: const TextStyle(color: Cores.textoSuave),
        filled: true,
        fillColor: Cores.cinzaChip,
        border: sem,
        enabledBorder: sem,
        focusedBorder: const OutlineInputBorder(
          borderRadius: BorderRadius.all(Radius.circular(16)),
          borderSide: BorderSide(color: Cores.azul, width: 1.5),
        ),
        prefixIcon: const Icon(Icons.search_rounded, color: Cores.textoSuave),
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
    child: Text(
      texto,
      style: const TextStyle(
        fontSize: 13,
        fontWeight: FontWeight.w800,
        color: Cores.marinho,
        letterSpacing: 0.3,
      ),
    ),
  );
}

/// Linha "rótulo: valor" dos cartões de detalhe.
class LinhaInfo extends StatelessWidget {
  const LinhaInfo(
    this.rotulo,
    this.valor, {
    super.key,
    this.destaque = false,
    this.corValor,
  });
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
          Expanded(
            flex: 4,
            child: Text(
              rotulo,
              style: const TextStyle(color: Cores.textoSuave),
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            flex: 6,
            child: Text(
              valor,
              textAlign: TextAlign.right,
              style: TextStyle(
                fontWeight: destaque ? FontWeight.w800 : FontWeight.w600,
                color: corValor ?? Cores.texto,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Chip de filtro em pílula (categorias do catálogo, situação dos pedidos): ativo = azul cheio com texto
/// branco; inativo = cinza-claro. Alvo de toque de 48 dp de altura.
class ChipFiltro extends StatelessWidget {
  const ChipFiltro({
    super.key,
    required this.rotulo,
    required this.ativo,
    required this.aoTocar,
  });
  final String rotulo;
  final bool ativo;
  final VoidCallback aoTocar;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(right: 8),
      child: Center(
        child: Semantics(
          button: true,
          selected: ativo,
          child: GestureDetector(
            behavior: HitTestBehavior.opaque,
            onTap: aoTocar,
            child: ConstrainedBox(
              constraints: const BoxConstraints(minHeight: 48, minWidth: 48),
              child: Center(
                child: AnimatedContainer(
                  duration: const Duration(milliseconds: 150),
                  padding: const EdgeInsets.symmetric(
                    horizontal: 18,
                    vertical: 9,
                  ),
                  decoration: BoxDecoration(
                    color: ativo ? Cores.azul : Cores.cinzaChip,
                    borderRadius: BorderRadius.circular(22),
                  ),
                  child: Text(
                    rotulo,
                    style: TextStyle(
                      fontWeight: ativo ? FontWeight.w700 : FontWeight.w500,
                      color: ativo ? Colors.white : Cores.texto,
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Lista com puxar-para-atualizar que também funciona quando está vazia ([vazio] ocupa a tela).
class ListaAtualizavel extends StatelessWidget {
  const ListaAtualizavel({
    super.key,
    required this.aoAtualizar,
    required this.itens,
    this.vazio,
    this.padding = const EdgeInsets.all(16),
  });
  final Future<void> Function() aoAtualizar;
  final List<Widget> itens;
  final Widget? vazio;
  final EdgeInsetsGeometry padding;

  @override
  Widget build(BuildContext context) {
    return RefreshIndicator(
      onRefresh: aoAtualizar,
      child: itens.isEmpty && vazio != null
          ? LayoutBuilder(
              builder: (_, c) => ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                children: [SizedBox(height: c.maxHeight, child: vazio)],
              ),
            )
          : ListView(
              physics: const AlwaysScrollableScrollPhysics(),
              padding: padding,
              children: itens,
            ),
    );
  }
}
