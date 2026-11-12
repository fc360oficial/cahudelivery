import Link from 'next/link';
import type { Patrocinador, Produto } from '@/lib/api/tipos';
import { CartaoProduto } from './CartaoProduto';
import { Trilho } from './Trilho';
import estilos from './Vitrine.module.css';

function Fileira({ produtos, limiteEstoqueBaixo, rotulo }: { produtos: Produto[]; limiteEstoqueBaixo: number; rotulo: string }) {
  return (
    <Trilho rotulo={rotulo}>
      {produtos.map((p) => (
        <div key={p.id}>
          <CartaoProduto produto={p} limiteEstoqueBaixo={limiteEstoqueBaixo} />
        </div>
      ))}
    </Trilho>
  );
}

export function Vitrine({ titulo, produtos, verTodos, limiteEstoqueBaixo }: {
  titulo: string; produtos: Produto[]; verTodos: string | null; limiteEstoqueBaixo: number;
}) {
  return (
    <section className={estilos.vitrine} aria-label={titulo}>
      <div className={estilos.topo}>
        <h2>{titulo}</h2>
        {verTodos && <Link href={verTodos}>Ver todos</Link>}
      </div>
      <Fileira produtos={produtos} limiteEstoqueBaixo={limiteEstoqueBaixo} rotulo={titulo} />
    </section>
  );
}

export function VitrinePatrocinada({ patrocinador, limiteEstoqueBaixo }: { patrocinador: Patrocinador; limiteEstoqueBaixo: number }) {
  return (
    <section className={estilos.vitrine} aria-label={`Produtos ${patrocinador.nome}`}>
      {patrocinador.bannerUrl && <img src={patrocinador.bannerUrl} alt="" loading="lazy" className={estilos.bannerPatrocinio} />}
      <div className={estilos.topo}>
        <div className={estilos.marca}>
          {patrocinador.logoUrl && <img src={patrocinador.logoUrl} alt="" loading="lazy" />}
          <h2>{patrocinador.nome}</h2>
        </div>
        <span className={estilos.patrocinado}>Patrocinado</span>
      </div>
      <Fileira produtos={patrocinador.produtos} limiteEstoqueBaixo={limiteEstoqueBaixo} rotulo={patrocinador.nome} />
    </section>
  );
}
