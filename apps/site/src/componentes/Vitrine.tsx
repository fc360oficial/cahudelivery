import Link from 'next/link';
import type { Patrocinador, Produto } from '@/lib/api/tipos';
import { CartaoProduto } from './CartaoProduto';
import { Trilho } from './Trilho';
import estilos from './Vitrine.module.css';

function Fileira({ produtos, limiteEstoqueBaixo, rotulo, porLinha }: {
  produtos: Produto[]; limiteEstoqueBaixo: number; rotulo: string; porLinha?: number;
}) {
  return (
    <Trilho rotulo={rotulo} porLinha={porLinha}>
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

/** Vitrine de marca. No computador: à esquerda o banner do fornecedor inteiro (sem corte) com o nome
 *  da marca, e os produtos ao lado. No celular: o banner em cima e os produtos rolando embaixo.
 *  O logo redondo só aparece quando não há banner, para a marca não aparecer duas vezes. */
export function VitrinePatrocinada({ patrocinador, limiteEstoqueBaixo }: { patrocinador: Patrocinador; limiteEstoqueBaixo: number }) {
  return (
    <section className={estilos.patrocinada} aria-label={`Produtos ${patrocinador.nome}`}>
      <div className={estilos.apresentacao}>
        {patrocinador.bannerUrl ? (
          <div className={estilos.bannerPatrocinio}>
            <img src={patrocinador.bannerUrl} alt="" loading="lazy" decoding="async" />
          </div>
        ) : patrocinador.logoUrl && (
          <img src={patrocinador.logoUrl} alt="" loading="lazy" className={estilos.logoMarca} />
        )}
        <div className={estilos.marca}>
          <span className={estilos.patrocinado}>Marca em destaque</span>
          <h2>{patrocinador.nome}</h2>
          <p>{patrocinador.produtos.length === 1 ? '1 produto' : `${patrocinador.produtos.length} produtos`} com preço de atacado</p>
        </div>
      </div>
      <Fileira produtos={patrocinador.produtos} limiteEstoqueBaixo={limiteEstoqueBaixo} rotulo={patrocinador.nome} porLinha={4} />
    </section>
  );
}
