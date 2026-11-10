import { Link, Navigate } from 'react-router-dom';
import { HOME_DA_SOLUCAO, sair, sessao, solucoesDaSessao } from '../api';
import '../vendas.css';

function Icone({ children }: { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

export function Solucoes() {
  const s = sessao();
  if (!s) return <Navigate to="/login" replace />;
  const minhas = solucoesDaSessao(s);
  const admin = s.papel === 'admin';
  return (
    <div className="solucoes-tela">
      <header className="solucoes-topo">
        <img src="/fluxo-commerce-claro.png" alt="Fluxo Commerce" />
        <div className="quem">
          <span>{s.nome}</span>
          <button type="button" onClick={sair}>Sair</button>
        </div>
      </header>
      <main className="solucoes-corpo">
        {!admin && minhas.length === 0 && (
          <p>Seu usuário ainda não tem acesso a nenhuma solução. Peça a um administrador.</p>
        )}
        {(admin || minhas.length > 0) && <h1>Onde você quer entrar?</h1>}
        {(admin || minhas.length > 0) && <div className="solucoes-cartoes">
          {minhas.includes('delivery') && (
            <Link className="solucao-cartao" to={HOME_DA_SOLUCAO.delivery}>
              <Icone><path d="M3 4h2l2.4 11h10.2L20 7H6.2" /><circle cx="9" cy="19" r="1.4" /><circle cx="17" cy="19" r="1.4" /></Icone>
              <strong>Delivery</strong>
              <span>Pedidos do cliente pelo aplicativo</span>
            </Link>
          )}
          {minhas.includes('vendas') && (
            <Link className="solucao-cartao" to={HOME_DA_SOLUCAO.vendas}>
              <Icone><path d="M4 20V10M10 20V4M16 20v-8M3 20h18" /></Icone>
              <strong>Vendas</strong>
              <span>Força de vendas da equipe externa</span>
            </Link>
          )}
          <div className="solucao-cartao desativado" aria-disabled="true">
            <Icone><path d="M2 7h11v9H2z" /><path d="M13 10h4l4 3v3h-8" /><circle cx="6.5" cy="18" r="1.7" /><circle cx="17" cy="18" r="1.7" /></Icone>
            <strong>Entregas</strong>
            <span>Rotas e acompanhamento das entregas</span>
            <em>Em breve</em>
          </div>
        </div>}
        {admin && (
          <section className="solucoes-admin">
            <h2>Administração</h2>
            <div className="solucoes-cartoes">
              <Link className="solucao-cartao" to="/admin/usuarios"><strong>Usuários e acessos</strong><span>Quem entra e em quais soluções</span></Link>
              <Link className="solucao-cartao" to="/admin/integracao"><strong>Integração ERP</strong><span>Logs e situação da integração</span></Link>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
