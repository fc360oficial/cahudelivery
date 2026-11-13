import Link from 'next/link';
import type { Categoria, ConfigLoja } from '@/lib/api/tipos';
import { caminhoCategoria } from '@/lib/formato/caminhos';
import { formatarPreco } from '@/lib/formato/preco';
import { linkWhatsapp } from '@/lib/site';
import { BotaoConta } from './BotaoConta';
import { ContadorCarrinho } from './ContadorCarrinho';
import { MenuRecolhivel } from './MenuRecolhivel';
import estilos from './Cabecalho.module.css';

/** Logo do tenant; sem logo cadastrado, usa o arquivo da instalação em public/marca/logo.png. */
const LOGO_PADRAO = '/marca/logo.png';

export function Cabecalho({ config, categorias }: { config: ConfigLoja; categorias: Categoria[] }) {
  const raizes = categorias.filter((c) => !c.paiId);
  const whatsapp = linkWhatsapp(config.contatoWhatsapp);
  return (
    <header className={estilos.cabecalho}>
      <div className={estilos.faixa}>
        <div className={`conteudo ${estilos.faixaLinha}`}>
          <span>
            Venda exclusiva para CNPJ
            {config.pedidoMinimo != null && <> · Pedido mínimo {formatarPreco(config.pedidoMinimo)}</>}
          </span>
          {whatsapp && (
            <a href={whatsapp} target="_blank" rel="noopener noreferrer">
              <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12a8.5 8.5 0 0 1-12.6 7.4L3 21l1.7-5.1A8.5 8.5 0 1 1 21 12z" />
              </svg>
              Falar com a distribuidora
            </a>
          )}
        </div>
      </div>
      <div className={estilos.barra}>
        <div className={`conteudo ${estilos.principal}`}>
          <Link href="/" className={estilos.marca} aria-label={`${config.distribuidora}, página inicial`}>
            <img src={config.logoUrl ?? LOGO_PADRAO} alt="" className={estilos.logo} width={148} height={38} />
          </Link>
          <form action="/busca" role="search" className={estilos.busca}>
            <label htmlFor="campo-busca" className="so-leitor">Buscar produto</label>
            <input id="campo-busca" name="q" type="search" placeholder="O que sua loja precisa hoje?" required minLength={2} />
            <button type="submit" aria-label="Buscar">
              <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                <circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" />
              </svg>
            </button>
          </form>
          <div className={estilos.acoes}>
            <BotaoConta />
            <Link href="/carrinho" className={estilos.carrinho}>
              <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 4h2l2.4 11h10.2L20 7H6.2" /><circle cx="9" cy="19" r="1.5" /><circle cx="17" cy="19" r="1.5" />
              </svg>
              <span>Carrinho</span>
              <ContadorCarrinho />
            </Link>
          </div>
        </div>
      </div>
      <div className={estilos.nav}>
        <div className={`conteudo ${estilos.navLinha}`}>
          {raizes.length > 0 && (
            <MenuRecolhivel className={estilos.mega}>
              <summary>
                <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
                Todos os departamentos
              </summary>
              <div className={estilos.megaPainel}>
                {raizes.map((c) => {
                  const filhas = categorias.filter((f) => f.paiId === c.id);
                  return (
                    <div key={c.id} className={estilos.megaColuna}>
                      <Link href={caminhoCategoria(c)} className={estilos.megaTitulo}>{c.nome}</Link>
                      {filhas.slice(0, 8).map((f) => (
                        <Link key={f.id} href={`${caminhoCategoria(c)}?sub=${f.id}`}>{f.nome}</Link>
                      ))}
                      {filhas.length > 8 && <Link href={caminhoCategoria(c)} className={estilos.megaMais}>Ver tudo</Link>}
                    </div>
                  );
                })}
              </div>
            </MenuRecolhivel>
          )}
          <nav aria-label="Categorias" className={estilos.atalhos}>
            {raizes.map((c) => (
              <Link key={c.id} href={caminhoCategoria(c)}>{c.nome}</Link>
            ))}
          </nav>
          <Link href="/ofertas" className={estilos.ofertas}>
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M13 2 4 14h6l-1 8 9-12h-6z" /></svg>
            Ofertas da semana
          </Link>
        </div>
      </div>
    </header>
  );
}
