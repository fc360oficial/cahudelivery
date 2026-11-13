'use client';

import type { Carteira } from '@/lib/conta/tipos';
import { formatarData } from '@/lib/formato/datas';
import { formatarPreco } from '@/lib/formato/preco';
import { useDadosConta } from './api-conta';
import { Carregando, ErroCarga, Vazio } from './Partes';
import estilos from './Conta.module.css';

const comSinal = (v: number) => `${v >= 0 ? '+' : '−'} ${formatarPreco(Math.abs(v))}`;

/** Saldo e extrato (últimas 50 movimentações, como a API devolve). */
export function CarteiraConta() {
  const carga = useDadosConta<Carteira>('/api/conta/carteira');
  return (
    <>
      <h1>Carteira</h1>
      {carga.fase === 'erro' ? (
        <ErroCarga mensagem={carga.erro} aoTentar={carga.recarregar} />
      ) : !carga.dados ? (
        <Carregando />
      ) : (
        <>
          <section className={estilos.cartao} aria-labelledby="titulo-saldo">
            <span id="titulo-saldo" className={estilos.rotulo}>Saldo na carteira</span>
            <span className={`${estilos.valorGrande} ${carga.dados.saldo < 0 ? estilos.negativo : estilos.positivo}`}>
              {formatarPreco(carga.dados.saldo)}
            </span>
            <p className={estilos.suave}>Créditos lançados pela distribuidora (devolução, ajuste) e usados nos pedidos.</p>
          </section>
          {carga.dados.movimentos.length === 0 ? (
            <Vazio titulo="Sem movimentações">
              <p>Suas movimentações aparecerão aqui.</p>
            </Vazio>
          ) : (
            <section aria-labelledby="titulo-extrato" className={estilos.formulario}>
              <h2 id="titulo-extrato">Extrato</h2>
              <table className={estilos.tabela}>
                <thead>
                  <tr><th>Data</th><th>Descrição</th><th className={estilos.direita}>Valor</th></tr>
                </thead>
                <tbody>
                  {carga.dados.movimentos.map((m) => (
                    <tr key={m.id}>
                      <td data-rotulo="Data">{formatarData(m.criadoEm)}</td>
                      <td data-rotulo="Descrição">{m.motivo || '—'}</td>
                      <td data-rotulo="Valor" className={`${estilos.direita} ${m.valor >= 0 ? estilos.positivo : estilos.negativo}`}>
                        <strong>{comSinal(m.valor)}</strong>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </>
      )}
    </>
  );
}
