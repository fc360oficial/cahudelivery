import type { ConfigLoja } from '@/lib/api/tipos';
import { linkWhatsapp } from '@/lib/site';
import estilos from './Rodape.module.css';

export function Rodape({ config }: { config: ConfigLoja }) {
  const whatsapp = linkWhatsapp(config.contatoWhatsapp);
  return (
    <footer className={estilos.rodape}>
      <div className={`conteudo ${estilos.linha}`}>
        <div><strong>{config.distribuidora}</strong></div>
        {whatsapp && (
          <div>Atendimento: <a href={whatsapp} target="_blank" rel="noopener noreferrer">{config.contatoWhatsapp}</a></div>
        )}
        <div>Também no celular: <strong>app {config.appNome}</strong></div>
      </div>
    </footer>
  );
}