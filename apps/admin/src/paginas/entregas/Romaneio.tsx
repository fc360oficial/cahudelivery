import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../../api';
import './romaneio.css';

interface Endereco { logradouro: string | null; numero: string | null; bairro: string | null; cidade: string | null }
interface Dados { cliente: string; endereco: Endereco; nota: { numero: string; serie: string | null } | null }
interface Linha { id: string; dados: Dados; volumes: number }
interface Carga {
  numero: number; data: string; distribuidora: string; status: string;
  caminhao: { nome: string; placa: string | null } | null; motorista: { nome: string } | null;
  entregas: Linha[]; volumes: number;
}
interface Parada { cliente: string; endereco: string; notas: string[]; volumes: number }

const POR_FOLHA = 12;
const numero = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
const chave = (d: Dados) => [d.cliente, d.endereco.logradouro, d.endereco.numero, d.endereco.bairro].join('|').toUpperCase();

/** Notas seguidas do mesmo cliente no mesmo endereço viram uma linha só (uma assinatura). */
function paradasDoRomaneio(entregas: Linha[]): Parada[] {
  const paradas: Parada[] = [];
  let anterior = '';
  for (const l of entregas) {
    const k = chave(l.dados);
    if (k === anterior && paradas.length) {
      const p = paradas[paradas.length - 1];
      if (l.dados.nota) p.notas.push(l.dados.nota.numero);
      p.volumes += l.volumes;
    } else {
      const e = l.dados.endereco;
      paradas.push({
        cliente: l.dados.cliente,
        endereco: [[e.logradouro, e.numero].filter(Boolean).join(', '), e.bairro].filter(Boolean).join(' · '),
        notas: l.dados.nota ? [l.dados.nota.numero] : [],
        volumes: l.volumes,
      });
    }
    anterior = k;
  }
  return paradas;
}

function dataPorExtenso(iso: string): string {
  const [a, m, d] = iso.split('-').map(Number);
  return new Date(a, m - 1, d).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** Romaneio de entrega: uma folha A4 deitada por carga (12 paradas por folha), com a linha de assinatura de cada cliente. */
export function EntregasRomaneio() {
  const { id } = useParams();
  const [carga, setCarga] = useState<Carga | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    api<Carga>(`/admin/entregas/cargas/${id}/romaneio`).then(setCarga).catch((e: Error) => setErro(e.message));
  }, [id]);

  if (erro) return <div className="rom-aviso">{erro}</div>;
  if (!carga) return <div className="rom-aviso">Carregando…</div>;

  const paradas = paradasDoRomaneio(carga.entregas);
  const folhas: Parada[][] = [];
  for (let i = 0; i < paradas.length; i += POR_FOLHA) folhas.push(paradas.slice(i, i + POR_FOLHA));
  if (!folhas.length) folhas.push([]);

  return (
    <div className="rom-tela">
      <div className="rom-barra">
        <span>Romaneio da carga nº {carga.numero}{carga.status === 'rascunho' ? ' · ainda não autorizada' : ''}</span>
        <button type="button" onClick={() => window.print()}>Imprimir</button>
      </div>
      {folhas.map((folha, f) => (
        <section className="rom-folha" key={f}>
          <header className="rom-topo">
            <div>
              <div className="rom-empresa">{carga.distribuidora}</div>
              <h1>Romaneio de entrega</h1>
            </div>
            <dl>
              <div><dt>Carga</dt><dd>{carga.numero}</dd></div>
              <div><dt>Data</dt><dd>{dataPorExtenso(carga.data)}</dd></div>
              <div><dt>Caminhão</dt><dd>{carga.caminhao ? `${carga.caminhao.nome}${carga.caminhao.placa ? ` · ${carga.caminhao.placa}` : ''}` : '________'}</dd></div>
              <div><dt>Motorista</dt><dd>{carga.motorista?.nome ?? '________'}</dd></div>
              <div><dt>Entregas</dt><dd>{paradas.length}</dd></div>
              <div><dt>Volumes</dt><dd>{numero(carga.volumes)}</dd></div>
              <div><dt>Folha</dt><dd>{f + 1} de {folhas.length}</dd></div>
            </dl>
          </header>

          <p className="rom-declaracao">Quem assina declara que recebeu, conferidos e em bom estado, os volumes das notas fiscais da sua linha. Avaria ou falta: anotar com o motorista antes de assinar.</p>

          <table className="rom-tabela">
            <colgroup><col className="c-n" /><col className="c-cliente" /><col className="c-notas" /><col className="c-vol" /><col className="c-nome" /><col className="c-doc" /><col className="c-hora" /><col /></colgroup>
            <thead>
              <tr><th scope="col">Nº</th><th scope="col">Cliente e endereço</th><th scope="col">Notas</th><th scope="col">Vol.</th><th scope="col">Nome legível de quem recebeu</th><th scope="col">CPF ou RG</th><th scope="col">Hora</th><th scope="col">Assinatura</th></tr>
            </thead>
            <tbody>
              {folha.map((p, i) => (
                <tr key={i}>
                  <td className="n">{f * POR_FOLHA + i + 1}</td>
                  <td><strong>{p.cliente}</strong><br /><span>{p.endereco || 'endereço não informado'}</span></td>
                  <td>{p.notas.join(', ') || 'sem nota'}</td>
                  <td className="vol">{numero(p.volumes)}</td>
                  <td></td><td></td><td></td><td></td>
                </tr>
              ))}
            </tbody>
          </table>

          <footer className="rom-rodape">
            <div>Saída do CD (hora)</div>
            <div>Volta ao CD (hora)</div>
            <div>Assinatura do motorista</div>
            <div>Conferente do CD (recebeu esta folha)</div>
          </footer>
        </section>
      ))}
    </div>
  );
}
