import Link from 'next/link';
import type { Categoria, ConfigLoja } from '@/lib/api/tipos';
import { caminhoCategoria } from '@/lib/formato/caminhos';
import { linkWhatsapp } from '@/lib/site';
import estilos from './Rodape.module.css';

const LOGO_PADRAO = '/marca/logo.png';

export function Rodape({ config, categorias }: { config: ConfigLoja; categorias: Categoria[] }) {
  const whatsapp = linkWhatsapp(config.contatoWhatsapp);
  const raizes = categorias.filter((c) => !c.paiId);
  return (
    <footer className={estilos.rodape}>
      <div className={`conteudo ${estilos.colunas}`}>
        <div className={estilos.sobre}>
          <img src={config.logoUrl ?? LOGO_PADRAO} alt={config.distribuidora} className={estilos.logo} width={132} height={34} loading="lazy" />
          <p className={estilos.lema}>A gente abastece.<br /><span>Você vende.</span></p>
          <p>Do nosso estoque para a sua prateleira, com preço de atacado.</p>
        </div>
        {raizes.length > 0 && (
          <nav aria-label="Departamentos">
            <h2>Departamentos</h2>
            <ul>
              {raizes.map((c) => <li key={c.id}><Link href={caminhoCategoria(c)}>{c.nome}</Link></li>)}
              <li><Link href="/ofertas">Ofertas da semana</Link></li>
            </ul>
          </nav>
        )}
        <div>
          <h2>Atendimento</h2>
          <ul>
            {whatsapp && <li><a href={whatsapp} target="_blank" rel="noopener noreferrer">WhatsApp {config.contatoWhatsapp}</a></li>}
            {config.horarioSemana && <li>Segunda a sexta, {config.horarioSemana}</li>}
            {config.horarioSabado && <li>Sábado, {config.horarioSabado}</li>}
          </ul>
        </div>
        <div>
          <h2>No celular</h2>
          <ul><li>Peça também pelo app <strong>{config.appNome}</strong></li></ul>
        </div>
      </div>
      <div className={estilos.base}>
        <div className="conteudo">{config.distribuidora} · Venda exclusiva para pessoa jurídica</div>
      </div>
      {whatsapp && (
        <a href={whatsapp} target="_blank" rel="noopener noreferrer" className={estilos.flutuante}>
          <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12a8.5 8.5 0 0 1-12.6 7.4L3 21l1.7-5.1A8.5 8.5 0 1 1 21 12z" />
          </svg>
          <span><strong>Dúvida no pedido?</strong> Fale com o vendedor</span>
        </a>
      )}
    </footer>
  );
}
