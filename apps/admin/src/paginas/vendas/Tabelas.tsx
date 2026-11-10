import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, sessao } from '../../api';
import { CabecalhoPagina, Cartao, Selo, Vazio } from '../../vendas-ui';
import './cadastros.css';

interface Tabela { id: string; nome: string; condicaoIds: string[] }
interface Condicao { id: string; descricao: string; forma: string }
interface Resposta { tabelas: Tabela[]; condicoes: Condicao[] }

function CartaoTabela({ tabela, condicoes, admin, aoSalvar }: { tabela: Tabela; condicoes: Condicao[]; admin: boolean; aoSalvar: () => void }) {
  const [marcadas, setMarcadas] = useState<string[]>(tabela.condicaoIds);
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);

  // Recarregar a lista traz o estado salvo; sincroniza o cartão com ele.
  useEffect(() => { setMarcadas(tabela.condicaoIds); }, [tabela.condicaoIds]);

  const alterado = useMemo(() => {
    const a = new Set(marcadas); const b = new Set(tabela.condicaoIds);
    return a.size !== b.size || [...a].some((x) => !b.has(x));
  }, [marcadas, tabela.condicaoIds]);

  const grupos = useMemo(() => {
    const m = new Map<string, Condicao[]>();
    for (const c of condicoes) m.set(c.forma, [...(m.get(c.forma) ?? []), c]);
    return [...m.entries()];
  }, [condicoes]);

  function alternar(id: string, ligada: boolean) {
    setMsg(null);
    setMarcadas((atual) => (ligada ? [...atual, id] : atual.filter((x) => x !== id)));
  }

  async function salvar() {
    setSalvando(true); setMsg(null);
    try {
      await api(`/admin/vendas/tabelas-condicoes/${tabela.id}`, { method: 'PUT', body: JSON.stringify({ condicaoIds: marcadas }) });
      setMsg({ tipo: 'ok', texto: 'Condições salvas.' });
      aoSalvar();
    } catch (e) {
      setMsg({ tipo: 'erro', texto: (e as Error).message });
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Cartao className="cad-tabela-card">
      <div className="cad-tabela-topo">
        <h2>{tabela.nome}</h2>
        <div className="cad-tabela-acoes">
          {marcadas.length === 0 && <Selo variante="amarelo">Sem condição: o vendedor não consegue usar esta tabela</Selo>}
          {admin && <button type="button" className="cad-btn" disabled={!alterado || salvando} onClick={salvar}>{salvando ? 'Salvando…' : 'Salvar'}</button>}
        </div>
      </div>
      {msg && <div className={msg.tipo === 'ok' ? 'cad-ok' : 'cad-erro'} role="status">{msg.texto}</div>}
      {condicoes.length === 0 ? <Vazio mensagem="Nenhuma condição de pagamento recebida do ERP ainda." /> : grupos.map(([forma, itens]) => (
        <fieldset key={forma} className="cad-grupo">
          <legend>{forma}</legend>
          <div className="cad-opcoes">
            {itens.map((c) => (
              <label key={c.id} htmlFor={`cond-${tabela.id}-${c.id}`}>
                <input id={`cond-${tabela.id}-${c.id}`} type="checkbox" checked={marcadas.includes(c.id)} disabled={!admin || salvando} onChange={(e) => alternar(c.id, e.target.checked)} />
                {c.descricao}
              </label>
            ))}
          </div>
        </fieldset>
      ))}
    </Cartao>
  );
}

export function VendasTabelas() {
  const admin = sessao()?.papel === 'admin';
  const [res, setRes] = useState<Resposta | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(() => {
    api<Resposta>('/admin/vendas/tabelas-condicoes').then((r) => { setRes(r); setErro(null); }).catch((e: Error) => setErro(e.message));
  }, []);
  useEffect(carregar, [carregar]);

  return (
    <>
      <CabecalhoPagina titulo="Tabelas e condições" subtitulo="Condições de pagamento que o vendedor pode usar em cada tabela de preço." />
      {!admin && <p className="cad-nota">Somente administradores podem alterar as condições de cada tabela.</p>}
      {erro && <div className="cad-erro">{erro}</div>}
      {res && res.condicoes.length < 2 && (
        <div className="cad-aviso">O ERP enviou apenas {res.condicoes.length} condição de pagamento. As demais aparecem aqui quando forem enviadas pela integração.</div>
      )}
      {!res && !erro ? <Cartao><Vazio mensagem="Carregando…" /></Cartao>
        : res && res.tabelas.length === 0 ? <Cartao><Vazio mensagem="Nenhuma tabela de preço recebida do ERP ainda. As tabelas chegam pela integração." /></Cartao>
        : res && res.tabelas.map((t) => <CartaoTabela key={t.id} tabela={t} condicoes={res.condicoes} admin={admin} aoSalvar={carregar} />)}
    </>
  );
}
