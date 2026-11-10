import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, salvarSessao, type Sessao } from '../api';

// As soluções que fazem parte do Fluxo Commerce.
const SOLUCOES = [
  { nome: 'Fluxo Vendas', descricao: 'Força de vendas para a equipe externa', emBreve: false, icone: <path d="M4 20V10M10 20V4M16 20v-8M3 20h18" /> },
  { nome: 'Fluxo Delivery', descricao: 'Pedidos do cliente pelo aplicativo', emBreve: false, icone: <><path d="M3 4h2l2.4 11h10.2L20 7H6.2" /><circle cx="9" cy="19" r="1.4" /><circle cx="17" cy="19" r="1.4" /></> },
  { nome: 'Fluxo Entregas', descricao: 'Rotas e acompanhamento das entregas', emBreve: true, icone: <><path d="M2 7h11v9H2z" /><path d="M13 10h4l4 3v3h-8" /><circle cx="6.5" cy="18" r="1.7" /><circle cx="17" cy="18" r="1.7" /></> },
];

// Datas comemorativas: ligam e desligam sozinhas pelo calendário. [mês, dia]; o período pode virar o ano.
const DATAS_COMEMORATIVAS: { de: [number, number]; ate: [number, number]; selo: string; saudacao: string }[] = [
  { de: [12, 1], ate: [12, 26], selo: 'Boas festas', saudacao: 'Feliz Natal e boas festas!' },
  { de: [12, 27], ate: [1, 2], selo: 'Feliz Ano Novo', saudacao: 'Um ótimo ano novo para você!' },
];

function dataComemorativa() {
  // ?data=2026-12-10 na URL simula um dia, só para conferir o visual antes da época.
  const simulada = new Date(new URLSearchParams(window.location.search).get('data') + 'T12:00:00');
  const hoje = Number.isNaN(simulada.getTime()) ? new Date() : simulada;
  const dia = (hoje.getMonth() + 1) * 100 + hoje.getDate();
  return DATAS_COMEMORATIVAS.find((d) => {
    const de = d.de[0] * 100 + d.de[1];
    const ate = d.ate[0] * 100 + d.ate[1];
    return de <= ate ? dia >= de && dia <= ate : dia >= de || dia <= ate;
  });
}

function Icone({ children }: { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

export function Login() {
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [verSenha, setVerSenha] = useState(false);
  const [ajudaSenha, setAjudaSenha] = useState(false);
  const festa = dataComemorativa();

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    setCarregando(true);
    setErro(null);
    try {
      const r = await api<Omit<Sessao, never>>('/admin/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, senha }),
      });
      salvarSessao(r);
      nav('/');
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setCarregando(false);
    }
  }

  return (
    <div className="login-tela">
      <section className="login-vitrine">
        {/* A foto é opcional: sem o arquivo, fica só o fundo azul-marinho. */}
        <img className="login-vitrine-foto" src="/login-foto.jpg" alt="" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
        <div className="login-vitrine-conteudo">
          <img className="login-vitrine-logo" src="/fluxo-commerce-claro.png" alt="Fluxo Commerce" />
          <div>
            {festa && (
              <div className="login-selo">
                <Icone><path d="M12 3l2.2 6.8L21 12l-6.8 2.2L12 21l-2.2-6.8L3 12l6.8-2.2z" /></Icone>
                {festa.selo}
              </div>
            )}
            <p className="login-vitrine-frase">
              <span>Sua operação</span> <span>comercial conectada</span> <span className="login-destaque">em um só lugar.</span>
            </p>
            <ul className="login-solucoes">
              {SOLUCOES.map((s) => (
                <li key={s.nome} className={s.emBreve ? 'login-em-breve' : undefined}>
                  <Icone>{s.icone}</Icone>
                  <div>
                    <strong>{s.nome}</strong>
                    {s.emBreve && <em>em breve</em>}
                    <small>{s.descricao}</small>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <main className="login-lado">
        <div className="login-card">
          <img className="login-card-logo" src="/fluxo-commerce.png" alt="Fluxo Commerce" />
          <h1>Bem-vindo de volta!</h1>
          <p>{festa ? festa.saudacao + " " : ""}Acesse sua conta para continuar</p>
          <form onSubmit={entrar}>
            <label htmlFor="login-email">E-mail</label>
            <div className="login-campo">
              <Icone><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></Icone>
              <input id="login-email" type="email" placeholder="seu@email.com" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <label htmlFor="login-senha">Senha</label>
            <div className="login-campo">
              <Icone><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></Icone>
              <input id="login-senha" type={verSenha ? 'text' : 'password'} placeholder="Digite sua senha" autoComplete="current-password" value={senha} onChange={(e) => setSenha(e.target.value)} required />
              <button type="button" className="login-olho" onClick={() => setVerSenha((v) => !v)} aria-label={verSenha ? 'Ocultar senha' : 'Mostrar senha'} aria-pressed={verSenha}>
                <Icone>
                  <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
                  <circle cx="12" cy="12" r="3" />
                  {!verSenha && <path d="m4 4 16 16" />}
                </Icone>
              </button>
            </div>
            {erro && <div className="erro-texto" role="alert">{erro}</div>}
            <button className="btn login-entrar" disabled={carregando}>
              <Icone><path d="M10 17l5-5-5-5M15 12H3M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" /></Icone>
              {carregando ? 'Entrando…' : 'Entrar'}
            </button>
          </form>
          <div className="login-ou"><span>ou</span></div>
          <button type="button" className="login-recuperar" onClick={() => setAjudaSenha((v) => !v)} aria-expanded={ajudaSenha}>
            Recuperar senha
          </button>
          {ajudaSenha && (
            <div className="login-ajuda" role="status">
              Peça a um administrador da distribuidora para definir uma nova senha em <b>Usuários</b>.
            </div>
          )}
        </div>
        <div className="login-seguro">
          <Icone><path d="M12 3 5 6v6c0 4.5 3 7.6 7 9 4-1.400 7-4.500 7-9V6l-7-3z" /><path d="m9 12 2 2 4-4" /></Icone>
          Ambiente seguro e protegido
        </div>
      </main>
    </div>
  );
}
