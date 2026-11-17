import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../api';
import { CabecalhoPagina, Cartao, Selo, Vazio, type VarianteSelo } from '../../vendas-ui';
import '../vendas/cadastros.css';
import '../vendas/inicio-pedidos.css';
import './entregas.css';

interface Endereco { logradouro: string | null; numero: string | null; bairro: string | null; cidade: string | null }
interface Entrega {
  id: string; origem: string; pedidoNumero: string | null; cliente: string; endereco: Endereco;
  nota: { numero: string; serie: string | null } | null; volumes: number; pesoKg: number | null; itensSemPeso: number;
}
interface Linha { id: string; entregaId: string; ordem: number; status: string; dados: Entrega; volumes: number; pesoKg: number | null; itensSemPeso: number }
interface Carga {
  id: string; numero: number; data: string; status: string; sugerida: boolean;
  caminhao: { id: string; nome: string; placa: string | null; capacidadeKg: number | null } | null;
  motorista: { id: string; nome: string } | null;
  entregas: Linha[]; volumes: number; pesoKg: number; entregasComPesoIncompleto: number;
}
interface Caminhao { id: string; nome: string; placa: string | null; capacidadeKg: number | null; situacao: string; motoristaNome: string | null; emUso: boolean }
interface Painel {
  data: string; cargas: Carga[]; fora: Entrega[]; caminhoes: Caminhao[]; motoristas: { id: string; nome: string }[];
  resumo: { entregas: number; emCargas: number; fora: number; pesoKg: number };
  motivos?: Record<string, string>;
}

const STATUS: Record<string, [string, VarianteSelo]> = {
  rascunho: ['Aguardando autorização', 'amarelo'],
  autorizada: ['Autorizada · já está no celular do motorista', 'verde'],
  em_rota: ['Em rota', 'azul'],
  encerrada: ['Encerrada', 'cinza'],
};
const ORIGEM: Record<string, string> = { app: 'App', site: 'Site', vendedor: 'Vendedor', televendas: 'Televendas' };
const MOTIVO: Record<string, string> = {
  sem_caminhao: 'Não coube em nenhum caminhão livre',
  nao_cabe: 'Mais pesada que o maior caminhão',
};

const numero = (n: number, casas = 0) => n.toLocaleString('pt-BR', { maximumFractionDigits: casas });
const peso = (kg: number | null) => (kg === null ? 'sem peso' : `≈ ${numero(kg, 1)} kg`);

/** Hoje no calendário do computador, em AAAA-MM-DD (o campo de data usa esse formato). */
function hoje(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dataPorExtenso(iso: string): string {
  const [a, m, d] = iso.split('-').map(Number);
  return new Date(a, m - 1, d).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit' });
}

function Lotacao({ c }: { c: Carga }) {
  const limite = c.caminhao?.capacidadeKg ?? null;
  const passou = limite !== null && c.pesoKg > limite;
  const pct = limite ? Math.min(100, Math.round((c.pesoKg / limite) * 100)) : 0;
  return (
    <div className="ent-lotacao">
      <div className="ent-lotacao-texto">
        <span>{c.entregas.length} {c.entregas.length === 1 ? 'entrega' : 'entregas'} · {numero(c.volumes, 1)} volumes</span>
        <span className={passou ? 'ent-alerta' : undefined}>≈ {numero(c.pesoKg)}{limite !== null ? ` de ${numero(limite)}` : ''} kg</span>
      </div>
      {limite !== null && (
        <div className="ent-barra" role="img" aria-label={passou ? 'Peso acima do que o caminhão leva' : `Carga ocupa ${pct}% do peso do caminhão`}>
          <div className={passou ? 'passou' : undefined} style={{ width: `${pct}%` }} />
        </div>
      )}
      {passou && <div className="ent-alerta ent-pequeno">Passou do que o caminhão leva</div>}
      {c.entregasComPesoIncompleto > 0 && <div className="ent-alerta ent-pequeno">{c.entregasComPesoIncompleto} {c.entregasComPesoIncompleto === 1 ? 'entrega tem' : 'entregas têm'} item sem peso</div>}
    </div>
  );
}

export function EntregasMontarCargas() {
  const [data, setData] = useState(hoje());
  const [painel, setPainel] = useState<Painel | null>(null);
  const [motivos, setMotivos] = useState<Record<string, string>>({});
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  // Carga escolhida para cada entrega que está fora.
  const [destino, setDestino] = useState<Record<string, string>>({});
  const pedido = useRef(0);

  const carregar = useCallback((dia: string) => {
    const n = ++pedido.current;
    api<Painel>(`/admin/entregas/cargas?data=${dia}`)
      // Não limpa o erro aqui: depois de uma ação recusada a tela recarrega e a mensagem precisa continuar visível.
      .then((p) => { if (n === pedido.current) setPainel(p); })
      .catch((e: Error) => { if (n === pedido.current) setErro(e.message); });
  }, []);
  useEffect(() => { setPainel(null); setMotivos({}); setErro(null); setAviso(null); carregar(data); }, [data, carregar]);

  /** Roda uma ação, mostra o aviso e recarrega o painel. */
  async function agir(acao: () => Promise<unknown>, mensagem?: string) {
    setOcupado(true); setErro(null); setAviso(null);
    try {
      await acao();
      if (mensagem) setAviso(mensagem);
      carregar(data);
    } catch (e) {
      setErro((e as Error).message);
      carregar(data);
    } finally {
      setOcupado(false);
    }
  }

  async function sugerir() {
    if (painel?.cargas.some((c) => c.status === 'rascunho') && !confirm('Refazer a sugestão apaga as cargas que ainda não foram autorizadas e monta de novo. Continuar?')) return;
    setOcupado(true); setErro(null); setAviso(null);
    try {
      const p = await api<Painel>('/admin/entregas/cargas/sugerir', { method: 'POST', body: JSON.stringify({ data }) });
      pedido.current++;
      setPainel(p);
      setMotivos(p.motivos ?? {});
      const feitas = p.cargas.filter((c) => c.status === 'rascunho').length;
      setAviso(feitas ? `${feitas} ${feitas === 1 ? 'carga sugerida' : 'cargas sugeridas'}. Confira e autorize.` : 'Nada para sugerir: não há entrega fora das cargas ou não há caminhão livre.');
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  const url = (c: Carga, resto = '') => `/admin/entregas/cargas/${c.id}${resto}`;
  const mover = (c: Carga, i: number, passo: number) => {
    const ids = c.entregas.map((l) => l.id);
    [ids[i], ids[i + passo]] = [ids[i + passo], ids[i]];
    void agir(() => api(url(c, '/ordem'), { method: 'PUT', body: JSON.stringify({ ids }) }));
  };
  const definir = (c: Carga, caminhaoId: string | null, motoristaId: string | null) =>
    void agir(() => api(url(c), { method: 'PUT', body: JSON.stringify({ caminhaoId, motoristaId }) }));

  const rascunhos = painel?.cargas.filter((c) => c.status === 'rascunho') ?? [];
  const r = painel?.resumo;

  return (
    <>
      <CabecalhoPagina
        titulo="Montar cargas"
        subtitulo="A sugestão junta as notas faturadas por cidade e bairro e respeita o peso de cada caminhão. Nada sai sem a sua autorização."
        acoes={
          <>
            <label className="ent-data">Dia da entrega
              <input type="date" value={data} onChange={(e) => e.target.value && setData(e.target.value)} />
            </label>
            <button type="button" className="cad-btn" disabled={ocupado || !painel} onClick={() => void sugerir()}>{rascunhos.length ? 'Refazer sugestão' : 'Sugerir cargas'}</button>
            <button type="button" className="cad-btn cad-btn-claro" disabled={ocupado || !painel} onClick={() => void agir(() => api('/admin/entregas/cargas', { method: 'POST', body: JSON.stringify({ data }) }), 'Carga vazia criada. Escolha o caminhão e inclua as entregas.')}>Nova carga vazia</button>
          </>
        }
      />
      {aviso && <div className="cad-ok" role="status">{aviso}</div>}
      {erro && <div className="cad-erro">{erro}</div>}

      {painel === null && !erro && <Cartao><Vazio mensagem="Carregando…" /></Cartao>}

      {painel && r && (
        <>
          <div className="grid-indicadores">
            <Cartao className="indicador"><div><div className="rotulo">Entregas de {dataPorExtenso(painel.data)}</div><div className="valor">{numero(r.entregas)}</div></div></Cartao>
            <Cartao className="indicador"><div><div className="rotulo">Em cargas</div><div className="valor">{numero(r.emCargas)}</div><div className="nota">{painel.cargas.length} {painel.cargas.length === 1 ? 'carga' : 'cargas'} · {painel.caminhoes.filter((c) => c.situacao === 'ativo').length} caminhões ativos</div></div></Cartao>
            <Cartao className="indicador"><div><div className="rotulo">Peso estimado</div><div className="valor">≈ {numero(r.pesoKg)} kg</div></div></Cartao>
            <Cartao className="indicador"><div><div className="rotulo">Fora das cargas</div><div className={`valor${r.fora ? ' ent-alerta' : ''}`}>{numero(r.fora)}</div></div></Cartao>
          </div>

          {painel.cargas.length === 0 && painel.fora.length === 0 && (
            <Cartao><Vazio mensagem="Nenhuma nota faturada aguardando entrega. Quando o ERP avisar o faturamento, elas aparecem aqui." /></Cartao>
          )}

          {painel.fora.length > 0 && (
            <section className="ent-secao" aria-label="Fora das cargas">
              <div className="ent-secao-topo"><h2>Fora das cargas<small>{painel.fora.length} {painel.fora.length === 1 ? 'entrega' : 'entregas'}</small></h2></div>
              <div className="tabela-vendas-wrap">
                <table className="tabela-vendas ent-tabela">
                  <thead><tr><th>Cliente</th><th>Nota</th><th className="num">Peso</th><th>Por que ficou fora</th><th>Colocar na carga</th></tr></thead>
                  <tbody>
                    {painel.fora.map((e) => (
                      <tr key={e.id}>
                        <td className="ent-quebra ent-cliente">
                          <strong>{e.cliente}</strong>
                          <span className="cad-sub">{[e.endereco.bairro, e.endereco.cidade].filter(Boolean).join(' · ') || 'endereço não informado'}</span>
                        </td>
                        <td>{e.nota?.numero ?? <span className="ent-alerta">nota não recebida</span>}<span className="cad-sub">{ORIGEM[e.origem] ?? e.origem}</span></td>
                        <td className="num">{peso(e.pesoKg)}</td>
                        <td className="ent-quebra">{MOTIVO[motivos[e.id]] ?? <span className="cad-fraco">ainda não foi sugerida</span>}</td>
                        <td>
                          {rascunhos.length === 0 ? <span className="cad-fraco">nenhuma carga aberta</span> : (
                            <div className="ent-acoes-linha" style={{ justifyContent: 'flex-start' }}>
                              <select aria-label={`Carga para ${e.cliente}`} value={destino[e.id] ?? ''} onChange={(ev) => setDestino({ ...destino, [e.id]: ev.target.value })}>
                                <option value="">Escolher a carga</option>
                                {rascunhos.map((c) => <option key={c.id} value={c.id}>{c.caminhao?.nome ?? `Carga ${c.numero}`}</option>)}
                              </select>
                              <button type="button" className="cad-btn cad-btn-mini" disabled={ocupado || !destino[e.id]} onClick={() => void agir(() => api(`/admin/entregas/cargas/${destino[e.id]}/entregas`, { method: 'POST', body: JSON.stringify({ entregaId: e.id }) }), `${e.cliente} incluído na carga.`)}>Incluir</button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {painel.cargas.map((c) => {
            const aberta = c.status === 'rascunho';
            const [rotulo, variante] = STATUS[c.status] ?? [c.status, 'cinza' as VarianteSelo];
            return (
              <Cartao key={c.id} className="ent-carga">
                <div className="ent-carga-topo">
                  <div>
                    <div className="ent-carga-titulo">
                      <h2>{c.caminhao?.nome ?? 'Sem caminhão'}</h2>
                      <Selo variante={variante}>{rotulo}</Selo>
                    </div>
                    <div className="cad-sub">Carga nº {c.numero}{c.caminhao?.placa ? ` · placa ${c.caminhao.placa}` : ''} · {c.motorista ? `motorista ${c.motorista.nome}` : 'sem motorista'}{c.sugerida ? ' · sugerida pelo sistema' : ''}</div>
                  </div>
                  <Lotacao c={c} />
                </div>

                {aberta && (
                  <div className="cad-filtros ent-carga-escolhas">
                    <label>Caminhão
                      <select value={c.caminhao?.id ?? ''} disabled={ocupado} onChange={(ev) => definir(c, ev.target.value || null, c.motorista?.id ?? null)}>
                        <option value="">Sem caminhão</option>
                        {painel.caminhoes.filter((k) => k.situacao === 'ativo' || k.id === c.caminhao?.id).map((k) => (
                          <option key={k.id} value={k.id} disabled={k.emUso && k.id !== c.caminhao?.id}>{k.nome}{k.capacidadeKg !== null ? ` · ${numero(k.capacidadeKg)} kg` : ''}{k.emUso && k.id !== c.caminhao?.id ? ' (já tem carga)' : ''}</option>
                        ))}
                      </select>
                    </label>
                    <label>Motorista
                      <select value={c.motorista?.id ?? ''} disabled={ocupado} onChange={(ev) => definir(c, c.caminhao?.id ?? null, ev.target.value || null)}>
                        <option value="">Sem motorista</option>
                        {painel.motoristas.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
                      </select>
                    </label>
                  </div>
                )}

                {c.entregas.length === 0 ? <Vazio mensagem="Carga vazia. Inclua entregas pela lista Fora das cargas." /> : (
                  <div className="tabela-vendas-wrap ent-carga-tabela">
                    <table className="tabela-vendas ent-tabela">
                      <thead><tr><th>Ordem</th><th>Cliente</th><th>Nota</th><th className="num">Volumes</th><th className="num">Peso</th>{aberta && <th></th>}</tr></thead>
                      <tbody>
                        {c.entregas.map((l, i) => (
                          <tr key={l.id}>
                            <td><strong>{l.ordem}</strong></td>
                            <td className="ent-quebra ent-cliente">
                              <strong>{l.dados.cliente}</strong>
                              <span className="cad-sub">{[[l.dados.endereco.logradouro, l.dados.endereco.numero].filter(Boolean).join(', '), l.dados.endereco.bairro].filter(Boolean).join(' · ') || 'endereço não informado'}</span>
                            </td>
                            <td>{l.dados.nota?.numero ?? <span className="ent-alerta">sem nota</span>}<span className="cad-sub">{ORIGEM[l.dados.origem] ?? l.dados.origem}</span></td>
                            <td className="num">{numero(l.volumes, 1)}</td>
                            <td className="num">{peso(l.pesoKg)}{l.itensSemPeso > 0 && <span className="cad-sub ent-alerta">{l.itensSemPeso} sem peso</span>}</td>
                            {aberta && (
                              <td>
                                <div className="ent-acoes-linha">
                                  <button type="button" className="cad-btn cad-btn-claro cad-btn-mini" aria-label={`Subir ${l.dados.cliente} na ordem`} disabled={ocupado || i === 0} onClick={() => mover(c, i, -1)}>↑</button>
                                  <button type="button" className="cad-btn cad-btn-claro cad-btn-mini" aria-label={`Descer ${l.dados.cliente} na ordem`} disabled={ocupado || i === c.entregas.length - 1} onClick={() => mover(c, i, 1)}>↓</button>
                                  <button type="button" className="cad-btn cad-btn-claro cad-btn-mini ent-perigo" disabled={ocupado} onClick={() => void agir(() => api(url(c, `/entregas/${l.id}`), { method: 'DELETE' }), `${l.dados.cliente} saiu da carga.`)}>Tirar</button>
                                </div>
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                <div className="cad-acoes ent-carga-acoes">
                  {aberta && <button type="button" className="cad-btn" disabled={ocupado} onClick={() => void agir(() => api(url(c, '/autorizar'), { method: 'POST' }), `Carga do ${c.caminhao?.nome ?? 'caminhão'} autorizada.`)}>Autorizar carga</button>}
                  {c.entregas.length > 0 && <a className="cad-btn cad-btn-claro" href={`/entregas/cargas/${c.id}/romaneio`} target="_blank" rel="noreferrer">Imprimir romaneio</a>}
                  {c.status === 'autorizada' && <button type="button" className="cad-btn cad-btn-claro" disabled={ocupado} onClick={() => { if (confirm('Reabrir tira a carga do celular do motorista até você autorizar de novo. Continuar?')) void agir(() => api(url(c, '/reabrir'), { method: 'POST' }), 'Carga reaberta para ajuste.'); }}>Reabrir para ajuste</button>}
                  {aberta && <button type="button" className="cad-btn cad-btn-claro ent-perigo" disabled={ocupado} onClick={() => { if (confirm('Excluir esta carga? As entregas voltam para a lista Fora das cargas.')) void agir(() => api(url(c), { method: 'DELETE' }), 'Carga excluída.'); }}>Excluir carga</button>}
                </div>
              </Cartao>
            );
          })}

          <section className="ent-secao" aria-label="Caminhões do dia">
            <div className="ent-secao-topo"><h2>Caminhões</h2></div>
            <div className="ent-caminhoes">
              {painel.caminhoes.length === 0 && <span className="cad-fraco">Nenhum caminhão cadastrado. Cadastre em Caminhões e motoristas.</span>}
              {painel.caminhoes.map((k) => (
                <span key={k.id} className="ent-caminhao">
                  <strong>{k.nome}</strong>
                  {k.situacao !== 'ativo' ? <Selo variante="vermelho">Em manutenção</Selo> : k.emUso ? <Selo variante="azul">Com carga</Selo> : <Selo variante="cinza">Livre</Selo>}
                </span>
              ))}
            </div>
          </section>
        </>
      )}
    </>
  );
}
