import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { sair, sessao, solucoesDaSessao } from './api';
import './vendas.css';

function Icone({ children }: { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

interface Item { para: string; rotulo: string; exato?: boolean; icone: React.ReactNode }

const ITENS_VENDAS: Item[] = [
  { para: '/vendas', rotulo: 'Início', exato: true, icone: <path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" /> },
  { para: '/vendas/vendedores', rotulo: 'Vendedores', icone: <><circle cx="9" cy="8" r="3.2" /><path d="M3 20c0-3.3 2.7-6 6-6s6 2.700 6 6" /><path d="M16 5.500a3 3 0 0 1 0 5M18 14.300c1.800.800 3 2.500 3 4.700" /></> },
  { para: '/vendas/pedidos', rotulo: 'Pedidos', icone: <><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" /><path d="M9 8h6M9 12h6" /></> },
  { para: '/vendas/orcamentos', rotulo: 'Orçamentos', icone: <><path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z" /><path d="M14 3v5h5M9 13h6M9 17h4" /></> },
  { para: '/vendas/clientes', rotulo: 'Clientes', icone: <><rect x="4" y="3" width="16" height="18" rx="2" /><circle cx="12" cy="10" r="2.500" /><path d="M7.500 17c.600-2 2.200-3 4.500-3s3.900 1 4.500 3" /></> },
  { para: '/vendas/tabelas', rotulo: 'Tabelas e condições', icone: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18M9 4v16" /></> },
  { para: '/vendas/produtos', rotulo: 'Produtos', icone: <><path d="M12 3l8 4.500v9L12 21l-8-4.500v-9z" /><path d="M4 7.500l8 4.500 8-4.500M12 12v9" /></> },
];

const EM_BREVE: Item[] = [
  { para: '', rotulo: 'Metas', icone: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4.500" /><circle cx="12" cy="12" r="1" /></> },
  { para: '', rotulo: 'Mapa de vendas', icone: <><path d="M12 21s7-6.200 7-11.500A7 7 0 0 0 5 9.500C5 14.800 12 21 12 21z" /><circle cx="12" cy="9.500" r="2.500" /></> },
  { para: '', rotulo: 'Relatórios', icone: <path d="M4 20V10M10 20V4M16 20v-8M3 20h18" /> },
];

const ITENS_ADMIN: Item[] = [
  { para: '/admin/usuarios', rotulo: 'Usuários e acessos', icone: <><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></> },
  { para: '/admin/integracao', rotulo: 'Integração ERP', icone: <><path d="M9 3v5M15 3v5M7 8h10v4a5 5 0 0 1-10 0z" /><path d="M12 17v4" /></> },
];

function Casca({ marca, itens, emBreve, children }: { marca: React.ReactNode; itens: Item[]; emBreve?: Item[]; children: React.ReactNode }) {
  const s = sessao();
  const nav = useNavigate();
  const [aberto, setAberto] = useState(false);
  const podeTrocar = solucoesDaSessao(s).length > 1;
  return (
    <div className="area-vendas">
      <div className="av-topo-mobile">
        <strong>{s?.distribuidora ?? 'Retaguarda'}</strong>
        <button type="button" onClick={() => setAberto((v) => !v)} aria-expanded={aberto}>{aberto ? 'Fechar' : 'Menu'}</button>
      </div>
      <aside className={`av-lateral${aberto ? ' aberta' : ''}`}>
        <div className="av-marca">{marca}</div>
        <nav className="av-menu">
          {itens.map((i) => (
            <NavLink key={i.para} to={i.para} end={i.exato} className={({ isActive }) => (isActive ? 'ativo' : '')} onClick={() => setAberto(false)}>
              <Icone>{i.icone}</Icone>
              {i.rotulo}
            </NavLink>
          ))}
          {emBreve && (
            <>
              <div className="av-breve">Em breve</div>
              {emBreve.map((i) => (
                <div key={i.rotulo} className="av-breve-item" aria-disabled="true">
                  <Icone>{i.icone}</Icone>
                  {i.rotulo}
                </div>
              ))}
            </>
          )}
        </nav>
        <div className="av-rodape">
          <strong>{s?.nome}</strong>
          <span>{s?.distribuidora}</span>
          {podeTrocar && (
            <button type="button" onClick={() => nav('/solucoes')}>
              <Icone><path d="M7 7h12l-3-3M17 17H5l3 3" /></Icone>
              Trocar de solução
            </button>
          )}
          <button type="button" onClick={sair}>
            <Icone><path d="M10 17l5-5-5-5M15 12H3M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" /></Icone>
            Sair
          </button>
        </div>
      </aside>
      <main className="av-conteudo">{children}</main>
    </div>
  );
}

export function LayoutVendas({ children }: { children: React.ReactNode }) {
  return (
    <Casca
      itens={ITENS_VENDAS}
      emBreve={EM_BREVE}
      marca={
        <div className="av-marca-card">
          <img src="/fluxo-simbolo.png" alt="" />
          <div className="av-nome-marca"><span className="f">Fluxo</span><span className="v">Vendas</span></div>
        </div>
      }
    >
      {children}
    </Casca>
  );
}

export function LayoutAdmin({ children }: { children: React.ReactNode }) {
  return (
    <Casca
      itens={ITENS_ADMIN}
      marca={
        <div className="av-marca-admin">
          <img src="/fluxo-commerce-claro.png" alt="Fluxo Commerce" />
          <small>ADMINISTRAÇÃO</small>
        </div>
      }
    >
      {children}
    </Casca>
  );
}
