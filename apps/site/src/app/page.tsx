import { AtalhosCategoria } from '@/componentes/AtalhosCategoria';
import { AvisoDesatualizado } from '@/componentes/AvisoDesatualizado';
import { Banners } from '@/componentes/Banners';
import { Vantagens } from '@/componentes/Vantagens';
import { Vitrine, VitrinePatrocinada } from '@/componentes/Vitrine';
import { buscarCategorias, buscarConfig, buscarHome } from '@/lib/api/catalogo';
import type { Categoria } from '@/lib/api/tipos';
import { montarSecoesHome } from '@/lib/catalogo/home';

export const revalidate = 60;

export default async function PaginaInicial() {
  const [home, config, categorias] = await Promise.all([
    buscarHome(), buscarConfig(), buscarCategorias().catch((): Categoria[] => []),
  ]);
  const secoes = montarSecoesHome(home);
  return (
    <>
      <AvisoDesatualizado geradoEm={Date.now()} />
      <Banners banners={home.banners} />
      <AtalhosCategoria categorias={categorias} />
      <div className="conteudo" style={{ display: 'flex', flexDirection: 'column', gap: 48, paddingBlock: 40 }}>
        {secoes.length === 0 && <p>Nenhum produto disponível no momento.</p>}
        {secoes.map((s) =>
          s.tipo === 'patrocinador'
            ? <VitrinePatrocinada key={s.chave} patrocinador={s.patrocinador} limiteEstoqueBaixo={config.limiteEstoqueBaixo} />
            : <Vitrine key={s.chave} titulo={s.titulo} produtos={s.produtos} verTodos={s.verTodos} limiteEstoqueBaixo={config.limiteEstoqueBaixo} />,
        )}
      </div>
      <Vantagens config={config} />
    </>
  );
}
