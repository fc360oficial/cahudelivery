export const TAMANHO_PAGINA = 25;

interface Props {
  pagina: number;
  qtdNaPagina: number;
  onMudar: (pagina: number) => void;
}

// A API não devolve o total — "tem mais" é inferido pela página cheia.
export function Paginacao({ pagina, qtdNaPagina, onMudar }: Props) {
  const temMais = qtdNaPagina === TAMANHO_PAGINA;
  if (pagina === 1 && !temMais) return null;
  return (
    <div className="filtros" style={{ justifyContent: 'flex-end', marginTop: 10 }}>
      <button className="btn-mini btn-claro" disabled={pagina === 1} onClick={() => onMudar(pagina - 1)}>
        ← Anterior
      </button>
      <span style={{ color: 'var(--texto-2)' }}>Página {pagina}</span>
      <button className="btn-mini btn-claro" disabled={!temMais} onClick={() => onMudar(pagina + 1)}>
        Próxima →
      </button>
    </div>
  );
}
