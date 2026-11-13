import Link from 'next/link';
import type { Banner, ConfigLoja } from '@/lib/api/tipos';
import { linkWhatsapp } from '@/lib/site';
import { Banners } from './Banners';
import { SoVisitante } from './SoVisitante';
import estilos from './Abertura.module.css';

/** Topo da página inicial. Visitante: banners à esquerda e o convite para entrar ao lado (no celular,
 *  o convite vem embaixo). Cliente logado: o convite some e os banners ocupam a largura toda. */
export function Abertura({ banners, config }: { banners: Banner[]; config: ConfigLoja }) {
  const whatsapp = linkWhatsapp(config.contatoWhatsapp);
  return (
    <div className={`conteudo ${estilos.abertura}`}>
      {banners.length > 0 && <div className={estilos.banners}><Banners banners={banners} /></div>}
      <SoVisitante>
        <aside className={estilos.convite} aria-label="Como comprar">
          <span className={estilos.sobre}>Atacado para o seu comércio</span>
          <h2>Abasteça a sua loja <span>sem sair do balcão.</span></h2>
          <div className={estilos.acoes}>
            <Link href="/entrar" className={estilos.primario}>Já sou cliente: entrar</Link>
            {whatsapp && (
              <a href={whatsapp} target="_blank" rel="noopener noreferrer" className={estilos.secundario}>Quero ser cliente</a>
            )}
          </div>
        </aside>
      </SoVisitante>
    </div>
  );
}
