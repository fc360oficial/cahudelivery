import { useState } from 'react';
import { api, fmtData } from '../api';

interface ClienteBusca {
  id: string;
  nome_fantasia: string;
  documento: string;
}

interface Movimento {
  id: string;
  valor: string;
  motivo: string;
  criado_em: string;
}

export function Carteira() {
  const [busca, setBusca] = useState('');
  const [resultados, setResultados] = useState<ClienteBusca[]>([]);
  const [selecionado, setSelecionado] = useState<ClienteBusca | null>(null);
  const [saldo, setSaldo] = useState<number | null>(null);
  const [movimentos, setMovimentos] = useState<Movimento[] | null>(null);
  const [valor, setValor] = useState('');
  const [motivo, setMotivo] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [lancando, setLancando] = useState(false);

  async function buscar(e: React.FormEvent) {
    e.preventDefault();
    if (!busca.trim()) return;
    try {
      const r = await api<{ dados: ClienteBusca[] }>(`/admin/clientes?busca=${encodeURIComponent(busca)}`);
      setResultados(r.dados);
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  async function selecionar(c: ClienteBusca) {
    setSelecionado(c);
    setResultados([]);
    await carregarCarteira(c.id);
  }

  async function carregarCarteira(clienteId: string) {
    try {
      const r = await api<{ saldo: number; movimentos: Movimento[] }>(`/admin/clientes/${clienteId}/carteira`);
      setSaldo(r.saldo);
      setMovimentos(r.movimentos);
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  async function lancar(e: React.FormEvent) {
    e.preventDefault();
    if (!selecionado || !valor || !motivo) return;
    setLancando(true);
    try {
      await api(`/admin/clientes/${selecionado.id}/carteira`, {
        method: 'POST',
        body: JSON.stringify({ valor: Number(valor), motivo }),
      });
      setValor('');
      setMotivo('');
      await carregarCarteira(selecionado.id);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setLancando(false);
    }
  }

  return (
    <>
      <h1>Carteira</h1>
      <form className="filtros" onSubmit={buscar}>
        <input
          placeholder="Buscar cliente por nome, CNPJ ou e-mail…"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          style={{ flex: 1, maxWidth: 340 }}
        />
        <button className="btn">Buscar</button>
      </form>
      {erro && <div className="erro-texto">{erro}</div>}
      {resultados.length > 0 && (
        <div className="tabela-wrap" style={{ marginTop: 12 }}>
          <table>
            <thead><tr><th>Cliente</th><th>Documento</th><th></th></tr></thead>
            <tbody>
              {resultados.map((c) => (
                <tr key={c.id}>
                  <td>{c.nome_fantasia}</td>
                  <td className="mono">{c.documento}</td>
                  <td><button className="btn-mini" onClick={() => selecionar(c)}>Selecionar</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {selecionado && (
        <div className="card" style={{ marginTop: 16 }}>
          <h2>{selecionado.nome_fantasia}</h2>
          <p style={{ fontSize: 24, fontWeight: 800 }}>
            Saldo: {saldo !== null ? `R$ ${saldo.toFixed(2)}` : '…'}
          </p>
          <form onSubmit={lancar} style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 12 }}>
            <input
              type="number"
              step="0.01"
              placeholder="Valor (negativo = débito)"
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              required
              style={{ maxWidth: 200 }}
            />
            <input
              placeholder="Motivo (ex.: Devolução pedido #123)"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              required
              style={{ flex: 1 }}
            />
            <button className="btn" disabled={lancando}>{lancando ? 'Lançando…' : 'Lançar movimento'}</button>
          </form>
          <div className="tabela-wrap" style={{ marginTop: 16 }}>
            <table>
              <thead><tr><th>Valor</th><th>Motivo</th><th>Data</th></tr></thead>
              <tbody>
                {movimentos?.map((m) => (
                  <tr key={m.id}>
                    <td style={{ color: Number(m.valor) >= 0 ? 'green' : 'crimson', fontWeight: 700 }}>
                      {Number(m.valor) >= 0 ? '+' : ''}R$ {Number(m.valor).toFixed(2)}
                    </td>
                    <td>{m.motivo}</td>
                    <td>{fmtData(m.criado_em)}</td>
                  </tr>
                ))}
                {movimentos && !movimentos.length && <tr><td colSpan={3} className="vazio">Nenhuma movimentação</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
