import { useCallback, useEffect, useState } from 'react';
import { api, fmtMoeda } from '../api';

interface LinhaProduto {
  id: string;
  sku: string;
  nome: string;
  unidade_venda: string;
  ativo: boolean;
  categoria?: string;
  marca?: string;
  estoque: string;
  preco?: string;
}

export function Produtos() {
  const [busca, setBusca] = useState('');
  const [dados, setDados] = useState<LinhaProduto[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(() => {
    const q = busca ? `?busca=${encodeURIComponent(busca)}` : '';
    api<{ dados: LinhaProduto[] }>(`/admin/produtos${q}`)
      .then((r) => setDados(r.dados))
      .catch((e) => setErro(e.message));
  }, [busca]);

  useEffect(carregar, [carregar]);

  async function alternar(p: LinhaProduto) {
    try {
      await api(`/admin/produtos/${p.id}/ativo`, { method: 'PATCH', body: JSON.stringify({ ativo: !p.ativo }) });
      carregar();
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  return (
    <>
      <h1>Produtos</h1>
      <div className="filtros">
        <input placeholder="Buscar por nome ou SKU…" value={busca} onChange={(e) => setBusca(e.target.value)} style={{ flex: 1, maxWidth: 340 }} />
      </div>
      {erro && <div className="erro-texto">{erro}</div>}
      <div className="tabela-wrap">
        <table>
          <thead>
            <tr><th>SKU</th><th>Produto</th><th>Categoria</th><th>Un.</th><th>Estoque</th><th>Preço</th><th>Situação</th><th></th></tr>
          </thead>
          <tbody>
            {dados?.map((p) => (
              <tr key={p.id}>
                <td className="mono">{p.sku}</td>
                <td><strong>{p.nome}</strong>{p.marca ? <span style={{ color: 'var(--texto-2)' }}> · {p.marca}</span> : null}</td>
                <td>{p.categoria ?? '—'}</td>
                <td>{p.unidade_venda}</td>
                <td>{Number(p.estoque)}</td>
                <td>{p.preco ? fmtMoeda(p.preco) : '—'}</td>
                <td><span className={`badge ${p.ativo ? 'aprovado' : 'bloqueado'}`}>{p.ativo ? 'ativo' : 'inativo'}</span></td>
                <td>
                  <button className={`btn-mini ${p.ativo ? 'btn-perigo' : 'btn-ok'}`} onClick={() => alternar(p)}>
                    {p.ativo ? 'Desativar' : 'Ativar'}
                  </button>
                </td>
              </tr>
            ))}
            {dados && !dados.length && <tr><td colSpan={8} className="vazio">Nenhum produto — aguarde a sincronização do ERP</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
