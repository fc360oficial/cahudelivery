import { NavLink } from 'react-router-dom';
import { sair, sessao } from './api';

const LINKS = [
  { para: '/', rotulo: '📊 Dashboard', exato: true },
  { para: '/pedidos', rotulo: '🧾 Pedidos' },
  { para: '/clientes', rotulo: '👥 Clientes' },
  { para: '/produtos', rotulo: '📦 Produtos' },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const s = sessao();
  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="marca">
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
