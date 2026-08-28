import { useCallback, useEffect, useState } from 'react';
import { api, fmtData } from '../api';

interface Solicitacao {
  id: string;
  cliente_id: string;
  nome_fantasia: string;
  documento: string;
  solicitado_em: string;
}

export function SolicitacoesCredito() {
  const [dados, setDados] = useState<Solicitacao[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(() => {
    api<{ dados: Solicitacao[] }>('/admin/credito-solicitacoes')
      .then((r) => setDados(r.dados))
      .catch((e) => setErro(e.message));
  }, []);

  useEffect(carregar, [carregar]);

  async function atender(id: string) {
    try {
      await api(`/admin/credito-solicitacoes/${id}/atender`, { method: 'PATCH' });
      carregar();
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  return (
    <>
      <h1>Solicitações de crédito</h1>
      {erro && <div className="erro-texto">{erro}</div>}
      <div className="tabela-wrap">
        <table>
          <thead>
            <tr><th>Cliente</th><th>Documento</th><th>Solicitado em</th><th>Ações</th></tr>
          </thead>
          <tbody>
            {dados?.map((s) => (
              <tr key={s.id}>
                <td><strong>{s.nome_fantasia}</strong></td>
                <td className="mono">{s.documento}</td>
                <td>{fmtData(s.solicitado_em)}</td>
                <td>
                  <button className="btn-mini btn-ok" onClick={() => atender(s.id)}>Marcar como atendida</button>
                </td>
              </tr>
            ))}
            {dados && !dados.length && <tr><td colSpan={4} className="vazio">Nenhuma solicitação pendente</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}