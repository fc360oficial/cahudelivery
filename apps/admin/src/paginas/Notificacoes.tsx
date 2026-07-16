import { useCallback, useEffect, useState } from 'react';
import { api, fmtData } from '../api';

interface Notif { id: string; titulo: string; corpo: string; enviada_em?: string; entregues: number; lidas: number }

export function Notificacoes() {
  const [dados, setDados] = useState<Notif[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [titulo, setTitulo] = useState('');
  const [corpo, setCorpo] = useState('');
  const [enviando, setEnviando] = useState(false);

  const carregar = useCallback(() => {
    api<Notif[]>('/admin/notificacoes').then(setDados).catch((e) => setErro(e.message));
  }, []);
  useEffect(carregar, [carregar]);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (!confirm('Enviar esta notificação para TODOS os clientes aprovados?')) return;
    setEnviando(true);
    try {
      await api('/admin/notificacoes', { method: 'POST', body: JSON.stringify({ titulo, corpo, destino: 'todos' }) });
      setTitulo(''); setCorpo(''); setErro(null);
      carregar();
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <>
      <h1>Notificações</h1>
      <form className="card" style={{ marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 10 }} onSubmit={enviar}>
        <input placeholder="Título (ex.: Ofertas da semana chegaram!)" value={titulo} onChange={(e) => setTitulo(e.target.value)} required maxLength={60} />
        <textarea placeholder="Mensagem" value={corpo} onChange={(e) => setCorpo(e.target.value)} required maxLength={200} rows={3}
          style={{ padding: '9px 12px', border: '1px solid var(--borda)', borderRadius: 8, font: 'inherit', resize: 'vertical' }} />
        <div className="filtros">
          <button className="btn" disabled={enviando}>{enviando ? 'Enviando…' : 'Enviar para todos os clientes'}</button>
          <small style={{ color: 'var(--texto-2)', alignSelf: 'center' }}>
            Aparece na aba de notificações do app. O push no celular (FCM) entra quando o projeto Firebase for configurado.
          </small>
        </div>
      </form>
      {erro && <div className="erro-texto">{erro}</div>}
      <div className="tabela-wrap">
        <table>
          <thead><tr><th>Notificação</th><th>Enviada</th><th>Entregues</th><th>Lidas</th></tr></thead>
          <tbody>
            {dados?.map((n) => (
              <tr key={n.id}>
                <td><strong>{n.titulo}</strong><div style={{ color: 'var(--texto-2)' }}>{n.corpo}</div></td>
                <td>{n.enviada_em ? fmtData(n.enviada_em) : '—'}</td>
                <td>{n.entregues}</td>
                <td>{n.lidas}</td>
              </tr>
            ))}
            {dados && !dados.length && <tr><td colSpan={4} className="vazio">Nenhuma notificação enviada</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
