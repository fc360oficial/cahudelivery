import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { api, HOME_DA_SOLUCAO, sair, sessao, solucoesDaSessao, type Solucao } from '../api';
import '../solucoes.css';

function Icone({ children, tamanho = 28 }: { children: React.ReactNode; tamanho?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={tamanho} height={tamanho} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

const ICONES: Record<Solucao, React.ReactNode> = {
  delivery: <><path d="M3 4h2l2.4 11h10.2L20 7H6.2" /><circle cx="9" cy="19" r="1.4" /><circle cx="17" cy="19" r="1.4" /></>,
  vendas: <path d="M4 20V10M10 20V4M16 20v-8M3 20h18" />,
  entregas: <><path d="M2 7h11v9H2z" /><path d="M13 10h4l4 3v3h-8" /><circle cx="6.5" cy="18" r="1.7" /><circle cx="17" cy="18" r="1.7" /></>,
};

const INFO: Record<Solucao, { titulo: string; texto: string; cor: string }> = {
  delivery: { titulo: 'Delivery', texto: 'Pedidos do cliente pelo aplicativo e pelo site', cor: 'azul' },
  vendas: { titulo: 'Vendas', texto: 'Força de vendas da equipe externa', cor: 'azul' },
  entregas: { titulo: 'Entregas', texto: 'Cargas, romaneio e acompanhamento dos caminhões', cor: 'amarelo' },
};

/** Dois números do dia por solução. null = ainda carregando; [] = não deu para buscar (o cartão some com os números). */
type Numero = { valor: number; rotulo: string; destaque?: boolean };

async function numerosDe(sol: Solucao): Promise<Numero[]> {
  if (sol === 'delivery') {
    const d = await api<{ hoje: { pedidos: number }; porStatus: { status: string; qtd: number }[] }>('/admin/dashboard');
    const aguardando = d.porStatus.find((x) => x.status === 'AGUARDANDO_PAGAMENTO')?.qtd ?? 0;
    return [
      { valor: d.hoje.pedidos, rotulo: d.hoje.pedidos === 1 ? 'pedido hoje' : 'pedidos hoje' },
      { valor: aguardando, rotulo: 'aguardando pagamento', destaque: aguardando > 0 },
    ];
  }
  if (sol === 'vendas') {
    const p = await api<{ indicadores: { pedidos: number; retidos: number } }>('/admin/vendas/painel?periodo=hoje&dias=7');
    const { pedidos, retidos } = p.indicadores;
    return [
      { valor: pedidos, rotulo: pedidos === 1 ? 'pedido hoje' : 'pedidos hoje' },
      { valor: retidos, rotulo: retidos === 1 ? 'retido pra conferir' : 'retidos pra conferir', destaque: retidos > 0 },
    ];
  }
  const [notas, cargas] = await Promise.all([
    api<{ resumo: { entregas: number } }>('/admin/entregas/notas-a-entregar'),
    api<{ cargas: { status: string }[] }>(`/admin/entregas/cargas?data=${hojeIso()}`),
  ]);
  const emRota = cargas.cargas.filter((c) => c.status === 'em_rota').length;
  const aguardando = cargas.cargas.filter((c) => c.status === 'rascunho').length;
  return [
    { valor: notas.resumo.entregas, rotulo: 'a entregar' },
    emRota > 0 || aguardando === 0
      ? { valor: emRota, rotulo: emRota === 1 ? 'caminhão em rota' : 'caminhões em rota' }
      : { valor: aguardando, rotulo: aguardando === 1 ? 'carga pra autorizar' : 'cargas pra autorizar', destaque: true },
  ];
}

function hojeIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function haQuanto(iso: string) {
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} h`;
  const dias = Math.round(h / 24);
  return `há ${dias} ${dias === 1 ? 'dia' : 'dias'}`;
}

function CartaoSolucao({ sol }: { sol: Solucao }) {
  const [numeros, setNumeros] = useState<Numero[] | null>(null);
  useEffect(() => {
    let vivo = true;
    numerosDe(sol).then((n) => vivo && setNumeros(n)).catch(() => vivo && setNumeros([]));
    return () => { vivo = false; };
  }, [sol]);
  const info = INFO[sol];
  return (
    <article className="sol-cartao">
      <div className="sol-cartao-topo">
        <span className={`sol-icone ${info.cor}`}><Icone>{ICONES[sol]}</Icone></span>
        <span className="sol-selo">No ar</span>
      </div>
      <h2>{info.titulo}</h2>
      <p className="sol-texto">{info.texto}</p>
      {numeros?.length !== 0 && (
        <div className="sol-numeros">
          {(numeros ?? [null, null]).map((n, i) => (
            <div key={i} className={n?.destaque ? 'destaque' : ''}>
              <strong>{n ? n.valor.toLocaleString('pt-BR') : '–'}</strong>
              <span>{n ? n.rotulo : 'carregando'}</span>
            </div>
          ))}
        </div>
      )}
      <Link className="sol-entrar" to={HOME_DA_SOLUCAO[sol]}>
        Entrar no {info.titulo}
        <Icone tamanho={18}><path d="M5 12h14M13 6l6 6-6 6" /></Icone>
      </Link>
    </article>
  );
}

function Administracao() {
  const [ativos, setAtivos] = useState<number | null>(null);
  const [erp, setErp] = useState<{ quando: string; ok: boolean } | null>(null);
  useEffect(() => {
    let vivo = true;
    api<{ ativo: boolean }[]>('/admin/usuarios').then((u) => vivo && setAtivos(u.filter((x) => x.ativo).length)).catch(() => {});
    api<{ dados: { criado_em: string; sucesso: boolean }[] }>('/admin/logs/integracao')
      .then((r) => { if (vivo && r.dados[0]) setErp({ quando: r.dados[0].criado_em, ok: r.dados[0].sucesso }); })
      .catch(() => {});
    return () => { vivo = false; };
  }, []);
  return (
    <section className="sol-admin">
      <h3>Administração</h3>
      <div className="sol-admin-lista">
        <Link className="sol-admin-item" to="/admin/usuarios">
          <span className="sol-admin-icone"><Icone tamanho={22}><circle cx="9" cy="8" r="3.2" /><path d="M3.5 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5" /><path d="M15.5 5.2a3 3 0 0 1 0 5.6M17.5 14.3c1.7.6 2.8 2.2 3 4.7" /></Icone></span>
          <span className="sol-admin-nome"><strong>Usuários e acessos</strong><small>Quem entra e em quais soluções</small></span>
          {ativos !== null && <span className="sol-admin-situacao"><b>{ativos}</b> {ativos === 1 ? 'ativo' : 'ativos'}</span>}
        </Link>
        <Link className="sol-admin-item" to="/admin/integracao">
          <span className="sol-admin-icone"><Icone tamanho={22}><path d="M4 8h14l-3-3M20 16H6l3 3" /></Icone></span>
          <span className="sol-admin-nome"><strong>Integração ERP</strong><small>Logs e situação da integração</small></span>
          {erp && (
            <span className={`sol-admin-situacao ${erp.ok ? 'ok' : 'falha'}`}>
              <i aria-hidden="true" />{erp.ok ? 'Última carga' : 'Falhou'} {haQuanto(erp.quando)}
            </span>
          )}
        </Link>
      </div>
    </section>
  );
}

export function Solucoes() {
  const s = sessao();
  if (!s) return <Navigate to="/login" replace />;
  const minhas = solucoesDaSessao(s);
  const admin = s.papel === 'admin';
  const primeiroNome = s.nome.trim().split(/\s+/)[0] || s.nome;
  const hoje = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
  return (
    <div className="sol-tela">
      <header className="sol-barra">
        <img src="/fluxo-commerce-claro.png" alt="Fluxo Commerce" />
        <div className="sol-quem">
          <span>{s.nome}</span>
          <button type="button" onClick={sair}>Sair</button>
        </div>
      </header>
      <section className="sol-boas-vindas">
        <svg className="sol-arcos" viewBox="0 0 400 300" aria-hidden="true">
          <circle cx="330" cy="40" r="190" fill="none" stroke="#ffc20e" strokeWidth="38" />
          <circle cx="210" cy="330" r="120" fill="none" stroke="#1d5be0" strokeWidth="34" />
        </svg>
        <div className="sol-largura">
          <p className="sol-data">{hoje} · {s.distribuidora}</p>
          <h1>Olá, {primeiroNome}!</h1>
          <p className="sol-pergunta">
            {minhas.length > 0 ? 'Onde você quer entrar hoje?' : 'Seu usuário ainda não tem acesso a nenhuma solução. Peça a um administrador.'}
          </p>
        </div>
      </section>
      <main className="sol-largura sol-corpo">
        {minhas.length > 0 && (
          <div className="sol-cartoes">
            {minhas.map((sol) => <CartaoSolucao key={sol} sol={sol} />)}
          </div>
        )}
        {admin && <Administracao />}
      </main>
    </div>
  );
}
