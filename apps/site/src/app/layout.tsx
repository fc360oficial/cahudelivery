import type { Metadata } from 'next';
import { Inter, Manrope } from 'next/font/google';
import type { CSSProperties, ReactNode } from 'react';
import { CarrinhoProvider } from '@/componentes/CarrinhoProvider';
import { Cabecalho } from '@/componentes/Cabecalho';
import { Rodape } from '@/componentes/Rodape';
import { SessaoProvider } from '@/componentes/SessaoProvider';
import { buscarCategorias, buscarConfig } from '@/lib/api/catalogo';
import type { Categoria } from '@/lib/api/tipos';
import { indexavel, siteUrl } from '@/lib/site';
import '@/estilos/tokens.css';

const fonteTexto = Inter({ subsets: ['latin'], variable: '--fonte-texto', display: 'swap' });
const fonteTitulo = Manrope({ subsets: ['latin'], weight: ['700', '800'], variable: '--fonte-titulo', display: 'swap' });

export async function generateMetadata(): Promise<Metadata> {
  const config = await buscarConfig();
  return {
    metadataBase: new URL(siteUrl()),
    title: { default: config.distribuidora, template: `%s | ${config.distribuidora}` },
    description: `Compre no atacado direto da ${config.distribuidora}, com preço por caixa e por unidade.`,
    robots: indexavel() ? undefined : { index: false, follow: false },
  };
}

export default async function Layout({ children }: { children: ReactNode }) {
  // Sem a config a página não existe (falha alto, cai no global-error); sem as categorias só some o menu.
  const [config, categorias] = await Promise.all([buscarConfig(), buscarCategorias().catch((): Categoria[] => [])]);
  // Cor de destaque do tenant (white label). Sem cor cadastrada, vale a do tokens.css.
  const tema = (config.corPrimaria ? { '--destaque': config.corPrimaria } : {}) as CSSProperties;
  return (
    <html lang="pt-BR" className={`${fonteTexto.variable} ${fonteTitulo.variable}`}>
      <body style={tema}>
        <CarrinhoProvider>
          <SessaoProvider>
            <Cabecalho config={config} categorias={categorias} />
            <main>{children}</main>
            <Rodape config={config} categorias={categorias} />
          </SessaoProvider>
        </CarrinhoProvider>
      </body>
    </html>
  );
}