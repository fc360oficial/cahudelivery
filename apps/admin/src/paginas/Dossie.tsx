import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, fmtDocumento, fmtMoeda, STATUS_LABEL } from '../api';
import { AUTENTICACAO_3DS } from './PedidoDetalhe';

interface DossieDados {
  distribuidora: string;
  geradoEm: string;
  id: string;
  numero: number;
  status: string;
  criado_em: string;
  total: string;
  forma_pagamento: string;
  tipo_entrega: string;
  endereco_snapshot_json: Record<string, string> | null;
  aceite_json: { em: string; ip?: string | null; userAgent?: string | null; politicaCancelamento?: string | null } | null;
  observacoes?: string | null;
  razao_social?: string | null;
  nome_fantasia: string;
  documento: string;
  email: string;
  telefone?: string | null;
  cliente_desde: string;
  pedidos_anteriores: number;
  itens: { descricao: string; quantidade: string; precoUnit: string; total: string }[] | null;
  eventos: { status: string; detalhe?: string; origem: string; em: string }[] | null;
  nota: { numero_nf: string; serie?: string; chave_acesso?: string; emitida_em?: string; pdf_url?: string } | null;
  total_faturado?: string | null;
  entrega: {
    recebedor_nome: string; recebedor_documento?: string | null; entregue_em: string;
    latitude?: string | null; longitude?: string | null; observacao?: string | null;
    foto_canhoto?: string | null; foto_entrega?: string | null;
  } | null;
  pagamento: {
    metodo: string; status: string; valor: string; valorPago?: string | null; pagoEm?: string | null;
    ref?: string | null; tid?: string | null; autenticacao3ds?: string | null; nsu?: string | null;
    autorizacao?: string | null; bin?: string | null; final?: string | null; bandeira?: string | null;
  } | null;
  estornos: { valor: string; status: string; motivo: string; em: string }[] | null;
}

const dataHora = (v?: string | null) =>
  v ? new Date(v).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'medium', timeZone: 'America/Recife' }) : '—';

/**
 * Dossiê de contestação de chargeback: uma página com tudo que prova a venda,
 * a autenticação e a entrega. Imprimir → "Salvar como PDF" e anexar na
 * contestação do portal useRede junto com as fotos do comprovante.
 */
export function Dossie() {
  const { id } = useParams();
  const [d, setD] = useState<DossieDados | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    api<DossieDados>(`/admin/pedidos/${id}/dossie`).then(setD).catch((e) => setErro(e.message));
  }, [id]);

  if (erro) return <div className="erro-texto" style={{ padding: 24 }}>{erro}</div>;
  if (!d) return <div className="vazio" style={{ padding: 24 }}>Carregando…</div>;
  const end = d.endereco_snapshot_json;
  const pg = d.pagamento;

  return (
    <div className="dossie">
      <div className="dossie-acoes">
        <Link to={`/pedidos/${d.id}`}>‹ Voltar ao pedido</Link>
        <button className="btn btn-mini" onClick={() => window.print()}>Imprimir / salvar PDF</button>
      </div>

      <h1>Comprovação de venda e entrega — Pedido #{d.numero}</h1>
      <p className="dossie-sub">{d.distribuidora} · gerado em {dataHora(d.geradoEm)} · situação atual: {STATUS_LABEL[d.status] ?? d.status}</p>

      <section>
        <h2>1. Comprador</h2>
        <table>
          <tbody>
            <tr><th>Razão social</th><td>{d.razao_social || d.nome_fantasia}</td></tr>
            <tr><th>Nome fantasia</th><td>{d.nome_fantasia}</td></tr>
            <tr><th>CNPJ/CPF</th><td>{fmtDocumento(d.documento)}</td></tr>
            <tr><th>E-mail / telefone</th><td>{d.email}{d.telefone ? ` · ${d.telefone}` : ''}</td></tr>
            <tr><th>Cliente desde</th><td>{dataHora(d.cliente_desde)} · {d.pedidos_anteriores} pedido(s) anteriores faturados/entregues</td></tr>
          </tbody>
        </table>
      </section>

      <section>
        <h2>2. Pedido e aceite das condições</h2>
        <table>
          <tbody>
            <tr><th>Feito em</th><td>{dataHora(d.criado_em)} pelo aplicativo, com login do cliente</td></tr>
            <tr><th>Entrega</th><td>
              {end ? `${end.logradouro}, ${end.numero}${end.complemento ? ` ${end.complemento}` : ''} — ${end.bairro}, ${end.cidade}/${end.uf}, CEP ${end.cep}` : 'Retirada na distribuidora'}
            </td></tr>
            <tr><th>Aceite da política</th><td>
              {d.aceite_json
                ? <>Em {dataHora(d.aceite_json.em)} · IP {d.aceite_json.ip ?? '—'} · versão {d.aceite_json.politicaCancelamento ?? '—'}<br /><small>{d.aceite_json.userAgent}</small></>
                : 'Pedido anterior ao registro de aceite (30/10/2026)'}
            </td></tr>
            {d.observacoes && <tr><th>Observações</th><td>{d.observacoes}</td></tr>}
          </tbody>
        </table>
        <table style={{ marginTop: 8 }}>
          <thead><tr><th>Item</th><th>Qtd</th><th>Unit.</th><th>Total</th></tr></thead>
          <tbody>
            {d.itens?.map((i, k) => (
              <tr key={k}><td>{i.descricao}</td><td>{Number(i.quantidade)}</td><td>{fmtMoeda(i.precoUnit)}</td><td>{fmtMoeda(i.total)}</td></tr>
            ))}
            <tr><td colSpan={3}><strong>Total do pedido</strong></td><td><strong>{fmtMoeda(d.total)}</strong></td></tr>
            {d.total_faturado && <tr><td colSpan={3}>Total faturado (NF-e)</td><td>{fmtMoeda(d.total_faturado)}</td></tr>}
          </tbody>
        </table>
      </section>

      <section>
        <h2>3. Pagamento</h2>
        {pg ? (
          <table>
            <tbody>
              <tr><th>Forma</th><td>{pg.metodo === 'cartao' ? `Cartão de crédito online (e.Rede)${pg.bandeira ? ` · ${pg.bandeira}` : ''}` : 'PIX (Itaú)'}</td></tr>
              {pg.metodo === 'cartao' && <tr><th>Cartão</th><td>{pg.bin ? `${pg.bin}******` : ''}{pg.final ?? '—'}</td></tr>}
              <tr><th>Valor</th><td>{fmtMoeda(pg.valorPago ?? pg.valor)} · {pg.status}</td></tr>
              <tr><th>Aprovado em</th><td>{dataHora(pg.pagoEm)}</td></tr>
              <tr><th>Identificadores</th><td className="mono">
                {pg.ref && <>reference {pg.ref}<br /></>}
                {pg.tid && <>TID {pg.tid}<br /></>}
                {pg.nsu && <>NSU {pg.nsu}<br /></>}
                {pg.autorizacao && <>autorização {pg.autorizacao}</>}
              </td></tr>
              {pg.metodo === 'cartao' && (
                <tr><th>Autenticação 3DS</th><td>{pg.autenticacao3ds ? AUTENTICACAO_3DS[pg.autenticacao3ds] ?? pg.autenticacao3ds : 'Não houve (venda sem 3DS)'}</td></tr>
              )}
              {!!d.estornos?.length && (
                <tr><th>Estornos</th><td>{d.estornos.map((e, k) => <div key={k}>{dataHora(e.em)} · {fmtMoeda(e.valor)} · {e.status} — {e.motivo}</div>)}</td></tr>
              )}
            </tbody>
          </table>
        ) : <p>Pedido sem pagamento online.</p>}
      </section>

      <section>
        <h2>4. Nota fiscal</h2>
        {d.nota ? (
          <table>
            <tbody>
              <tr><th>NF-e</th><td>{d.nota.numero_nf}{d.nota.serie ? ` / série ${d.nota.serie}` : ''} · emitida {dataHora(d.nota.emitida_em)}</td></tr>
              {d.nota.chave_acesso && <tr><th>Chave de acesso</th><td className="mono">{d.nota.chave_acesso}</td></tr>}
              {d.nota.pdf_url && <tr className="so-tela"><th>DANFE</th><td><a href={d.nota.pdf_url} target="_blank" rel="noreferrer">abrir</a></td></tr>}
            </tbody>
          </table>
        ) : <p>Ainda sem NF-e.</p>}
      </section>

      <section>
        <h2>5. Entrega</h2>
        {d.entrega ? (
          <table>
            <tbody>
              <tr><th>Entregue em</th><td>{dataHora(d.entrega.entregue_em)}</td></tr>
              <tr><th>Recebido por</th><td>{d.entrega.recebedor_nome}{d.entrega.recebedor_documento ? ` · documento ${d.entrega.recebedor_documento}` : ''}</td></tr>
              {d.entrega.latitude && d.entrega.longitude && (
                <tr><th>Local (GPS)</th><td>{d.entrega.latitude}, {d.entrega.longitude}</td></tr>
              )}
              <tr><th>Canhoto assinado</th><td>{d.entrega.foto_canhoto ? 'Foto anexa (baixar na tela do pedido)' : '—'}</td></tr>
              {d.entrega.foto_entrega && <tr><th>Foto da entrega</th><td>Foto anexa (baixar na tela do pedido)</td></tr>}
              {d.entrega.observacao && <tr><th>Observação</th><td>{d.entrega.observacao}</td></tr>}
            </tbody>
          </table>
        ) : <p><strong>Sem comprovante de entrega registrado.</strong></p>}
      </section>

      <section>
        <h2>6. Linha do tempo</h2>
        <table>
          <tbody>
            {d.eventos?.map((e, k) => (
              <tr key={k}><th>{dataHora(e.em)}</th><td>{STATUS_LABEL[e.status] ?? e.status}{e.detalhe ? ` — ${e.detalhe}` : ''} <small>({e.origem})</small></td></tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
