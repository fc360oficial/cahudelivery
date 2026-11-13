import Link from 'next/link';
import estilos from './PaginaTexto.module.css';

/** Página de texto corrido (políticas). O texto vem da retaguarda em parágrafos separados por linha
 *  em branco; linha curta toda em maiúsculas vira subtítulo. */
export function PaginaTexto({ titulo, texto }: { titulo: string; texto: string }) {
  const blocos = texto.split(/\r?\n\s*\r?\n/).map((b) => b.trim()).filter(Boolean);
  return (
    <div className={`conteudo ${estilos.pagina}`}>
      <nav aria-label="Você está em" className={estilos.trilha}>
        <Link href="/">Início</Link><span aria-hidden="true">/</span><span>{titulo}</span>
      </nav>
      <h1>{titulo}</h1>
      <div className={estilos.texto}>
        {blocos.map((b, i) =>
          b.length <= 80 && b === b.toUpperCase() && /[A-ZÀ-Ú]/.test(b)
            ? <h2 key={i}>{b}</h2>
            : <p key={i}>{b}</p>,
        )}
      </div>
    </div>
  );
}
