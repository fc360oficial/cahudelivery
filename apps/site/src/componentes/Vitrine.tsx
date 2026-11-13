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

/** Vitrine de marca: um quadro com a identificação da marca e o banner do fornecedor inteiro (sem
 *  corte) no topo, e os produtos embaixo. No computador a marca fica à esquerda e o banner à direita,
 *  em tamanho médio; no celular o banner ocupa a largura toda e a marca vem logo abaixo. */
export function VitrinePatrocinada({ patrocinador, limiteEstoqueBaixo }: { patrocinador: Patrocinador; limiteEstoqueBaixo: number }) {
  return (
    <section className={estilos.patrocinada} aria-label={`Produtos ${patrocinador.nome}`}>
      <div className={estilos.apresentacao}>
        {patrocinador.bannerUrl && (
          <div className={estilos.bannerPatrocinio}>
            <img src={patrocinador.bannerUrl} alt="" loading="lazy" decoding="async" />
          </div>
        )}
        <div className={estilos.marca}>
          {patrocinador.logoUrl && <img src={patrocinador.logoUrl} alt="" loading="lazy" />}
          <div>
            <h2>{patrocinador.nome}</h2>
            <span className={estilos.patrocinado}>Marca em destaque</span>
          </div>
        </div>
      </div>
      <Fileira produtos={patrocinador.produtos} limiteEstoqueBaixo={limiteEstoqueBaixo} rotulo={patrocinador.nome} />
    </section>
  );
}
