import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api';
import { CabecalhoPagina, Cartao, formatarDataHora, formatarReais, Selo, Vazio, type VarianteSelo } from '../../vendas-ui';
import './inicio-pedidos.css';

interface Orcamento {
  id: string;
  status: string;
  criadoEm: string;
  atualizadoEm: string;
  cliente: string;
  clienteCodigo: string | null;
  clienteDocumento: string | null;
  vendedor: string | null;
  tabela: string | null;
  forma: string | null;
  tipoEntrega: string;
  observacoes: string | null;
  total: number;
  pedidoId: string | null;
  pedidoNumero: number | null;
  itens: { produto: string; codigo: string | null; quantidade: number; precoUnit: number; total: number }[];
}

const SITUACAO: Record<string, [string, VarianteSelo]> = {
  aberto: ['Aberto', 'azul'],
  convertido: ['Convertido', 'verde'],
  cancelado: ['Cancelado', 'vermelho'],
};

export function VendasOrcamentoDetalhe() {
  const { id } = useParams();
  const [o, setO] = useState<Orcamento | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    setO(null);
    setErro(null);
    api<Orcamento>(`/admin/vendas/orcamentos/${id}`)
      .then((r) => { if (vivo) setO(r); })
      .catch((e: Error) => { if (vivo) setErro(e.message || 'Não foi possível carregar o orçamento.'); });
    return () => { vivo = false; };
  }, [id]);

  const voltar = <Link className="voltar-link" to="/vendas/orcamentos">← Orçamentos</Link>;

  if (erro) return <>{voltar}<div className="erro-vendas" role="alert">{erro}</div></>;
  if (!o) return <>{voltar}<Cartao><Vazio mensagem="Carregando…" /></Cartao></>;

  const [rotulo, variante] = SITUACAO[o.status] ?? [o.status, 'cinza' as VarianteSelo];
  const retirada = o.tipoEntrega === 'retirada';

  return (
    <>
      {voltar}
      <CabecalhoPagina
        titulo="Orçamento"
        subtitulo={`Criado em ${formatarDataHora(o.criadoEm)} · atualizado em ${formatarDataHora(o.atualizadoEm)}`}
        acoes={<Selo variante={variante}>{rotulo}</Selo>}
      />

      <div className="grade-info">
        <Cartao>
          <h2>Cliente</h2>
          <p><strong>{o.cliente}</strong></p>
          {o.clienteCodigo && <p>Código {o.clienteCodigo}</p>}
          {o.clienteDocumento && <p>{o.clienteDocumento}</p>}
        </Cartao>
        <Cartao>
          <h2>Vendedor, tabela e forma de pagamento</h2>
          <p><strong>{o.vendedor ?? '—'}</strong></p>
          <p>Tabela: {o.tabela ?? '—'}</p>
          <p>Forma: {o.forma ?? '—'}</p>
        </Cartao>
        <Cartao>
          <h2>{retirada ? 'Retirada' : 'Entrega'}</h2>
          <p>{retirada ? 'O cliente retira o pedido.' : 'Entrega no endereço do cliente.'}</p>
          {o.observacoes && <p className="sub">Obs. do vendedor: {o.observacoes}</p>}
        </Cartao>
      </div>

      {o.status === 'convertido' && o.pedidoId && (
        <Cartao className="secao-detalhe">
          <p>
            Virou o pedido nº {o.pedidoNumero ?? '—'} · <Link className="voltar-link" to={`/vendas/pedidos/${o.pedidoId}`}>Ver pedido</Link>
          </p>
        </Cartao>
      )}

      <section className="secao-detalhe">
        <Cartao style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px 0' }}><h2>Itens</h2></div>
          {o.itens.length === 0 ? <Vazio mensagem="Nenhum item." /> : (
            <div className="tabela-vendas-wrap" style={{ boxShadow: 'none', borderRadius: 0 }}>
              <table className="tabela-vendas">
                <thead><tr><th>Código</th><th>Produto</th><th className="num">Quantidade</th><th className="num">Preço unitário</th><th className="num">Total</th></tr></thead>
                <tbody>
                  {o.itens.map((i, k) => (
                    <tr key={`${i.codigo}-${k}`}>
                      <td>{i.codigo ?? '—'}</td>
                      <td>{i.produto}</td>
                      <td className="num">{i.quantidade}</td>
                      <td className="num">{formatarReais(i.precoUnit)}</td>
                      <td className="num">{formatarReais(i.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="totais-itens">
            <strong>Total: {formatarReais(o.total)}</strong>
          </div>
        </Cartao>
      </section>

      <p className="sub">Somente consulta. O vendedor altera, converte ou cancela o orçamento no aplicativo.</p>
    </>
  );
}
