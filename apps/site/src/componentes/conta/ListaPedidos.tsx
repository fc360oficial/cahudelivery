'use client';

import Link from 'next/link';
import { useState } from 'react';
import { aguardaPagamento, rotuloFormaPagamento, statusPedido } from '@/lib/conta/status';
import type { Pagina, PedidoResumo } from '@/lib/conta/tipos';
import { formatarData } from '@/lib/formato/datas';
import { formatarPreco } from '@/lib/formato/preco';
import { useDadosConta } from './api-conta';
import { Aviso, Carregando, ErroCarga, Etiqueta, Vazio } from './Partes';
import estilos from './Conta.module.css';

/** Botões de página ficam acima da lista. */
export function Paginacao({ pagina, temMais, ocupado, aoMudar }: { pagina: number; temMais: boolean; ocupado: boolean; aoMudar: (p: number) => void }) {
  if (pagina === 1 && !temMais) return null;
  return (
    <div className={estilos.paginas}>
      <button type="button" className={`${estilos.secundario} ${estilos.pequeno}`} disabled={pagina <= 1 || ocupado} onClick={() => aoMudar(pagina - 1)}>
        ← Mais recentes
      </button>
      <span>Página {pagina}</span>
      <button type="button" className={`${estilos.secundario} ${estilos.pequeno}`} disabled={!temMais || ocupado} onClick={() => aoMudar(pagina + 1)}>
        Mais antigos →
      </button>
    </div>
  );
}

export function ListaPedidos({ avisoConferir = false }: { avisoConferir?: boolean }) {
  const [pagina, setPagina] = useState(1);
  const carga = useDadosConta<Pagina<PedidoResumo>>(`/api/conta/pedidos?pagina=${pagina}`);
  const dados = carga.dados;

  return (
    <>
      <h1>Meus pedidos</h1>
      {avisoConferir && (
        <Aviso tipo="info">
          Não recebemos a confirmação do seu último envio, mas o carrinho foi esvaziado. Confira abaixo se o pedido aparece;
          se não aparecer em alguns minutos, fale com a distribuidora antes de fazer outro.
        </Aviso>
      )}
      {carga.fase === 'erro' ? (
        <ErroCarga mensagem={carga.erro} aoTentar={carga.recarregar} />
      ) : !dados || (carga.fase === 'carregando' && dados.pagina !== pagina) ? (
        <Carregando />
      ) : dados.dados.length === 0 && pagina === 1 ? (
        <Vazio titulo="Nenhum pedido ainda">
          <p>Seus pedidos e o andamento de cada um aparecem aqui.</p>
          <Link href="/" className={estilos.primario}>Ver produtos</Link>
        </Vazio>
      ) : (
        <>
          <Paginacao pagina={pagina} temMais={dados.temMais} ocupado={carga.fase === 'carregando'} aoMudar={setPagina} />
          {dados.dados.length === 0 ? <p className={estilos.suave}>Não há pedidos mais antigos.</p> : (
          <table className={estilos.tabela}>
            <thead>
              <tr><th>Pedido</th><th>Data</th><th>Status</th><th>Pagamento</th><th className={estilos.direita}>Total</th></tr>
            </thead>
            <tbody>
              {dados.dados.map((p) => (
                <tr key={p.id}>
                  <td data-rotulo="Pedido"><Link href={`/conta/pedidos/${p.id}`}>Nº {p.numero}</Link></td>
                  <td data-rotulo="Data">{formatarData(p.criadoEm)}</td>
                  <td data-rotulo="Status">
                    <Etiqueta rotulo={statusPedido(p.status)} />
                    {aguardaPagamento(p.status) && <> <Link href={`/conta/pedidos/${p.id}`} className={estilos.suave}>Pagar</Link></>}
                  </td>
                  <td data-rotulo="Pagamento">{rotuloFormaPagamento(p.formaPagamento)}</td>
                  <td data-rotulo="Total" className={estilos.direita}><strong>{formatarPreco(p.total)}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
          )}
        </>
      )}
    </>
  );
}
