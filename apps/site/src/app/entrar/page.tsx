import type { Metadata } from 'next';
import { FormularioEntrar } from '@/componentes/FormularioEntrar';
import { buscarConfig } from '@/lib/api/catalogo';
import { linkWhatsapp } from '@/lib/site';
import estilos from './entrar.module.css';

export const metadata: Metadata = { title: 'Entrar', robots: { index: false, follow: false } };

export default async function PaginaEntrar() {
  const config = await buscarConfig();
  return (
    <div className={`conteudo ${estilos.pagina}`}>
      <div className={estilos.cartao}>
        <h1>Entrar</h1>
        <FormularioEntrar appNome={config.appNome} whatsapp={linkWhatsapp(config.contatoWhatsapp)} />
      </div>
    </div>
  );
}
