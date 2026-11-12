import Link from 'next/link';
import type { Categoria, ConfigLoja } from '@/lib/api/tipos';
import { caminhoCategoria } from '@/lib/formato/caminhos';
import { linkWhatsapp } from '@/lib/site';
import estilos from './Cabecalho.module.css';

export function Cabecalho({ config, categorias }: { config: ConfigLoja; categorias: Categoria[] }) {
  const raizes = categorias.filter((c) => !c.paiId);
  const whatsapp = linkWhatsapp(config.contatoWhatsapp);
  return (
    <header>
      {whatsapp && (
        <div className={estilos.faixa}>
          <div className={`conteudo ${estilos.faixaLinha}`}>
            <span>Atendimento: {config.contatoWhatsapp}</span>
            <a href={whatsapp} target="_blank" rel="noopener noreferrer">Falar com a distribuidora</a>
          </div>
        </div>
      )}
      <div className={`conteudo ${estilos.principal}`}>
        <Link href="/" className={estilos.marca} aria-label={`${config.distribuidora}, página inicial`}>
          {config.logoUrl
            ? <img src={config.logoUrl} alt="" className={estilos.logo} />
            : <span className={estilos.nome}>{config.distribuidora}</span>}
        </Link>
        <form action="/busca" role="search" className={estilos.busca}>
          <label htmlFor="campo-busca" className="so-leitor">Buscar produto</label>
          <input id="campo-busca" name="q" type="search" placeholder="Buscar produto ou marca" required minLength={2} />
          <button type="submit" aria-label="Buscar">
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" />
            </svg>
          </button>
        </form>
        <Link href="/carrinho" className={estilos.carrinho}>
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 4h2l2.4 11h10.2L20 7H6.2" /><circle cx="9" cy="19" r="1.5" /><circle cx="17" cy="19" r="1.5" />
          </svg>
          <span>Carrinho</span>
        </Link>
      </div>
      <nav aria-label="Categorias" className={estilos.nav}>
        <div className={`conteudo ${estilos.navLinha}`}>
          {raizes.map((c) => (
            <Link key={c.id} href={caminhoCategoria(c)}>{c.nome}</Link>
          ))}
          <Link href="/ofertas" className={estilos.ofertas}>Ofertas da semana</Link>
        </div>
      </nav>
    </header>
  );
}