import './vendas.css';

/** Blocos compartilhados das telas de Vendas. Estilos em vendas.css, sob .area-vendas. */

export function Cartao({ children, className, style }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  return <div className={`cartao${className ? ` ${className}` : ''}`} style={style}>{children}</div>;
}

export function CabecalhoPagina({ titulo, subtitulo, acoes }: { titulo: string; subtitulo?: string; acoes?: React.ReactNode }) {
  return (
    <header className="cabecalho-pagina">
      <div>
        <h1>{titulo}</h1>
        {subtitulo && <p>{subtitulo}</p>}
      </div>
      {acoes && <div className="cabecalho-acoes">{acoes}</div>}
    </header>
  );
}

export type VarianteSelo = 'azul' | 'cinza' | 'verde' | 'amarelo' | 'vermelho';

export function Selo({ children, variante = 'cinza' }: { children: React.ReactNode; variante?: VarianteSelo }) {
  return <span className={`selo selo-${variante}`}>{children}</span>;
}

export function Vazio({ mensagem }: { mensagem: string }) {
  return <div className="vazio">{mensagem}</div>;
}

/** Tela ainda não construída (as próximas tarefas trocam por conteúdo real). */
export function EmConstrucao({ titulo }: { titulo: string }) {
  return (
    <>
      <CabecalhoPagina titulo={titulo} />
      <Cartao><Vazio mensagem="Esta tela está sendo construída." /></Cartao>
    </>
  );
}

export function formatarReais(n: number | string | null | undefined): string {
  return Number(n ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/** "10/11/2026 14:35" no fuso de Recife; texto vazio se a data for inválida. */
export function formatarDataHora(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('pt-BR', { timeZone: 'America/Recife', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
