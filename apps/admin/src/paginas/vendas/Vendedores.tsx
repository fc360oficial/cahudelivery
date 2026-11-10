import { useCallback, useEffect, useState } from 'react';
import { api, sessao } from '../../api';
import { CabecalhoPagina, Cartao, Selo, Vazio, formatarDataHora } from '../../vendas-ui';
import './cadastros.css';

interface Vendedor {
  id: string; erpVendedorId: string | null; nome: string; filial: string | null; login: string | null; temSenha: boolean;
  ativo: boolean; ativoNoErp: boolean; bloqueadoNaRetaguarda: boolean; ultimaSyncEm: string | null; appVersao: string | null; clientes: number;
}
interface ItemCarteira { id: string; codigo: string | null; razaoSocial: string | null; cidade: string | null; ultimoPedidoEm: string | null }

function Situacao({ v }: { v: Vendedor }) {
  if (v.ativoNoErp === false) return <Selo variante="cinza">Inativo no ERP</Selo>;
  if (v.bloqueadoNaRetaguarda) return <Selo variante="vermelho">Bloqueado</Selo>;
  if (!v.temSenha) return <Selo variante="amarelo">Sem senha</Selo>;
  return <Selo variante="verde">Ativo</Selo>;
}

export function VendasVendedores() {
  const admin = sessao()?.papel === 'admin';
  const [dados, setDados] = useState<Vendedor[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const [editando, setEditando] = useState<Vendedor | null>(null);
  const [login, setLogin] = useState('');
  const [senha, setSenha] = useState('');
  const [mostrar, setMostrar] = useState(false);
  const [liberado, setLiberado] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [erroForm, setErroForm] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const [carteiraDe, setCarteiraDe] = useState<Vendedor | null>(null);
  const [carteira, setCarteira] = useState<ItemCarteira[] | null>(null);
  const [erroCarteira, setErroCarteira] = useState<string | null>(null);

  const carregar = useCallback(() => {
    api<Vendedor[]>('/admin/vendas/vendedores').then((d) => { setDados(d); setErro(null); }).catch((e: Error) => setErro(e.message));
  }, []);
  useEffect(carregar, [carregar]);

  function abrirAcesso(v: Vendedor) {
    setEditando(v); setLogin(v.login ?? ''); setSenha(''); setMostrar(false);
    setLiberado(!v.bloqueadoNaRetaguarda); setErroForm(null); setAviso(null);
  }

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (!editando) return;
    if (!editando.temSenha && !senha) { setErroForm('Defina uma senha: este vendedor ainda não tem.'); return; }
    setSalvando(true); setErroForm(null);
    try {
      await api(`/admin/vendas/vendedores/${editando.id}/acesso`, {
        method: 'PUT',
        body: JSON.stringify({ login: login.trim(), ...(senha ? { senha } : {}), ativo: liberado }),
      });
      setAviso(`Acesso de ${editando.nome} salvo.`);
      setEditando(null);
      carregar();
    } catch (err) {
      setErroForm((err as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  function verCarteira(v: Vendedor) {
    if (carteiraDe?.id === v.id) { setCarteiraDe(null); return; }
    setCarteiraDe(v); setCarteira(null); setErroCarteira(null);
    api<ItemCarteira[]>(`/admin/vendas/vendedores/${v.id}/carteira`)
      .then(setCarteira)
      .catch((err: Error) => setErroCarteira(err.message));
  }

  return (
    <>
      <CabecalhoPagina titulo="Vendedores" subtitulo="Equipe recebida do ERP, com acesso ao aplicativo e carteira de clientes." />
      {!admin && <p className="cad-nota">Somente administradores podem definir ou bloquear o acesso dos vendedores.</p>}
      {aviso && <div className="cad-ok" role="status">{aviso}</div>}
      {erro && <div className="cad-erro">{erro}</div>}

      {editando && (
        <Cartao className="cad-painel">
          <h2>Definir acesso de {editando.nome}</h2>
          <form className="cad-form" onSubmit={salvar}>
            {erroForm && <div className="cad-erro" style={{ gridColumn: '1 / -1', margin: 0 }}>{erroForm}</div>}
            <label htmlFor="vend-login">Login
              <input id="vend-login" type="text" value={login} onChange={(e) => setLogin(e.target.value)} required autoComplete="off" autoCapitalize="none" />
            </label>
            <label htmlFor="vend-senha">{editando.temSenha ? 'Nova senha (opcional)' : 'Senha'}
              <span className="cad-senha">
                <input id="vend-senha" type={mostrar ? 'text' : 'password'} value={senha} onChange={(e) => setSenha(e.target.value)} minLength={senha ? 8 : undefined} autoComplete="new-password" placeholder={editando.temSenha ? 'Vazio mantém a atual' : 'Mínimo de 8 caracteres'} />
                <button type="button" className="cad-btn cad-btn-claro cad-btn-mini" onClick={() => setMostrar((m) => !m)}>{mostrar ? 'Ocultar' : 'Mostrar'}</button>
              </span>
            </label>
            <label className="cad-check" htmlFor="vend-liberado">
              <input id="vend-liberado" type="checkbox" checked={liberado} onChange={(e) => setLiberado(e.target.checked)} />
              Acesso liberado
            </label>
            <p className="cad-ajuda">O login aceita letras, números, ponto, hífen e sublinhado. Bloquear o acesso ou trocar a senha encerra as sessões do vendedor no celular.</p>
            <div className="cad-acoes">
              <button className="cad-btn" disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar acesso'}</button>
              <button type="button" className="cad-btn cad-btn-claro" onClick={() => setEditando(null)} disabled={salvando}>Cancelar</button>
            </div>
          </form>
        </Cartao>
      )}

      {carteiraDe && (
        <Cartao className="cad-painel">
          <div className="cad-tabela-topo">
            <h2>Carteira de {carteiraDe.nome}{carteira ? ` (${carteira.length} ${carteira.length === 1 ? 'cliente' : 'clientes'})` : ''}</h2>
            <button type="button" className="cad-btn cad-btn-claro cad-btn-mini" onClick={() => setCarteiraDe(null)}>Fechar</button>
          </div>
          {erroCarteira ? <div className="cad-erro">{erroCarteira}</div>
            : carteira === null ? <Vazio mensagem="Carregando…" />
            : carteira.length === 0 ? <Vazio mensagem="Carteira vazia. A carteira chega pela integração com o ERP." />
            : (
              <div className="tabela-vendas-wrap" style={{ boxShadow: 'none', maxHeight: 360, overflowY: 'auto' }}>
                <table className="tabela-vendas">
                  <thead><tr><th>Código</th><th>Razão social</th><th>Cidade</th><th>Último pedido</th></tr></thead>
                  <tbody>
                    {carteira.map((c) => (
                      <tr key={c.id}>
                        <td>{c.codigo ?? '-'}</td>
                        <td>{c.razaoSocial ?? '-'}</td>
                        <td>{c.cidade ?? '-'}</td>
                        <td>{c.ultimoPedidoEm ? formatarDataHora(c.ultimoPedidoEm).slice(0, 10) : <span className="cad-fraco">sem pedidos</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        </Cartao>
      )}

      {dados === null && !erro ? <Cartao><Vazio mensagem="Carregando…" /></Cartao>
        : dados && dados.length === 0 ? <Cartao><Vazio mensagem="Nenhum vendedor recebido do ERP ainda. Os vendedores chegam pela integração." /></Cartao>
        : dados && (
          <div className="tabela-vendas-wrap">
            <table className="tabela-vendas" style={{ minWidth: 860 }}>
              <thead>
                <tr><th>Vendedor</th><th>Login</th><th>Carteira</th><th>Última sincronização</th><th>Versão do app</th><th>Situação</th>{admin && <th></th>}</tr>
              </thead>
              <tbody>
                {dados.map((v) => (
                  <tr key={v.id}>
                    <td>
                      <strong>{v.nome}</strong>
                      <span className="cad-sub">{[v.erpVendedorId && `ERP ${v.erpVendedorId}`, v.filial && `Filial ${v.filial}`].filter(Boolean).join(' · ')}</span>
                    </td>
                    <td>{v.login ?? <span className="cad-fraco">sem acesso definido</span>}</td>
                    <td>
                      <button type="button" className="cad-link" onClick={() => verCarteira(v)} aria-expanded={carteiraDe?.id === v.id}>
                        {v.clientes} {v.clientes === 1 ? 'cliente' : 'clientes'}
                      </button>
                    </td>
                    <td>{v.ultimaSyncEm ? formatarDataHora(v.ultimaSyncEm) : <span className="cad-fraco">nunca sincronizou</span>}</td>
                    <td>{v.appVersao ?? <span className="cad-fraco">-</span>}</td>
                    <td><Situacao v={v} /></td>
                    {admin && (
                      <td><button type="button" className="cad-btn cad-btn-claro cad-btn-mini" onClick={() => abrirAcesso(v)}>Definir acesso</button></td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </>
  );
}
