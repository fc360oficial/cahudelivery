import Link from 'next/link';
import type { Categoria, Marca, PaginaProdutos } from '@/lib/api/tipos';
import { hrefCom, ORDENS, ROTULO_ORDEM, type Filtros } from '@/lib/catalogo/filtros';
import { CartaoProduto } from './CartaoProduto';
import estilos from './ListaProdutos.module.css';

interface Props {
  titulo: string;
  base: string;
  fixos?: Record<string, string>;
  filtros: Filtros;
  pagina: PaginaProdutos;
  marcas: Marca[];
  subcategorias: Categoria[];
  limiteEstoqueBaixo: number;
  vazio: string;
}

export function ListaProdutos({ titulo, base, fixos = {}, filtros, pagina, marcas, subcategorias, limiteEstoqueBaixo, vazio }: Props) {
  const link = (m: Partial<Filtros>) => hrefCom(base, filtros, m, fixos);
  const opcao = (ativo: boolean) => `${estilos.opcao} ${ativo ? estilos.ativo : ''}`;
  const chip = (ativo: boolean) => `${estilos.chip} ${ativo ? estilos.chipAtivo : ''}`;
  const temLateral = subcategorias.length > 0 || marcas.length > 1;
  return (
    <div className={`conteudo ${estilos.pagina}`}>
      <nav aria-label="Você está em" className={estilos.trilha}>
        <Link href="/">Início</Link><span aria-hidden="true">/</span><span>{titulo}</span>
      </nav>
      <div className={estilos.topo}>
        <h1>{titulo}</h1>
        <nav aria-label="Ordenar por" className={estilos.ordem}>
          <span className={estilos.rotulo}>Ordenar por</span>
          {ORDENS.map((o) => (
            <Link key={o} href={link({ ordem: o })} className={chip(filtros.ordem === o)} aria-current={filtros.ordem === o ? 'true' : undefined}>{ROTULO_ORDEM[o]}</Link>
          ))}
        </nav>
      </div>

      <div className={temLateral ? estilos.colunas : undefined}>
        {temLateral && (
          <aside className={estilos.lateral} aria-label="Filtros">
            {subcategorias.length > 0 && (
              <nav aria-label="Subcategorias" className={estilos.grupo}>
                <h2>Categorias</h2>
                <Link href={link({ sub: null })} className={opcao(!filtros.sub)} aria-current={!filtros.sub ? 'true' : undefined}>Tudo</Link>
                {subcategorias.map((s) => (
                  <Link key={s.id} href={link({ sub: s.id })} className={opcao(filtros.sub === s.id)} aria-current={filtros.sub === s.id ? 'true' : undefined}>{s.nome}</Link>
                ))}
              </nav>
            )}
            {marcas.length > 1 && (
              <nav aria-label="Marcas" className={estilos.grupo}>
                <h2>Marcas</h2>
                <Link href={link({ marca: null })} className={opcao(!filtros.marca)} aria-current={!filtros.marca ? 'true' : undefined}>Todas</Link>
                {marcas.map((m) => (
                  <Link key={m.id} href={link({ marca: m.id })} className={opcao(filtros.marca === m.id)} aria-current={filtros.marca === m.id ? 'true' : undefined}>
                    {m.nome}<span className={estilos.conta}>{m.produtos}</span>
                  </Link>
                ))}
              </nav>
            )}
          </aside>
        )}

        <div className={estilos.resultado}>
          {pagina.dados.length === 0 ? (
            <p className={estilos.vazio}>{vazio}</p>
          ) : (
            <div className={estilos.grade}>
              {pagina.dados.map((p) => <CartaoProduto key={p.id} produto={p} limiteEstoqueBaixo={limiteEstoqueBaixo} />)}
            </div>
          )}

          {(filtros.pagina > 1 || pagina.temMais) && (
            <nav aria-label="Páginas" className={estilos.paginas}>
              {filtros.pagina > 1
                ? <Link href={link({ pagina: filtros.pagina - 1 })} className={estilos.botao}>Anterior</Link>
                : <span />}
              <span>Página {filtros.pagina}</span>
              {pagina.temMais
                ? <Link href={link({ pagina: filtros.pagina + 1 })} className={estilos.botao}>Próxima</Link>
                : <span />}
            </nav>
          )}
        </div>
      </div>
    </div>
  );
}
