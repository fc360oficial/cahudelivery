import { useCallback, useEffect, useState } from 'react';
import { api, sessao } from '../../api';
import { CabecalhoPagina, Cartao, Selo, Vazio, formatarDataHora, type VarianteSelo } from '../../vendas-ui';
import '../vendas/cadastros.css';
import './entregas.css';
import { EnderecoCd } from './EnderecoCd';

type Situacao = 'ativo' | 'manutencao' | 'inativo';

interface Caminhao {
  id: string; nome: string; placa: string | null; capacidadeKg: number | null;
  motoristaId: string | null; motoristaNome: string | null; regiao: string | null; situacao: Situacao;
}
interface Motorista {
  id: string; nome: string; telefone: string | null; login: string | null; temSenha: boolean; ativo: boolean;
  ultimoAcessoEm: string | null; appVersao: string | null; caminhoes: string | null;
}

const SITUACAO: Record<Situacao, [string, VarianteSelo]> = {
  ativo: ['Ativo', 'verde'],
  manutencao: ['Em manutenção', 'vermelho'],
  inativo: ['Fora de uso', 'cinza'],
};

const CAMINHAO_VAZIO = { nome: '', placa: '', capacidadeKg: '', motoristaId: '', regiao: '', situacao: 'ativo' as Situacao };
const MOTORISTA_VAZIO = { nome: '', telefone: '', ativo: true };

/** "3500" ou "3.500" → 3500; vazio → null; qualquer outra coisa → NaN (o formulário recusa). */
function lerPeso(texto: string): number | null {
  const limpo = texto.trim().replace(/\./g, '').replace(',', '.');
  if (!limpo) return null;
  return /^\d+(\.\d{1,2})?$/.test(limpo) ? Number(limpo) : NaN;
}

const formatarPeso = (kg: number | null) => (kg === null ? null : `${kg.toLocaleString('pt-BR')} kg`);

function SituacaoMotorista({ m }: { m: Motorista }) {
  if (!m.ativo) return <Selo variante="vermelho">Bloqueado</Selo>;
  if (!m.login || !m.temSenha) return <Selo variante="amarelo">Sem acesso</Selo>;
  return <Selo variante="verde">Ativo</Selo>;
}

export function EntregasCadastros() {
  const admin = sessao()?.papel === 'admin';
  const [caminhoes, setCaminhoes] = useState<Caminhao[] | null>(null);
  const [motoristas, setMotoristas] = useState<Motorista[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  // Caminhão em edição: id 'novo' = cadastro novo.
  const [caminhaoId, setCaminhaoId] = useState<string | null>(null);
  const [formCaminhao, setFormCaminhao] = useState(CAMINHAO_VAZIO);
  const [erroCaminhao, setErroCaminhao] = useState<string | null>(null);

  const [motoristaId, setMotoristaId] = useState<string | null>(null);
  const [formMotorista, setFormMotorista] = useState(MOTORISTA_VAZIO);
  const [erroMotorista, setErroMotorista] = useState<string | null>(null);

  const [acessoDe, setAcessoDe] = useState<Motorista | null>(null);
  const [login, setLogin] = useState('');
  const [senha, setSenha] = useState('');
  const [mostrar, setMostrar] = useState(false);
  const [liberado, setLiberado] = useState(true);
  const [erroAcesso, setErroAcesso] = useState<string | null>(null);

  const carregar = useCallback(() => {
    Promise.all([api<Caminhao[]>('/admin/entregas/caminhoes'), api<Motorista[]>('/admin/entregas/motoristas')])
      .then(([c, m]) => { setCaminhoes(c); setMotoristas(m); setErro(null); })
      .catch((e: Error) => setErro(e.message));
  }, []);
  useEffect(carregar, [carregar]);

  function abrirCaminhao(c: Caminhao | null) {
    setCaminhaoId(c ? c.id : 'novo');
    setFormCaminhao(c
      ? { nome: c.nome, placa: c.placa ?? '', capacidadeKg: c.capacidadeKg === null ? '' : String(c.capacidadeKg), motoristaId: c.motoristaId ?? '', regiao: c.regiao ?? '', situacao: c.situacao }
      : CAMINHAO_VAZIO);
    setErroCaminhao(null); setAviso(null);
  }

  async function salvarCaminhao(e: React.FormEvent) {
    e.preventDefault();
    const peso = lerPeso(formCaminhao.capacidadeKg);
    if (Number.isNaN(peso)) { setErroCaminhao('Informe o peso em quilos, só com números. Exemplo: 3500'); return; }
    setSalvando(true); setErroCaminhao(null);
    try {
      const body = JSON.stringify({
        nome: formCaminhao.nome, placa: formCaminhao.placa.trim() || null, capacidadeKg: peso,
        motoristaId: formCaminhao.motoristaId || null, regiao: formCaminhao.regiao.trim() || null, situacao: formCaminhao.situacao,
      });
      await (caminhaoId === 'novo'
        ? api('/admin/entregas/caminhoes', { method: 'POST', body })
        : api(`/admin/entregas/caminhoes/${caminhaoId}`, { method: 'PUT', body }));
      setAviso(`${formCaminhao.nome.trim()} salvo.`);
      setCaminhaoId(null);
      carregar();
    } catch (err) {
      setErroCaminhao((err as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  function abrirMotorista(m: Motorista | null) {
    setMotoristaId(m ? m.id : 'novo');
    setFormMotorista(m ? { nome: m.nome, telefone: m.telefone ?? '', ativo: m.ativo } : MOTORISTA_VAZIO);
    setErroMotorista(null); setAviso(null); setAcessoDe(null);
  }

  async function salvarMotorista(e: React.FormEvent) {
    e.preventDefault();
    setSalvando(true); setErroMotorista(null);
    try {
      const body = JSON.stringify({ nome: formMotorista.nome, telefone: formMotorista.telefone.trim() || null, ativo: formMotorista.ativo });
      await (motoristaId === 'novo'
        ? api('/admin/entregas/motoristas', { method: 'POST', body })
        : api(`/admin/entregas/motoristas/${motoristaId}`, { method: 'PUT', body }));
      setAviso(`${formMotorista.nome.trim()} salvo.`);
      setMotoristaId(null);
      carregar();
    } catch (err) {
      setErroMotorista((err as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  function abrirAcesso(m: Motorista) {
    setAcessoDe(m); setLogin(m.login ?? ''); setSenha(''); setMostrar(false); setLiberado(m.ativo);
    setErroAcesso(null); setAviso(null); setMotoristaId(null);
  }

  async function salvarAcesso(e: React.FormEvent) {
    e.preventDefault();
    if (!acessoDe) return;
    if (!acessoDe.temSenha && !senha) { setErroAcesso('Defina uma senha: este motorista ainda não tem.'); return; }
    setSalvando(true); setErroAcesso(null);
    try {
      await api(`/admin/entregas/motoristas/${acessoDe.id}/acesso`, {
        method: 'PUT',
        body: JSON.stringify({ login: login.trim(), ...(senha ? { senha } : {}), ativo: liberado }),
      });
      setAviso(`Acesso de ${acessoDe.nome} salvo.`);
      setAcessoDe(null);
      carregar();
    } catch (err) {
      setErroAcesso((err as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  const motoristasAtivos = motoristas?.filter((m) => m.ativo || m.id === formCaminhao.motoristaId) ?? [];

  // Coluna de região só aparece se algum caminhão usa (o CD hoje não trabalha por região).
  const comRegiao = !!caminhoes?.some((c) => c.regiao);
  return (
    <>
      <CabecalhoPagina titulo="Caminhões e motoristas" subtitulo="O cadastro que a montagem de carga usa: onde fica o CD, quanto cada caminhão leva e quem dirige." />
      {aviso && <div className="cad-ok" role="status">{aviso}</div>}
      {erro && <div className="cad-erro">{erro}</div>}

      <EnderecoCd podeEditar={admin} />

      <section className="ent-secao" aria-label="Caminhões">
        <div className="ent-secao-topo">
          <h2>Caminhões{caminhoes && <small>{caminhoes.length} {caminhoes.length === 1 ? 'cadastrado' : 'cadastrados'}</small>}</h2>
          <button type="button" className="cad-btn" onClick={() => abrirCaminhao(null)}>Novo caminhão</button>
        </div>

        {caminhaoId && (
          <Cartao className="cad-painel">
            <h2>{caminhaoId === 'novo' ? 'Novo caminhão' : `Editar ${formCaminhao.nome || 'caminhão'}`}</h2>
            <form className="cad-form ent-form" onSubmit={salvarCaminhao}>
              {erroCaminhao && <div className="cad-erro" style={{ gridColumn: '1 / -1', margin: 0 }}>{erroCaminhao}</div>}
              <label htmlFor="cam-nome">Nome que aparece nas telas
                <input id="cam-nome" type="text" value={formCaminhao.nome} onChange={(e) => setFormCaminhao({ ...formCaminhao, nome: e.target.value })} required maxLength={40} placeholder="Caminhão 1" />
              </label>
              <label htmlFor="cam-placa">Placa
                <input id="cam-placa" type="text" value={formCaminhao.placa} onChange={(e) => setFormCaminhao({ ...formCaminhao, placa: e.target.value.toUpperCase() })} maxLength={8} placeholder="ABC1D23" autoComplete="off" />
              </label>
              <label htmlFor="cam-peso">Leva até (kg)
                <input id="cam-peso" type="text" inputMode="numeric" value={formCaminhao.capacidadeKg} onChange={(e) => setFormCaminhao({ ...formCaminhao, capacidadeKg: e.target.value })} placeholder="3500" />
              </label>
              <label htmlFor="cam-motorista">Motorista de costume
                <select id="cam-motorista" value={formCaminhao.motoristaId} onChange={(e) => setFormCaminhao({ ...formCaminhao, motoristaId: e.target.value })}>
                  <option value="">Sem motorista fixo</option>
                  {motoristasAtivos.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
                </select>
              </label>
              <label htmlFor="cam-regiao">Região de costume (opcional)
                <input id="cam-regiao" type="text" value={formCaminhao.regiao} onChange={(e) => setFormCaminhao({ ...formCaminhao, regiao: e.target.value })} maxLength={80} placeholder="Deixe em branco se não usa" />
              </label>
              <label htmlFor="cam-situacao">Situação
                <select id="cam-situacao" value={formCaminhao.situacao} onChange={(e) => setFormCaminhao({ ...formCaminhao, situacao: e.target.value as Situacao })}>
                  <option value="ativo">Ativo</option>
                  <option value="manutencao">Em manutenção</option>
                  <option value="inativo">Fora de uso</option>
                </select>
              </label>
              <p className="cad-ajuda">Caminhão em manutenção ou fora de uso não entra na sugestão de carga. A região de costume é opcional: se preencher, a sugestão dá preferência ao caminhão nas entregas daquela região; em branco, ele pega qualquer região.</p>
              <div className="cad-acoes">
                <button className="cad-btn" disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar caminhão'}</button>
                <button type="button" className="cad-btn cad-btn-claro" onClick={() => setCaminhaoId(null)} disabled={salvando}>Cancelar</button>
              </div>
            </form>
          </Cartao>
        )}

        {caminhoes === null && !erro ? <Cartao><Vazio mensagem="Carregando…" /></Cartao>
          : caminhoes && caminhoes.length === 0 ? <Cartao><Vazio mensagem="Nenhum caminhão cadastrado ainda. Comece pelo botão Novo caminhão." /></Cartao>
          : caminhoes && (
            <div className="tabela-vendas-wrap">
              <table className="tabela-vendas ent-tabela">
                <thead><tr><th>Caminhão</th><th>Placa</th><th>Leva até</th><th>Motorista</th>{comRegiao && <th>Região de costume</th>}<th>Situação</th><th></th></tr></thead>
                <tbody>
                  {caminhoes.map((c) => (
                    <tr key={c.id}>
                      <td><strong>{c.nome}</strong></td>
                      <td>{c.placa ?? <span className="cad-fraco">sem placa</span>}</td>
                      <td>{formatarPeso(c.capacidadeKg) ?? <span className="cad-fraco">não informado</span>}</td>
                      <td>{c.motoristaNome ?? <span className="cad-fraco">sem motorista fixo</span>}</td>
                      {comRegiao && <td>{c.regiao ?? <span className="cad-fraco">-</span>}</td>}
                      <td><Selo variante={SITUACAO[c.situacao][1]}>{SITUACAO[c.situacao][0]}</Selo></td>
                      <td><button type="button" className="cad-btn cad-btn-claro cad-btn-mini" onClick={() => abrirCaminhao(c)}>Editar</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </section>

      <section className="ent-secao" aria-label="Motoristas">
        <div className="ent-secao-topo">
          <h2>Motoristas e acesso ao app{motoristas && <small>{motoristas.length} {motoristas.length === 1 ? 'cadastrado' : 'cadastrados'}</small>}</h2>
          <button type="button" className="cad-btn cad-btn-claro" onClick={() => abrirMotorista(null)}>Novo motorista</button>
        </div>
        {!admin && <p className="cad-nota">Somente administradores podem definir o login e a senha do motorista no aplicativo.</p>}

        {motoristaId && (
          <Cartao className="cad-painel">
            <h2>{motoristaId === 'novo' ? 'Novo motorista' : `Editar ${formMotorista.nome || 'motorista'}`}</h2>
            <form className="cad-form ent-form" onSubmit={salvarMotorista}>
              {erroMotorista && <div className="cad-erro" style={{ gridColumn: '1 / -1', margin: 0 }}>{erroMotorista}</div>}
              <label htmlFor="mot-nome">Nome
                <input id="mot-nome" type="text" value={formMotorista.nome} onChange={(e) => setFormMotorista({ ...formMotorista, nome: e.target.value })} required maxLength={80} />
              </label>
              <label htmlFor="mot-telefone">Celular
                <input id="mot-telefone" type="tel" value={formMotorista.telefone} onChange={(e) => setFormMotorista({ ...formMotorista, telefone: e.target.value })} maxLength={20} placeholder="(81) 90000-0000" />
              </label>
              {motoristaId !== 'novo' && (
                <label className="cad-check" htmlFor="mot-ativo">
                  <input id="mot-ativo" type="checkbox" checked={formMotorista.ativo} onChange={(e) => setFormMotorista({ ...formMotorista, ativo: e.target.checked })} />
                  Motorista ativo
                </label>
              )}
              <p className="cad-ajuda">Desativar o motorista encerra a sessão dele no aplicativo e tira o nome da lista de motoristas dos caminhões.</p>
              <div className="cad-acoes">
                <button className="cad-btn" disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar motorista'}</button>
                <button type="button" className="cad-btn cad-btn-claro" onClick={() => setMotoristaId(null)} disabled={salvando}>Cancelar</button>
              </div>
            </form>
          </Cartao>
        )}

        {acessoDe && (
          <Cartao className="cad-painel">
            <h2>Acesso de {acessoDe.nome} ao aplicativo</h2>
            <form className="cad-form ent-form" onSubmit={salvarAcesso}>
              {erroAcesso && <div className="cad-erro" style={{ gridColumn: '1 / -1', margin: 0 }}>{erroAcesso}</div>}
              <label htmlFor="mot-login">Login
                <input id="mot-login" type="text" value={login} onChange={(e) => setLogin(e.target.value)} required autoComplete="off" autoCapitalize="none" />
              </label>
              <label htmlFor="mot-senha">{acessoDe.temSenha ? 'Nova senha (opcional)' : 'Senha'}
                <span className="cad-senha">
                  <input id="mot-senha" type={mostrar ? 'text' : 'password'} value={senha} onChange={(e) => setSenha(e.target.value)} minLength={senha ? 8 : undefined} autoComplete="new-password" placeholder={acessoDe.temSenha ? 'Vazio mantém a atual' : 'Mínimo de 8 caracteres'} />
                  <button type="button" className="cad-btn cad-btn-claro cad-btn-mini" onClick={() => setMostrar((m) => !m)}>{mostrar ? 'Ocultar' : 'Mostrar'}</button>
                </span>
              </label>
              <label className="cad-check" htmlFor="mot-liberado">
                <input id="mot-liberado" type="checkbox" checked={liberado} onChange={(e) => setLiberado(e.target.checked)} />
                Acesso liberado
              </label>
              <p className="cad-ajuda">O login aceita letras, números, ponto, hífen e sublinhado. Bloquear o acesso ou trocar a senha encerra a sessão do motorista no celular.</p>
              <div className="cad-acoes">
                <button className="cad-btn" disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar acesso'}</button>
                <button type="button" className="cad-btn cad-btn-claro" onClick={() => setAcessoDe(null)} disabled={salvando}>Cancelar</button>
              </div>
            </form>
          </Cartao>
        )}

        {motoristas === null && !erro ? <Cartao><Vazio mensagem="Carregando…" /></Cartao>
          : motoristas && motoristas.length === 0 ? <Cartao><Vazio mensagem="Nenhum motorista cadastrado ainda. Comece pelo botão Novo motorista." /></Cartao>
          : motoristas && (
            <div className="tabela-vendas-wrap">
              <table className="tabela-vendas ent-tabela">
                <thead><tr><th>Motorista</th><th>Login</th><th>Caminhão</th><th>Último acesso</th><th>Situação</th><th></th></tr></thead>
                <tbody>
                  {motoristas.map((m) => (
                    <tr key={m.id}>
                      <td><strong>{m.nome}</strong>{m.telefone && <span className="cad-sub">{m.telefone}</span>}</td>
                      <td>{m.login ?? <span className="cad-fraco">não definido</span>}</td>
                      <td>{m.caminhoes ?? <span className="cad-fraco">nenhum</span>}</td>
                      <td>{m.ultimoAcessoEm ? formatarDataHora(m.ultimoAcessoEm) : <span className="cad-fraco">nunca entrou</span>}</td>
                      <td><SituacaoMotorista m={m} /></td>
                      <td>
                        <div className="ent-acoes-linha">
                          <button type="button" className="cad-btn cad-btn-claro cad-btn-mini" onClick={() => abrirMotorista(m)}>Editar</button>
                          {admin && <button type="button" className="cad-btn cad-btn-claro cad-btn-mini" onClick={() => abrirAcesso(m)}>Acesso ao app</button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </section>
    </>
  );
}
