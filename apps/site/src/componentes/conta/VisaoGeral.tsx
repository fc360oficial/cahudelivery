'use client';

import Link from 'next/link';
import { SECOES_MENU } from '@/lib/conta/secoes';
import { aguardaPagamento, situacaoCadastro, statusPedido } from '@/lib/conta/status';
import type { ResumoConta } from '@/lib/conta/tipos';
import { formatarData } from '@/lib/formato/datas';
import { formatarPreco } from '@/lib/formato/preco';
import { useDadosConta } from './api-conta';
import { Carregando, ErroCarga, Etiqueta } from './Partes';
import estilos from './Conta.module.css';

export function VisaoGeral({ appNome }: { appNome: string }) {
  const carga = useDadosConta<ResumoConta>('/api/conta/resumo');

  if (carga.fase === 'carregando' && !carga.dados) return <><h1>Minha conta</h1><Carregando /></>;
  if (carga.fase === 'erro' || !carga.dados) return <><h1>Minha conta</h1><ErroCarga mensagem={carga.erro} aoTentar={carga.recarregar} /></>;

  const { perfil, ultimoPedido, credito, carteira } = carga.dados;
  const nome = perfil.nomeFantasia || perfil.razaoSocial || 'cliente';
  return (
    <>
      <h1>Minha conta</h1>
      <p className={estilos.subtitulo}>Olá, {nome}. Aqui estão seus pedidos, notas e dados, os mesmos do app {appNome}.</p>

      <div className={estilos.cartao}>
        <div className={estilos.topoCartao}>
          <h2>Situação do cadastro</h2>
          <Etiqueta rotulo={situacaoCadastro(perfil.status)} />
        </div>
        {perfil.status === 'pendente' && (
          <p className={estilos.suave}>Seu cadastro está em análise. Você já pode ver os preços e montar o carrinho; a distribuidora vai liberar seus pedidos em breve.</p>
        )}
        {perfil.status === 'bloqueado' && (
          <p className={estilos.suave}>Seu cadastro está bloqueado. Fale com a distribuidora.</p>
        )}
      </div>

      <div className={estilos.grade}>
        <section className={estilos.cartao} aria-labelledby="resumo-pedido">
          <h2 id="resumo-pedido">Último pedido</h2>
          {ultimoPedido ? (
            <>
              <p><strong>Pedido nº {ultimoPedido.numero}</strong> · {formatarData(ultimoPedido.criadoEm)}</p>
              <Etiqueta rotulo={statusPedido(ultimoPedido.status)} />
              <span className={estilos.valorGrande}>{formatarPreco(ultimoPedido.total)}</span>
              {aguardaPagamento(ultimoPedido.status) && <p className={estilos.suave}>Aguardando pagamento: pague pela página do pedido.</p>}
              <Link href={`/conta/pedidos/${ultimoPedido.id}`}>Ver pedido</Link>
            </>
          ) : (
            <>
              <p className={estilos.suave}>Você ainda não fez pedidos.</p>
              <Link href="/">Ver produtos</Link>
            </>
          )}
        </section>

        <section className={estilos.cartao} aria-labelledby="resumo-credito">
          <h2 id="resumo-credito">Crédito</h2>
          {credito ? (
            <p className={estilos.suave}>
              {credito.pendente ? 'Sua solicitação de crédito está em análise.' : 'Crédito para boleto a prazo indisponível.'}
            </p>
          ) : (
            <p className={estilos.suave}>Não foi possível carregar agora.</p>
          )}
          <Link href="/conta/credito">Ver crédito</Link>
        </section>

        <section className={estilos.cartao} aria-labelledby="resumo-carteira">
          <h2 id="resumo-carteira">Carteira</h2>
          {carteira ? (
            <>
              <span className={estilos.rotulo}>Saldo na carteira</span>
              <span className={`${estilos.valorGrande} ${estilos.positivo}`}>{formatarPreco(carteira.saldo)}</span>
            </>
          ) : (
            <p className={estilos.suave}>Não foi possível carregar agora.</p>
          )}
          <Link href="/conta/carteira">Ver extrato</Link>
        </section>
      </div>

      <section aria-labelledby="atalhos">
        <h2 id="atalhos" className="so-leitor">Atalhos</h2>
        <nav className={estilos.atalhos} aria-label="Atalhos da conta">
          {SECOES_MENU.map((s) => <Link key={s.caminho} href={s.caminho} className={estilos.atalho}>{s.rotulo}</Link>)}
        </nav>
      </section>
    </>
  );
}
