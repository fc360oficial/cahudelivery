import { AvisoDesatualizado } from '@/componentes/AvisoDesatualizado';
import { Banners } from '@/componentes/Banners';
import { Vitrine, VitrinePatrocinada } from '@/componentes/Vitrine';
import { buscarConfig, buscarHome } from '@/lib/api/catalogo';
import { montarSecoesHome } from '@/lib/catalogo/home';

export const revalidate = 60;

export default async function PaginaInicial() {
  const [home, config] = await Promise.all([buscarHome(), buscarConfig()]);
  const secoes = montarSecoesHome(home);
  return (
    <>
      <AvisoDesatualizado geradoEm={Date.now()} />
      <Banners banners={home.banners} />
      <div className="conteudo" style={{ display: 'flex', flexDirection: 'column', gap: 72, paddingBlock: 56 }}>
        {secoes.length === 0 && <p>Nenhum produto disponível no momento.</p>}
        {secoes.map((s) =>
          s.tipo === 'patrocinador'
            ? <VitrinePatrocinada key={s.chave} patrocinador={s.patrocinador} limiteEstoqueBaixo={config.limiteEstoqueBaixo} />
            : <Vitrine key={s.chave} titulo={s.titulo} produtos={s.produtos} verTodos={s.verTodos} limiteEstoqueBaixo={config.limiteEstoqueBaixo} />,
        )}
      </div>
    </>
  );
}
