import { useEffect, useState } from 'react';
import { api, fmtData } from '../api';

interface LogIntegracao {
  id: string; operacao: string; direcao: string; request_resumo?: string; response_resumo?: string;
  sucesso: boolean; duracao_ms?: number; criado_em: string;
}

export function Logs() {
  const [dados, setDados] = useState<LogIntegracao[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    api<{ dados: LogIntegracao[] }>('/admin/logs/integracao')
      .then((r) => setDados(r.dados))
      .catch((e) => setErro(e.message));
  }, []);

  return (
    <>
      <h1>Logs de integração (ERP)</h1>
      {erro && <div className="erro-texto">{erro}</div>}
      <div className="tabela-wrap">
        <table>
          <thead><tr><th>Quando</th><th>Operação</th><th>Direção</th><th>Resultado</th><th>Duração</th><th>Detalhe</th></tr></thead>
          <tbody>
            {dados?.map((l) => (
              <tr key={l.id}>
                <td style={{ whiteSpace: 'nowrap' }}>{fmtData(l.criado_em)}</td>
                <td className="mono">{l.operacao}</td>
                <td>{l.direcao === 'fluxo_para_erp' ? '→ ERP' : '← ERP'}</td>
                <td><span className={`badge ${l.sucesso ? 'aprovado' : 'bloqueado'}`}>{l.sucesso ? 'ok' : 'falha'}</span></td>
                <td>{l.duracao_ms != null ? `${l.duracao_ms} ms` : '—'}</td>
                <td className="mono" style={{ maxWidth: 420, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {l.request_resumo ?? l.response_resumo ?? '—'}
                </td>
              </tr>
            ))}
            {dados && !dados.length && <tr><td colSpan={6} className="vazio">Nenhuma chamada ao ERP registrada</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
