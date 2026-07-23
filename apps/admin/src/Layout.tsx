import { NavLink } from 'react-router-dom';
import { sair, sessao } from './api';

const LINKS = [
  { para: '/', rotulo: '📊 Dashboard', exato: true },
  { para: '/pedidos', rotulo: '🧾 Pedidos' },
  { para: '/clientes', rotulo: '👥 Clientes' },
  { para: '/produtos', rotulo: '📦 Produtos' },
  { para: '/categorias', rotulo: '🗂️ Categorias' },
  { para: '/marcas', rotulo: '🏷️ Marcas' },
  { para: '/promocoes', rotulo: '💛 Promoções' },
  { para: '/patrocinadores', rotulo: '🏭 Patrocinadores' },
  { para: '/banners', rotulo: '🖼️ Banners' },
  { para: '/notificacoes', rotulo: '🔔 Notificações' },
  { para: '/usuarios', rotulo: '🔑 Usuários' },
  { para: '/configuracoes', rotulo: '⚙️ Configurações' },
  { para: '/logs', rotulo: '🔌 Integração ERP' },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const s = sessao();
  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="marca">
          {/* Logo do tenant — mesmo estilo do app (amarelo + logo) */}
          <div className="marca-logo">
            <img src="/logo.png" alt="" onError={(e) => (e.currentTarget.style.display = 'none')} />
          </div>
          {s?.distribuidora ?? 'Retaguarda'}
          <small>FLUXO COMMERCE</small>
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
          <button onClick={sair}>Sair →</button>
        </div>
      </aside>
      <main className="conteudo">{children}</main>
    </div>
  );
}
