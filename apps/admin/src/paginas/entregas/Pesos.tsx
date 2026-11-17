import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../api';
import { CabecalhoPagina, Cartao, Vazio } from '../../vendas-ui';
import '../vendas/cadastros.css';
import './entregas.css';

type Situacao = 'sem' | 'estimado' | 'cadastro';
interface Produto {
  id: string; nome: string; codigo: string | null; unidadeVenda: string | null; qtdPorEmbalagem: number;
  pesoCadastroKg: number | null; pesoEstimadoKg: number | null; situacao: Situacao;
}
interface Resposta { resumo: Record<Situacao, number>; total: number; produtos: Produto[] }

const ABAS: [Situacao, string][] = [['sem', 'Sem peso'], ['estimado', 'Calculado pelo nome'], ['cadastro', 'Informado']];
const VAZIO: Record<Situacao, string> = {
  sem: 'Nenhum produto sem peso. Todos entram na conta da carga.',
  estimado: 'Nenhum produto com peso calculado pelo nome.',
  cadastro: 'Ninguém informou peso de produto ainda.',
};

const kg = (n: number) => `${n.toLocaleString('pt-BR', { maximumFractionDigits: 3 })} kg`;

/** "6,5" ou "6.5" → 6.5; vazio → null; outra coisa → NaN. */
function lerPeso(texto: string): number | null {
  const limpo = texto.trim().replace(',', '.');
  if (!limpo) return null;
  return /^\d+(\.\d{1,3})?$/.test(limpo) ? Number(limpo) : NaN;
}

export function EntregasPesos() {
  const [aba, setAba] = useState<Situacao>('sem');
  const [busca, setBusca] = useState('');
  const [dados, setDados] = useState<Resposta | null>(null);
  // Os totais das abas ficam na tela enquanto a lista de outra aba carrega.
  const [resumo, setResumo] = useState<Record<Situacao, number> | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  // Peso digitado em cada linha, ainda não salvo.
  const [digitado, setDigitado] = useState<Record<string, string>>({});
  const [salvando, setSalvando] = useState<string | null>(null);
  const pedido = useRef(0);

  const carregar = useCallback((situacao: Situacao, termo: string) => {
    const numero = ++pedido.current;
    const q = new URLSearchParams({ situacao, ...(termo.trim() ? { busca: termo.trim() } : {}) });
    api<Resposta>(`/admin/entregas/pesos?${q}`)
      .then((d) => { if (numero === pedido.current) { setDados(d); setResumo(d.resumo); setErro(null); } })
      .catch((e: Error) => { if (numero === pedido.current) setErro(e.message); });
  }, []);

  // A busca espera a pessoa parar de digitar.
  useEffect(() => {
    const t = setTimeout(() => carregar(aba, busca), busca ? 300 : 0);
    return () => clearTimeout(t);
  }, [aba, busca, carregar]);

  async function salvar(p: Produto, valor: number | null) {
    setSalvando(p.id); setErro(null); setAviso(null);
    try {
      await api(`/admin/entregas/produtos/${p.id}/peso`, { method: 'PUT', body: JSON.stringify({ pesoKg: valor }) });
      setAviso(valor === null ? `${p.nome}: peso informado apagado.` : `${p.nome}: ${kg(valor)} por ${p.unidadeVenda === 'KG' ? 'quilo' : 'caixa ou fardo'}.`);
      setDigitado((d) => { const { [p.id]: _fora, ...resto } = d; return resto; });
      carregar(aba, busca);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setSalvando(null);
    }
  }

  function enviar(e: React.FormEvent, p: Produto) {
    e.preventDefault();
    const valor = lerPeso(digitado[p.id] ?? '');
    if (valor === null) return;
    if (Number.isNaN(valor) || valor <= 0) { setErro(`${p.nome}: informe o peso em quilos, só com números. Exemplo: 6,5`); return; }
    void salvar(p, valor);
  }

  const r = resumo;

  return (
    <>
      <CabecalhoPagina
        titulo="Peso dos produtos"
        subtitulo="O peso da carga soma o peso de cada caixa ou fardo. Quando o nome do produto não diz a gramatura, informe aqui o peso da caixa."
      />
      {aviso && <div className="cad-ok" role="status">{aviso}</div>}
      {erro && <div className="cad-erro">{erro}</div>}

      <div className="cad-filtros">
        <div className="cad-chips" style={{ margin: 0 }} role="group" aria-label="Situação do peso">
          {ABAS.map(([s, rotulo]) => (
            <button key={s} type="button" className={`cad-chip${aba === s ? ' ativo' : ''}`} aria-pressed={aba === s} onClick={() => { if (s !== aba) { setAba(s); setDados(null); } }}>
              {rotulo}{r ? ` (${r[s].toLocaleString('pt-BR')})` : ''}
            </button>
          ))}
        </div>
        <input type="search" aria-label="Buscar produto" placeholder="Buscar pelo nome ou código" value={busca} onChange={(e) => setBusca(e.target.value)} />
      </div>

      {dados === null && !erro ? <Cartao><Vazio mensagem="Carregando…" /></Cartao>
        : dados && dados.produtos.length === 0 ? <Cartao><Vazio mensagem={busca.trim() ? 'Nenhum produto com essa busca.' : VAZIO[aba]} /></Cartao>
        : dados && (
          <>
            <div className="tabela-vendas-wrap">
              <table className="tabela-vendas ent-tabela">
                <thead>
                  <tr>
                    <th>Produto</th><th>Embalagem</th>
                    {aba !== 'sem' && <th className="num">{aba === 'cadastro' ? 'Pelo nome daria' : 'Peso calculado'}</th>}
                    <th>{aba === 'cadastro' ? 'Peso informado (kg)' : 'Peso da caixa (kg)'}</th>
                  </tr>
                </thead>
                <tbody>
                  {dados.produtos.map((p) => (
                    <tr key={p.id}>
                      <td className="ent-quebra ent-cliente">
                        <strong>{p.nome}</strong>
                        {p.codigo && <span className="cad-sub">código {p.codigo}</span>}
                      </td>
                      <td>{p.unidadeVenda ?? 'CX'} com {p.qtdPorEmbalagem.toLocaleString('pt-BR')}</td>
                      {aba !== 'sem' && <td className="num">{p.pesoEstimadoKg === null ? <span className="cad-fraco">o nome não diz</span> : `≈ ${kg(p.pesoEstimadoKg)}`}</td>}
                      <td>
                        <form className="ent-peso-form" onSubmit={(e) => enviar(e, p)}>
                          <input
                            type="text" inputMode="decimal" aria-label={`Peso da caixa de ${p.nome}, em quilos`}
                            placeholder={p.pesoCadastroKg !== null ? String(p.pesoCadastroKg).replace('.', ',') : 'ex.: 6,5'}
                            value={digitado[p.id] ?? ''} onChange={(e) => setDigitado({ ...digitado, [p.id]: e.target.value })}
                          />
                          <button className="cad-btn cad-btn-mini" disabled={salvando === p.id || !(digitado[p.id] ?? '').trim()}>{salvando === p.id ? 'Salvando…' : 'Salvar'}</button>
                          {p.pesoCadastroKg !== null && (
                            <button type="button" className="cad-btn cad-btn-claro cad-btn-mini" disabled={salvando === p.id} onClick={() => void salvar(p, null)}>Apagar</button>
                          )}
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {dados.total > dados.produtos.length && (
              <p className="cad-nota" style={{ marginTop: 12 }}>Mostrando {dados.produtos.length} de {dados.total.toLocaleString('pt-BR')} produtos. Use a busca para achar os outros.</p>
            )}
          </>
        )}
    </>
  );
}
