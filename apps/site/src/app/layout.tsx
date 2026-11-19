import type { Metadata } from 'next';
import { Inter, Manrope } from 'next/font/google';
import type { CSSProperties, ReactNode } from 'react';
import { CarrinhoProvider } from '@/componentes/CarrinhoProvider';
import { BarraInferior } from '@/componentes/BarraInferior';
import { Cabecalho } from '@/componentes/Cabecalho';
import { FavoritosProvider } from '@/componentes/FavoritosProvider';
import { Rodape } from '@/componentes/Rodape';
import { SessaoProvider } from '@/componentes/SessaoProvider';
import { buscarCategorias, buscarConfig, buscarHome } from '@/lib/api/catalogo';
import type { Categoria } from '@/lib/api/tipos';
import { indexavel, siteUrl } from '@/lib/site';
import '@/estilos/tokens.css';

const fonteTexto = Inter({ subsets: ['latin'], variable: '--fonte-texto', display: 'swap' });
const fonteTitulo = Manrope({ subsets: ['latin'], weight: ['700', '800'], variable: '--fonte-titulo', display: 'swap' });

export async function generateMetadata(): Promise<Metadata> {
  const config = await buscarConfig();
  const descricao = `Compre no atacado direto da ${config.distribuidora}, com preço por caixa e por unidade.`;
  return {
    metadataBase: new URL(siteUrl()),
    title: { default: config.distribuidora, template: `%s | ${config.distribuidora}` },
    description: descricao,
    // Cartão que o WhatsApp monta ao colar o link. A imagem é o opengraph-image.jpg desta pasta;
    // o ícone da aba e do atalho no celular são favicon.ico, icon.png e apple-icon.png.
    openGraph: { type: 'website', locale: 'pt_BR', siteName: config.distribuidora, title: config.distribuidora, description: descricao, url: '/' },
    robots: indexavel() ? undefined : { index: false, follow: false },
  };
}

export default async function Layout({ children }: { children: ReactNode }) {
  // Sem a config a página não existe (falha alto, cai no global-error); sem as categorias só some o menu.
  // A faixa de campanha vem da mesma chamada /home da página inicial (em cache); se falhar, vale a barra normal.
  const [config, categorias, faixa] = await Promise.all([
    buscarConfig(),
    buscarCategorias().catch((): Categoria[] => []),
    buscarHome().then((h) => h.faixaCampanha).catch(() => null),
  ]);
  // Cor de destaque do tenant (white label). Sem cor cadastrada, vale a do tokens.css.
  const tema = (config.corPrimaria ? { '--destaque': config.corPrimaria } : {}) as CSSProperties;
  return (
    <html lang="pt-BR" className={`${fonteTexto.variable} ${fonteTitulo.variable}`}>
      <body style={tema}>
        <CarrinhoProvider>
          <SessaoProvider>
            <FavoritosProvider>
              <Cabecalho config={config} categorias={categorias} faixa={faixa} />
              <main>{children}</main>
              <Rodape config={config} categorias={categorias} />
              <BarraInferior />
            </FavoritosProvider>
          </SessaoProvider>
        </CarrinhoProvider>
      </body>
    </html>
  );
}