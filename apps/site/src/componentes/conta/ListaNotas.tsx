'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { NotaFiscal, Pagina } from '@/lib/conta/tipos';
import { formatarData } from '@/lib/formato/datas';
import { formatarPreco } from '@/lib/formato/preco';
import { useDadosConta } from './api-conta';
import { ArquivosNota } from './DetalhePedido';
import { Paginacao } from './ListaPedidos';
import { Carregando, ErroCarga, Vazio } from './Partes';
import estilos from './Conta.module.css';

export function ListaNotas() {
  const [pagina, setPagina] = useState(1);
  const carga = useDadosConta<Pagina<NotaFiscal>>(`/api/conta/notas?pagina=${pagina}`);
  const dados = carga.dados;

  return (
    <>
      <h1>Notas fiscais</h1>
      {carga.fase === 'erro' ? (
        <ErroCarga mensagem={carga.erro} aoTentar={carga.recarregar} />
      ) : !dados || (carga.fase === 'carregando' && dados.pagina !== pagina) ? (
        <Carregando />
      ) : dados.dados.length === 0 && pagina === 1 ? (
        <Vazio titulo="Nenhuma nota fiscal ainda">
          <p>Suas notas fiscais aparecem aqui assim que a distribuidora faturar seus pedidos.</p>
        </Vazio>
      ) : (
        <>
          <Paginacao pagina={pagina} temMais={dados.temMais} ocupado={carga.fase === 'carregando'} aoMudar={setPagina} />
          {dados.dados.length === 0 ? <p className={estilos.suave}>Não há notas mais antigas.</p> : (
            <table className={estilos.tabela}>
              <thead>
                <tr><th>NF-e</th><th>Emitida em</th><th>Pedido</th><th className={estilos.direita}>Total</th><th>Arquivos</th></tr>
              </thead>
              <tbody>
                {dados.dados.map((n) => (
                  <tr key={n.pedidoId}>
                    <td data-rotulo="NF-e"><strong>Nº {n.numero}</strong></td>
                    <td data-rotulo="Emitida em">{formatarData(n.emitidaEm)}</td>
                    <td data-rotulo="Pedido"><Link href={`/conta/pedidos/${n.pedidoId}`}>Nº {n.numeroPedido}</Link></td>
                    <td data-rotulo="Total" className={estilos.direita}>{formatarPreco(n.total)}</td>
                    <td data-rotulo="Arquivos"><ArquivosNota pedidoId={n.pedidoId} nota={n} /></td>
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
