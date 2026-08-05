import { useEffect, useState } from 'react';
import { api, fmtData } from '../api';

interface Indicacao {
  indicador: string;
  indicador_documento: string;
  indicado: string;
  indicado_documento: string;
  status: 'pendente' | 'creditado';
  criado_em: string;
  creditado_em: string | null;
}

export function Indicacoes() {
  const [dados, setDados] = useState<Indicacao[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    api<{ dados: Indicacao[] }>('/admin/indicacoes')
      .then((r) => setDados(r.dados))
      .catch((e) => setErro(e.message));
  }, []);

  return (
    <>
      <h1>Indique e Ganhe</h1>
      {erro && <div className="erro-texto">{erro}</div>}
      <div className="tabela-wrap">
        <table>
          <thead>
            <tr><th>Indicador</th><th>Indicado</th><th>Status</th><th>Cadastro</th><th>Crédito</th></tr>
          </thead>
          <tbody>
            {dados?.map((i, idx) => (
              <tr key={idx}>
                <td>
                  <strong>{i.indicador}</strong>
                  <div className="mono" style={{ fontSize: 12 }}>{i.indicador_documento}</div>
                </td>
                <td>
                  <strong>{i.indicado}</strong>
                  <div className="mono" style={{ fontSize: 12 }}>{i.indicado_documento}</div>
                </td>
                <td><span className={`badge ${i.status}`}>{i.status === 'creditado' ? 'Creditado' : 'Aguardando'}</span></td>
                <td>{fmtData(i.criado_em)}</td>
                <td>{i.creditado_em ? fmtData(i.creditado_em) : '—'}</td>
              </tr>
            ))}
            {dados && !dados.length && <tr><td colSpan={5} className="vazio">Nenhuma indicação ainda</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
