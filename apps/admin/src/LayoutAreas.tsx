import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { sair, sessao, solucoesDaSessao } from './api';
import './vendas.css';

export function Icone({ children }: { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

export interface Item { para: string; rotulo: string; exato?: boolean; icone: React.ReactNode }

const ITENS_VENDAS: Item[] = [
  { para: '/vendas', rotulo: 'Início', exato: true, icone: <path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" /> },
  { para: '/vendas/vendedores', rotulo: 'Vendedores', icone: <><circle cx="9" cy="8" r="3.2" /><path d="M3 20c0-3.3 2.7-6 6-6s6 2.700 6 6" /><path d="M16 5.500a3 3 0 0 1 0 5M18 14.300c1.800.800 3 2.500 3 4.700" /></> },
  { para: '/vendas/pedidos', rotulo: 'Pedidos', icone: <><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" /><path d="M9 8h6M9 12h6" /></> },
  { para: '/vendas/orcamentos', rotulo: 'Orçamentos', icone: <><path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z" /><path d="M14 3v5h5M9 13h6M9 17h4" /></> },
  { para: '/vendas/clientes', rotulo: 'Clientes', icone: <><rect x="4" y="3" width="16" height="18" rx="2" /><circle cx="12" cy="10" r="2.500" /><path d="M7.500 17c.600-2 2.200-3 4.500-3s3.900 1 4.500 3" /></> },
  { para: '/vendas/tabelas', rotulo: 'Tabelas e condições', icone: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18M9 4v16" /></> },
  { para: '/vendas/produtos', rotulo: 'Produtos', icone: <><path d="M12 3l8 4.500v9L12 21l-8-4.500v-9z" /><path d="M4 7.500l8 4.500 8-4.500M12 12v9" /></> },
];

const ITENS_DELIVERY: Item[] = [
  { para: '/', rotulo: 'Dashboard', exato: true, icone: <><rect x="3" y="3" width="7.500" height="7.500" rx="1.500" /><rect x="13.500" y="3" width="7.500" height="7.500" rx="1.500" /><rect x="3" y="13.500" width="7.500" height="7.500" rx="1.500" /><rect x="13.500" y="13.500" width="7.500" height="7.500" rx="1.500" /></> },
  { para: '/pedidos', rotulo: 'Pedidos', icone: <><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" /><path d="M9 8h6M9 12h6" /></> },
  { para: '/mapa', rotulo: 'Mapa', icone: <><path d="M12 21s7-6.200 7-11.500A7 7 0 0 0 5 9.500C5 14.800 12 21 12 21z" /><circle cx="12" cy="9.500" r="2.500" /></> },
  { para: '/clientes', rotulo: 'Clientes', icone: <><circle cx="9" cy="8" r="3.200" /><path d="M3 20c0-3.300 2.700-6 6-6s6 2.700 6 6" /><path d="M16 5.500a3 3 0 0 1 0 5M18 14.300c1.800.8 3 2.500 3 4.700" /></> },
  { para: '/credito', rotulo: 'Crédito', icone: <><circle cx="12" cy="12" r="9" /><path d="M14.500 9.200c-.5-.8-1.400-1.200-2.500-1.200-1.500 0-2.500.8-2.500 1.900 0 2.600 5 1.300 5 3.900 0 1.100-1.100 1.900-2.600 1.900-1.200 0-2.100-.5-2.600-1.300M12 6.500V8M12 16v1.500" /></> },
  { para: '/indicacoes', rotulo: 'Indique e Ganhe', icone: <><rect x="3" y="8" width="18" height="4" rx="1" /><path d="M5 12v8h14v-8M12 8v12" /><path d="M12 8c-1-3-5-3.500-5-1.200C7 8 9 8 12 8zM12 8c1-3 5-3.500 5-1.200C17 8 15 8 12 8z" /></> },
  { para: '/carteira', rotulo: 'Carteira', icone: <><path d="M3 7a2 2 0 0 1 2-2h12v4" /><path d="M3 7v11a2 2 0 0 0 2 2h14a1 1 0 0 0 1-1V10a1 1 0 0 0-1-1H5a2 2 0 0 1-2-2z" /><circle cx="16" cy="14.500" r="1" /></> },
  { para: '/cartao-rede', rotulo: 'Cartão (Rede)', icone: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 10h18M7 15h4" /></> },
  { para: '/produtos', rotulo: 'Produtos', icone: <><path d="M12 3l8 4.500v9L12 21l-8-4.500v-9z" /><path d="M4 7.500l8 4.500 8-4.500M12 12v9" /></> },
  { para: '/categorias', rotulo: 'Categorias', icone: <><path d="M12 3l9 4.500-9 4.500-9-4.500z" /><path d="M3 12l9 4.500 9-4.500M3 16.500l9 4.500 9-4.500" /></> },
  { para: '/marcas', rotulo: 'Fornecedores', icone: <><path d="M3 21V9l6 3V9l6 3V5h3a1 1 0 0 1 1 1v15z" /><path d="M8 17h2M14 17h2" /></> },
  { para: '/promocoes', rotulo: 'Ofertas da Semana', icone: <><path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z" /><circle cx="8" cy="8" r="1.500" /></> },
  { para: '/patrocinadores', rotulo: 'Patrocinadores', icone: <path d="M12 3l2.700 5.600 6.100.9-4.400 4.300 1 6.100L12 17l-5.400 2.900 1-6.100-4.400-4.300 6.100-.9z" /> },
  { para: '/banners', rotulo: 'Banners', icone: <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="1.800" /><path d="M21 16l-5-5-8 9" /></> },
  { para: '/notificacoes', rotulo: 'Notificações', icone: <><path d="M6 17V11a6 6 0 0 1 12 0v6l1.500 2h-15z" /><path d="M10 21h4" /></> },
  { para: '/configuracoes', rotulo: 'Configurações', icone: <><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" /><circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="18" cy="18" r="2" /></> },
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

/** Logo do cliente (preta sobre fundo claro): chip branco pequeno; some se a imagem não carregar. */
function LogoCliente() {
  const [falhou, setFalhou] = useState(false);
  if (falhou) return null;
  return (
    <div className="av-logo-cliente">
      <img src="/logo.png" alt="" onError={() => setFalhou(true)} />
    </div>
  );
}

export function Casca({ area, marca, itens, emBreve, children }: { area: string; marca: React.ReactNode; itens: Item[]; emBreve?: Item[]; children: React.ReactNode }) {
  const s = sessao();
  const nav = useNavigate();
  const [aberto, setAberto] = useState(false);
  const podeTrocar = solucoesDaSessao(s).length > 1;
  return (
    <div className={`area-fluxo ${area}`}>
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
          <div className="av-cliente">
            <LogoCliente />
            <div className="av-cliente-nome">
              <strong>{s?.nome}</strong>
              <span>{s?.distribuidora}</span>
            </div>
          </div>
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
      <main className={`av-conteudo${area === 'area-delivery' ? ' conteudo' : ''}`}>{children}</main>
    </div>
  );
}

export function LayoutVendas({ children }: { children: React.ReactNode }) {
  return (
    <Casca
      area="area-vendas"
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
      area="area-vendas"
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

export function LayoutDelivery({ children }: { children: React.ReactNode }) {
  return (
    <Casca
      area="area-delivery"
      itens={ITENS_DELIVERY}
      marca={
        <div className="av-marca-card">
          <img src="/fluxo-simbolo.png" alt="" />
          <div className="av-nome-marca"><span className="f">Fluxo</span><span className="v">Delivery</span></div>
        </div>
      }
    >
      {children}
    </Casca>
  );
}
