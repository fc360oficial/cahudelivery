import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, sessao } from '../../api';
import { CabecalhoPagina, Cartao, Selo, Vazio } from '../../vendas-ui';
import './cadastros.css';

interface Tabela { id: string; nome: string; codigo: string; formaIds: string[] }
interface Forma { id: string; descricao: string; codigo: string; exigeCredito: boolean }
interface Resposta { tabelas: Tabela[]; formas: Forma[] }

function CartaoTabela({ tabela, formas, admin, aoSalvar }: { tabela: Tabela; formas: Forma[]; admin: boolean; aoSalvar: () => void }) {
  const [marcadas, setMarcadas] = useState<string[]>(tabela.formaIds);
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);

  // Recarregar a lista traz o estado salvo; sincroniza o cartão com ele.
  useEffect(() => { setMarcadas(tabela.formaIds); }, [tabela.formaIds]);

  const alterado = useMemo(() => {
    const a = new Set(marcadas); const b = new Set(tabela.formaIds);
    return a.size !== b.size || [...a].some((x) => !b.has(x));
  }, [marcadas, tabela.formaIds]);

  function alternar(id: string, ligada: boolean) {
    setMsg(null);
    setMarcadas((atual) => (ligada ? [...atual, id] : atual.filter((x) => x !== id)));
  }

  async function salvar() {
    setSalvando(true); setMsg(null);
    try {
      await api(`/admin/vendas/tabelas-formas/${tabela.id}`, { method: 'PUT', body: JSON.stringify({ formaIds: marcadas }) });
      setMsg({ tipo: 'ok', texto: 'Formas salvas.' });
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
        <h2>{tabela.nome} <span className="cad-nota">Código {tabela.codigo}</span></h2>
        <div className="cad-tabela-acoes">
          {marcadas.length === 0 && <Selo variante="cinza">Sem forma: vendedores não usam esta tabela</Selo>}
          {admin && <button type="button" className="cad-btn" disabled={!alterado || salvando} onClick={salvar}>{salvando ? 'Salvando…' : 'Salvar'}</button>}
        </div>
      </div>
      {msg && <div className={msg.tipo === 'ok' ? 'cad-ok' : 'cad-erro'} role="status">{msg.texto}</div>}
      {formas.length === 0 ? <Vazio mensagem="Nenhuma forma de pagamento recebida do ERP ainda." /> : (
        <div className="cad-opcoes">
          {formas.map((f) => (
            <label key={f.id} htmlFor={`forma-${tabela.id}-${f.id}`}>
              <input id={`forma-${tabela.id}-${f.id}`} type="checkbox" checked={marcadas.includes(f.id)} disabled={!admin || salvando} onChange={(e) => alternar(f.id, e.target.checked)} />
              {f.descricao}
              {f.exigeCredito && <span className="cad-nota"> confere limite de crédito</span>}
            </label>
          ))}
        </div>
      )}
    </Cartao>
  );
}

export function VendasTabelas() {
  const admin = sessao()?.papel === 'admin';
  const [res, setRes] = useState<Resposta | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(() => {
    api<Resposta>('/admin/vendas/tabelas-formas').then((r) => { setRes(r); setErro(null); }).catch((e: Error) => setErro(e.message));
  }, []);
  useEffect(carregar, [carregar]);

  return (
    <>
      <CabecalhoPagina titulo="Tabelas de preço" subtitulo="Formas de pagamento aceitas em cada tabela. O prazo vem da própria tabela: o ERP gera o boleto a partir dela." />
      {!admin && <p className="cad-nota">Somente administradores podem alterar as formas de cada tabela.</p>}
      {erro && <div className="cad-erro">{erro}</div>}
      {!res && !erro ? <Cartao><Vazio mensagem="Carregando…" /></Cartao>
        : res && res.tabelas.length === 0 ? <Cartao><Vazio mensagem="Nenhuma tabela de preço recebida do ERP ainda. As tabelas chegam pela integração." /></Cartao>
        : res && res.tabelas.map((t) => <CartaoTabela key={t.id} tabela={t} formas={res.formas} admin={admin} aoSalvar={carregar} />)}
    </>
  );
}
