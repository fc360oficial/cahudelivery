import { NavLink, useNavigate } from 'react-router-dom';
import { sair, sessao, solucoesDaSessao } from './api';

const LINKS = [
  { para: '/', rotulo: '📊 Dashboard', exato: true },
  { para: '/pedidos', rotulo: '🧾 Pedidos' },
  { para: '/mapa', rotulo: '🗺️ Mapa' },
  { para: '/clientes', rotulo: '👥 Clientes' },
  { para: '/credito', rotulo: '💳 Crédito' },
  { para: '/indicacoes', rotulo: '🎁 Indique e Ganhe' },
  { para: '/carteira', rotulo: '💰 Carteira' },
  { para: '/cartao-rede', rotulo: '💳 Cartão (Rede)' },
  { para: '/produtos', rotulo: '📦 Produtos' },
  { para: '/categorias', rotulo: '🗂️ Categorias' },
  { para: '/marcas', rotulo: '🏭 Fornecedores' },
  { para: '/promocoes', rotulo: '💛 Ofertas da Semana' },
  { para: '/patrocinadores', rotulo: '🏭 Patrocinadores' },
  { para: '/banners', rotulo: '🖼️ Banners' },
  { para: '/notificacoes', rotulo: '🔔 Notificações' },
  { para: '/configuracoes', rotulo: '⚙️ Configurações' },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const s = sessao();
  const nav = useNavigate();
  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="marca">
          {/* Logo do tenant — mesmo estilo do app (amarelo + logo) */}
          <div className="marca-logo">
            <img src="/logo.png" alt="" onError={(e) => (e.currentTarget.style.display = 'none')} />
          </div>
          {s?.distribuidora ?? 'Retaguarda'}
          <small>FLUXO COMMERCE · DELIVERY</small>
        </div>
        <nav>
          {LINKS.map((l) => (
            <NavLink key={l.para} to={l.para} end={l.exato} className={({ isActive }) => (isActive ? 'ativo' : '')}>
              {l.rotulo}
            </NavLink>
          ))}
        </nav>
        <div className="rodape">
          <div>{s?.nome}</div>
          {solucoesDaSessao(s).length > 1 && (
            <button onClick={() => nav('/solucoes')} style={{ display: 'block' }}>Trocar de solução</button>
          )}
          <button onClick={sair}>Sair →</button>
        </div>
      </aside>
      <main className="conteudo">{children}</main>
    </div>
  );
}
