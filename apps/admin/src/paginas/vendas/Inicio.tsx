import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, sessao } from '../../api';
import { CabecalhoPagina, Cartao, formatarReais, Vazio } from '../../vendas-ui';
import { SeletorVendedor, SeloStatus, useVendedores } from './comum';
import './inicio-pedidos.css';

interface Painel {
  periodo: string;
  indicadores: {
    pedidos: number;
    vendido: number;
    ticketMedio: number;
    variacaoPedidosPct: number | null;
    variacaoVendidoPct: number | null;
    positivacao: { clientesCarteira: number; clientesPositivados: number; pct: number };
    retidos: number;
    orcamentosAbertos: { qtd: number; total: number };
  };
  evolucao: { dia: string; vendido: number; pedidos: number }[];
  recentes: { id: string; numero: number; cliente: string; vendedor: string | null; tabela: string | null; total: number; status: string; criadoEm: string }[];
  ranking: { vendedorId: string; nome: string; vendido: number; pedidos: number }[];
  categorias: { nome: string; vendido: number; pct: number }[];
}

const CORES_ROSCA = ['#1D5BE0', '#FFC20E', '#0B1F4B', '#9DB4E8', '#F29F3D', '#C9D2E3'];
const PERIODOS = [['hoje', 'Hoje'], ['semana', 'Esta semana'], ['mes', 'Este mês']] as const;

const Icone = ({ children }: { children: React.ReactNode }) => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);

const pct1 = (n: number) => `${Math.abs(n).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
const diaCurto = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const hora = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('pt-BR', { timeZone: 'America/Recife', hour: '2-digit', minute: '2-digit' });
};
const hojeRecife = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Recife' });

function NotaVariacao({ v }: { v: number | null }) {
  if (v == null) return <div className="nota">sem comparação</div>;
  if (v === 0) return <div className="nota">igual ao período anterior</div>;
  return <div className={`nota ${v > 0 ? 'sobe' : 'desce'}`}>{v > 0 ? '↑' : '↓'} {pct1(v)} vs. período anterior</div>;
}

function Indicador({ icone, fundo, cor, rotulo, valor, nota }: { icone: React.ReactNode; fundo: string; cor: string; rotulo: string; valor: string; nota: React.ReactNode }) {
  return (
    <Cartao className="indicador">
      <div className="icone" style={{ background: fundo, color: cor }}>{icone}</div>
      <div>
        <div className="rotulo">{rotulo}</div>
        <div className="valor">{valor}</div>
        {nota}
      </div>
    </Cartao>
  );
}

function Grafico({ evolucao }: { evolucao: Painel['evolucao'] }) {
  const total = evolucao.reduce((s, d) => s + d.vendido, 0);
  if (!evolucao.length || total <= 0) return <Vazio mensagem="Nenhuma venda no período." />;
  const max = Math.max(...evolucao.map((d) => d.vendido));
  const melhor = evolucao.reduce((a, d) => (d.vendido > a.vendido ? d : a), evolucao[0]);
  const sete = evolucao.length <= 7;
  const hoje = hojeRecife();
  const resumo = `Vendas nos últimos ${evolucao.length} dias: total de ${formatarReais(total)}. Melhor dia: ${diaCurto(melhor.dia)}, com ${formatarReais(melhor.vendido)}.`;
  const marcas = !sete
    ? [0, 0.25, 0.5, 0.75, 1].map((f) => evolucao[Math.round((evolucao.length - 1) * f)]).filter((d, i, a) => a.findIndex((x) => x.dia === d.dia) === i)
    : [];
  return (
    <div role="img" aria-label={resumo}>
      <div className={`grafico${sete ? ' sete' : ''}`} aria-hidden="true">
        {evolucao.map((d, i) => (
          <div key={d.dia} className={`coluna${d.dia === hoje || (!evolucao.some((x) => x.dia === hoje) && i === evolucao.length - 1) ? ' hoje' : ''}`} title={`${diaCurto(d.dia)}: ${formatarReais(d.vendido)}`}>
            {sete && <span className="vlr">{formatarReais(d.vendido)}</span>}
            <div className="barra" style={{ height: `${max > 0 ? (d.vendido / max) * 100 : 0}%` }} />
          </div>
        ))}
      </div>
      <div className={`eixo${sete ? '' : ' esparso'}`} aria-hidden="true">
        {sete ? evolucao.map((d) => <span key={d.dia}>{diaCurto(d.dia)}</span>) : marcas.map((d) => <span key={d.dia}>{diaCurto(d.dia)}</span>)}
      </div>
    </div>
  );
}

function Rosca({ categorias, total }: { categorias: Painel['categorias']; total: number }) {
  const soma = categorias.reduce((s, c) => s + c.pct, 0);
  let acc = 0;
  const partes = categorias.map((c, i) => {
    const ini = soma > 0 ? (acc / soma) * 100 : 0;
    acc += c.pct;
    const fim = soma > 0 ? (acc / soma) * 100 : 0;
    return `${CORES_ROSCA[i % CORES_ROSCA.length]} ${ini}% ${fim}%`;
  });
  const resumo = `Vendas por categoria: ${categorias.map((c) => `${c.nome} ${pct1(c.pct)}`).join(', ')}.`;
  return (
    <div className="rosca-wrap">
      <div className="rosca" role="img" aria-label={resumo} style={{ background: `conic-gradient(${partes.join(', ')})` }}>
        <div className="rosca-centro"><span>Total</span><strong>{formatarReais(total)}</strong></div>
      </div>
      <ul className="legenda">
        {categorias.map((c, i) => (
          <li key={c.nome}><i style={{ background: CORES_ROSCA[i % CORES_ROSCA.length] }} /><span>{c.nome}</span><span className="pct">{pct1(c.pct)}</span></li>
        ))}
      </ul>
    </div>
  );
}

export function VendasInicio() {
  const s = sessao();
  const primeiroNome = (s?.nome ?? '').trim().split(/\s+/)[0];
  const [periodo, setPeriodo] = useState<string>('mes');
  const [dias, setDias] = useState(7);
  const [vendedorId, setVendedorId] = useState('');
  const vendedores = useVendedores();
  const [painel, setPainel] = useState<Painel | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    const q = new URLSearchParams({ periodo, dias: String(dias) });
    if (vendedorId) q.set('vendedorId', vendedorId);
    api<Painel>(`/admin/vendas/painel?${q}`)
      .then((r) => { if (vivo) { setPainel(r); setErro(null); } })
      .catch((e: Error) => { if (vivo) setErro(e.message || 'Não foi possível carregar o painel.'); });
    return () => { vivo = false; };
  }, [periodo, dias, vendedorId]);

  const ind = painel?.indicadores;
  const totalCategorias = painel?.categorias.reduce((s, c) => s + c.vendido, 0) ?? 0;
  const ranking = painel ? [...painel.ranking.filter((r) => r.vendido > 0), ...painel.ranking.filter((r) => !(r.vendido > 0))] : [];

  return (
    <>
      <CabecalhoPagina
        titulo={`Olá${primeiroNome ? `, ${primeiroNome}` : ''}!`}
        subtitulo="Aqui está o resumo das vendas."
        acoes={
          <>
            <select aria-label="Período" value={periodo} onChange={(e) => setPeriodo(e.target.value)}>
              {PERIODOS.map(([v, r]) => <option key={v} value={v}>{r}</option>)}
            </select>
            <SeletorVendedor id="inicio-vendedor" valor={vendedorId} onChange={setVendedorId} vendedores={vendedores} />
          </>
        }
      />

      {vendedores && vendedores.length === 0 && (
        <div className="aviso-vendas">Nenhum vendedor recebido do ERP ainda. Os vendedores e as carteiras chegam pela integração.</div>
      )}
      {erro && <div className="erro-vendas" role="alert">{erro}</div>}
      {!painel && !erro && <Cartao><Vazio mensagem="Carregando…" /></Cartao>}

      {painel && ind && (
        <>
          {ind.retidos > 0 && (
            <div className="faixa-retidos">
              <div>
                <strong>{ind.retidos} {ind.retidos === 1 ? 'pedido retido aguardando o vendedor' : 'pedidos retidos aguardando o vendedor'}</strong>
                <p>Preço, estoque ou crédito mudaram depois do envio. O vendedor confirma ou cancela no aplicativo.</p>
              </div>
              <Link to="/vendas/pedidos?situacao=retidos">Ver pedidos retidos</Link>
            </div>
          )}

          <div className="grid-indicadores">
            <Indicador
              fundo="#1D5BE0" cor="#fff" rotulo="Pedidos" valor={String(ind.pedidos)} nota={<NotaVariacao v={ind.variacaoPedidosPct} />}
              icone={<Icone><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" /><path d="M3 6h18" /><path d="M16 10a4 4 0 0 1-8 0" /></Icone>}
            />
            <Indicador
              fundo="#0B1F4B" cor="#fff" rotulo="Vendas" valor={formatarReais(ind.vendido)} nota={<NotaVariacao v={ind.variacaoVendidoPct} />}
              icone={<Icone><path d="M12 1v22" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></Icone>}
            />
            <Indicador
              fundo="#FFC20E" cor="#0B1F4B" rotulo="Positivação no mês" valor={pct1(ind.positivacao.pct)}
              nota={<div className="nota">{ind.positivacao.clientesPositivados} de {ind.positivacao.clientesCarteira} clientes compraram</div>}
              icone={<Icone><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="m16 11 2 2 4-4" /></Icone>}
            />
            <Indicador
              fundo="#DCE5F7" cor="#0B1F4B" rotulo="Ticket médio" valor={formatarReais(ind.ticketMedio)}
              nota={<div className="nota">{ind.orcamentosAbertos.qtd} {ind.orcamentosAbertos.qtd === 1 ? 'orçamento aberto' : 'orçamentos abertos'} · {formatarReais(ind.orcamentosAbertos.total)}</div>}
              icone={<Icone><path d="M3 3v18h18" /><path d="m7 15 4-4 3 3 5-6" /></Icone>}
            />
          </div>

          <div className="grade-inicio">
            <Cartao>
              <div className="titulo-cartao">
                <h2>Evolução das vendas</h2>
                <div className="troca-dias" role="group" aria-label="Intervalo do gráfico">
                  {[7, 30, 90].map((d) => (
                    <button key={d} type="button" className={dias === d ? 'ativo' : ''} aria-pressed={dias === d} onClick={() => setDias(d)}>{d} dias</button>
                  ))}
                </div>
              </div>
              <Grafico evolucao={painel.evolucao} />
            </Cartao>

            <Cartao>
              <div className="titulo-cartao">
                <h2>Pedidos recentes</h2>
                <Link to="/vendas/pedidos">Ver todos</Link>
              </div>
              {painel.recentes.length === 0 ? <Vazio mensagem="Nenhum pedido ainda." /> : (
                <ul className="lista-inicio">
                  {painel.recentes.map((p) => (
                    <li key={p.id}>
                      <Link className="recente" to={`/vendas/pedidos/${p.id}`}>
                        <span>
                          <span className="rec-nome">{p.cliente}</span>
                          <span className="sub">{[p.vendedor, p.tabela].filter(Boolean).join(' · ')}</span>
                        </span>
                        <span className="rec-dir"><strong>{formatarReais(p.total)}</strong><SeloStatus status={p.status} /><span className="sub">{hora(p.criadoEm)}</span></span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Cartao>
          </div>

          <div className="grade-inicio tres" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
            <Cartao>
              <div className="titulo-cartao"><h2>Ranking de vendas</h2></div>
              {ranking.length === 0 ? <Vazio mensagem="Nenhum vendedor no período." /> : (
                <ul className="lista-inicio">
                  {ranking.map((r, i) => (
                    <li key={r.vendedorId} className="rank">
                      <span className={`medalha${i < 3 && r.vendido > 0 ? ` m${i + 1}` : ''}`}>{i + 1}</span>
                      <span className="rank-nome">{r.nome}</span>
                      <span className="rank-val"><strong>{formatarReais(r.vendido)}</strong><span className="sub">{r.pedidos} {r.pedidos === 1 ? 'pedido' : 'pedidos'}</span></span>
                    </li>
                  ))}
                </ul>
              )}
            </Cartao>
            <Cartao>
              <div className="titulo-cartao"><h2>Vendas por categoria</h2></div>
              {painel.categorias.length === 0 ? <Vazio mensagem="Nenhuma venda por categoria no período." /> : <Rosca categorias={painel.categorias} total={totalCategorias} />}
            </Cartao>
          </div>
        </>
      )}
    </>
  );
}
