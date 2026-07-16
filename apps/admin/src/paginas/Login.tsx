import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, salvarSessao, type Sessao } from '../api';

export function Login() {
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);

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
    <div className="login-fundo">
      <div className="login-card">
        <div className="login-logo">
          <img src="/logo.png" alt="" onError={(e) => { e.currentTarget.parentElement!.style.display = 'none'; }} />
        </div>
        <h1>Retaguarda</h1>
        <p>Acesso da equipe da distribuidora</p>
        <form onSubmit={entrar}>
          <input type="email" placeholder="E-mail" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <input type="password" placeholder="Senha" value={senha} onChange={(e) => setSenha(e.target.value)} required />
          {erro && <div className="erro-texto">{erro}</div>}
          <button className="btn" disabled={carregando}>
            {carregando ? 'Entrando…' : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  );
}
