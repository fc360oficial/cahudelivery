import type { Banner, ConfigLoja } from '@/lib/api/tipos';
import { linkWhatsapp } from '@/lib/site';
import { Banners } from './Banners';
import { QuadroAbertura } from './QuadroAbertura';
import estilos from './Abertura.module.css';

/** Topo da página inicial: banners à esquerda e um quadro ao lado (convite para o visitante,
 *  boas-vindas para o cliente logado). No celular o quadro vem embaixo dos banners. */
export function Abertura({ banners, config }: { banners: Banner[]; config: ConfigLoja }) {
  return (
    <div className={`conteudo ${estilos.abertura}`}>
      {banners.length > 0 && <div className={estilos.banners}><Banners banners={banners} /></div>}
      <QuadroAbertura whatsapp={linkWhatsapp(config.contatoWhatsapp)} />
    </div>
  );
}
