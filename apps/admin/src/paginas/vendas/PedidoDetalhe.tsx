import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api';
import { CabecalhoPagina, Cartao, formatarDataHora, formatarReais, Vazio } from '../../vendas-ui';
import { MOTIVO, SeloStatus, type Divergencia } from './comum';
import './inicio-pedidos.css';

interface Pedido {
  id: string;
  numero: number;
  criadoEm: string;
  status: string;
  cliente: string;
  clienteCodigo: string | null;
  clienteDocumento: string | null;
  clienteTelefone: string | null;
  vendedor: string | null;
  tabela: string | null;
  condicao: string | null;
  forma: string | null;
  tipoEntrega: string;
  observacoes: string | null;
  endereco: Record<string, unknown> | null;
  subtotal: number;
  desconto: number;
  total: number;
  itens: { produto: string; codigo: string | null; quantidade: number; precoUnit: number; total: number }[];
  divergencias: Divergencia[];
  eventos: { status: string; detalhe: string | null; origem: string; criadoEm: string }[];
}

const texto = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '');

function enderecoEmLinhas(e: Record<string, unknown> | null): string[] {
  if (!e) return [];
  const rua = [texto(e.logradouro), texto(e.numero)].filter(Boolean).join(', ');
  const cidade = [texto(e.cidade), texto(e.uf)].filter(Boolean).join(' - ');
  return [rua, texto(e.complemento), texto(e.bairro), cidade, texto(e.cep) && `CEP ${texto(e.cep)}`].filter(Boolean) as string[];
}

/** Valores enviado/atual conforme o tipo: dinheiro (preço, crédito) ou quantidade (estoque). */
function valor(tipo: string, v: number | undefined): string {
  if (v == null) return '—';
  return tipo === 'estoque' ? String(v) : formatarReais(v);
}

export function VendasPedidoDetalhe() {
  const { id } = useParams();
  const [p, setP] = useState<Pedido | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    setP(null);
    setErro(null);
    api<Pedido>(`/admin/vendas/pedidos/${id}`)
      .then((r) => { if (vivo) setP(r); })
      .catch((e: Error) => { if (vivo) setErro(e.message || 'Não foi possível carregar o pedido.'); });
    return () => { vivo = false; };
  }, [id]);

  const voltar = <Link className="voltar-link" to="/vendas/pedidos">← Voltar aos pedidos</Link>;

  if (erro) return <>{voltar}<div className="erro-vendas" role="alert">{erro}</div></>;
  if (!p) return <>{voltar}<Cartao><Vazio mensagem="Carregando…" /></Cartao></>;

  const linhasEndereco = enderecoEmLinhas(p.endereco);
  const retirada = p.tipoEntrega === 'retirada';

  return (
    <>
      {voltar}
      <CabecalhoPagina
        titulo={`Pedido #${p.numero}`}
        subtitulo={formatarDataHora(p.criadoEm)}
        acoes={<SeloStatus status={p.status} />}
      />

      <div className="grade-info">
        <Cartao>
          <h2>Cliente</h2>
          <p><strong>{p.cliente}</strong></p>
          {p.clienteCodigo && <p>Código {p.clienteCodigo}</p>}
          {p.clienteDocumento && <p>{p.clienteDocumento}</p>}
          {p.clienteTelefone && <p>{p.clienteTelefone}</p>}
        </Cartao>
        <Cartao>
          <h2>Vendedor, tabela e condição</h2>
          <p><strong>{p.vendedor ?? '—'}</strong></p>
          <p>Tabela: {p.tabela ?? '—'}</p>
          <p>Condição: {p.condicao ?? '—'}</p>
          {p.forma && <p>Forma: {p.forma}</p>}
        </Cartao>
        <Cartao>
          <h2>{retirada ? 'Retirada' : 'Entrega'}</h2>
          {retirada && <p>O cliente retira o pedido.</p>}
          {linhasEndereco.length > 0 ? linhasEndereco.map((l) => <p key={l}>{l}</p>) : !retirada && <p>Sem endereço informado.</p>}
          {p.observacoes && <p className="sub">Obs.: {p.observacoes}</p>}
        </Cartao>
      </div>

      {p.divergencias.length > 0 && (
        <Cartao className="secao-detalhe" style={{ borderLeft: '6px solid #FFC20E' }}>
          <h2>Pendências</h2>
          <ul className="pendencias">
            {p.divergencias.map((d, i) => (
              <li key={`${d.tipo}-${i}`}>
                <strong>{MOTIVO[d.tipo] ?? d.tipo}</strong>{d.nome ? ` — ${d.nome}` : ''}
                {d.tipo !== 'sem_preco' && (d.enviado != null || d.atual != null) && (
                  <span className="sub">
                    {d.tipo === 'credito' ? 'Pedido' : 'Enviado'}: {valor(d.tipo, d.enviado)} × {d.tipo === 'credito' ? 'Crédito disponível' : 'Atual'}: {valor(d.tipo, d.atual)}
                  </span>
                )}
              </li>
            ))}
          </ul>
          <p className="sub">O vendedor confirma ou cancela o pedido no aplicativo.</p>
        </Cartao>
      )}

      <section className="secao-detalhe">
        <Cartao style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px 0' }}><h2>Itens</h2></div>
          {p.itens.length === 0 ? <Vazio mensagem="Nenhum item." /> : (
            <div className="tabela-vendas-wrap" style={{ boxShadow: 'none', borderRadius: 0 }}>
              <table className="tabela-vendas">
                <thead><tr><th>Código</th><th>Produto</th><th className="num">Qtd.</th><th className="num">Preço unit.</th><th className="num">Total</th></tr></thead>
                <tbody>
                  {p.itens.map((i, k) => (
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
            <span>Subtotal: {formatarReais(p.subtotal)}</span>
            {p.desconto > 0 && <span>Desconto: − {formatarReais(p.desconto)}</span>}
            <strong>Total: {formatarReais(p.total)}</strong>
          </div>
        </Cartao>
      </section>

      <Cartao className="secao-detalhe">
        <h2>Histórico</h2>
        {p.eventos.length === 0 ? <Vazio mensagem="Nenhum evento registrado." /> : (
          <ol className="linha-tempo">
            {p.eventos.map((e, i) => (
              <li key={i}>
                <SeloStatus status={e.status} /> <span className="sub" style={{ display: 'inline', marginLeft: 6 }}>{formatarDataHora(e.criadoEm)}</span>
                {e.detalhe && <span className="sub">{e.detalhe}</span>}
              </li>
            ))}
          </ol>
        )}
      </Cartao>
    </>
  );
}
