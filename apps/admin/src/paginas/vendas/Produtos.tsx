import { useCallback, useEffect, useState } from 'react';
import { api, uploadCompleto } from '../../api';
import { CabecalhoPagina, Cartao, Selo, Vazio } from '../../vendas-ui';
import { Paginador, useAtraso } from './Clientes';
import './cadastros.css';

interface Produto {
  id: string;
  codigo: string | null;
  nome: string;
  categoria: string | null;
  unidade: string | null;
  estoque: number;
  preco: number | null;
  ativo: boolean;
  imagemUrl: string | null;
}
interface Contagens { todos: number; comEstoque: number; semEstoque: number; comImagem: number; semImagem: number }
interface Resposta { tabelas: { id: string; nome: string }[]; tabelaId: string | null; dados: Produto[]; pagina: number; total: number; contagens: Contagens }

type FiltroEstoque = '' | 'com' | 'sem';
type FiltroImagem = '' | 'com' | 'sem';

export function VendasProdutos() {
  const [busca, setBusca] = useState('');
  const buscaAtraso = useAtraso(busca.trim());
  const [estoque, setEstoque] = useState<FiltroEstoque>('');
  const [imagem, setImagem] = useState<FiltroImagem>('');
  const [pagina, setPagina] = useState(1);
  const [res, setRes] = useState<Resposta | null>(null);
  const [contagens, setContagens] = useState<Contagens | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [erroFoto, setErroFoto] = useState<string | null>(null);
  const [subindoId, setSubindoId] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);

  useEffect(() => { setPagina(1); }, [buscaAtraso, estoque, imagem]);

  useEffect(() => {
    let vivo = true;
    const q = new URLSearchParams({ pagina: String(pagina) });
    if (buscaAtraso) q.set('busca', buscaAtraso);
    if (estoque) q.set('estoque', estoque);
    if (imagem) q.set('imagem', imagem);
    setErro(null);
    api<Resposta>(`/admin/vendas/produtos?${q}`)
      .then((r) => {
        if (!vivo) return;
        setRes(r);
        setContagens(r.contagens);
      })
      .catch((e: Error) => { if (vivo) setErro(e.message); });
    return () => { vivo = false; };
  }, [buscaAtraso, estoque, imagem, pagina, recarga]);

  const recarregar = useCallback(() => setRecarga((x) => x + 1), []);

  async function escolherFoto(id: string, e: React.ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0];
    const campo = e.target;
    if (!arquivo) return;
    setSubindoId(id);
    setErroFoto(null);
    try {
      const { url, urlMiniatura } = await uploadCompleto(arquivo, 'produto', '/admin/vendas');
      await api(`/admin/vendas/produtos/${id}/imagem`, { method: 'PUT', body: JSON.stringify({ url, urlMiniatura }) });
      recarregar();
    } catch (err) {
      setErroFoto((err as Error).message);
    } finally {
      setSubindoId(null);
      campo.value = '';
    }
  }

  async function removerFoto(id: string) {
    if (!confirm('Remover a foto deste produto?')) return;
    setErroFoto(null);
    try {
      await api(`/admin/vendas/produtos/${id}/imagem`, { method: 'DELETE' });
      recarregar();
    } catch (err) {
      setErroFoto((err as Error).message);
    }
  }

  const c = contagens;
  const escopo = estoque === 'com' ? 'Com estoque' : estoque === 'sem' ? 'Sem estoque' : 'Todos';

  return (
    <>
      <CabecalhoPagina titulo="Produtos" subtitulo="Fotos e estoque do catálogo." />
      <p className="cad-nota">As fotos são do produto: valem para o aplicativo de vendas e para o Delivery.</p>
      <p className="cad-nota">O estoque vem do ERP e não é editado aqui. Os preços ficam em cada tabela de preço.</p>
      <div className="cad-filtros">
        <input type="search" aria-label="Buscar produto" placeholder="Buscar por nome ou código" value={busca} onChange={(e) => setBusca(e.target.value)} />
      </div>
      <div className="cad-chips" role="group" aria-label="Filtrar por estoque">
        {([
          ['', 'Todos', c?.todos],
          ['com', 'Com estoque', c?.comEstoque],
          ['sem', 'Sem estoque', c?.semEstoque],
        ] as const).map(([valor, rotulo, qtd]) => (
          <button key={valor || 'todos'} type="button" className={`cad-chip${estoque === valor ? ' ativo' : ''}`} aria-pressed={estoque === valor} onClick={() => setEstoque(valor)}>
            {rotulo}{qtd != null ? ` (${qtd})` : ''}
          </button>
        ))}
      </div>
      <div className="cad-chips" role="group" aria-label="Filtrar por imagem">
        <span className="cad-fraco">Dentro de <strong>{escopo}</strong>:</span>
        {([
          ['com', 'Com imagem', c?.comImagem],
          ['sem', 'Sem imagem', c?.semImagem],
        ] as const).map(([valor, rotulo, qtd]) => (
          <button key={valor} type="button" className={`cad-chip${imagem === valor ? ' ativo' : ''}`} aria-pressed={imagem === valor} onClick={() => setImagem(imagem === valor ? '' : valor)}>
            {rotulo}{qtd != null ? ` (${qtd})` : ''}
          </button>
        ))}
      </div>
      {erro && <div className="cad-erro">{erro}</div>}
      {erroFoto && <div className="cad-erro" role="alert">{erroFoto}</div>}
      {!res && !erro ? <Cartao><Vazio mensagem="Carregando…" /></Cartao>
        : res && res.dados.length === 0 ? <Cartao><Vazio mensagem={res.total === 0 && !buscaAtraso && !estoque && !imagem ? 'Nenhum produto recebido do ERP ainda. Os produtos chegam pela integração.' : 'Nenhum produto encontrado para este filtro.'} /></Cartao>
        : res && (
          <>
            <div className="tabela-vendas-wrap">
              <table className="tabela-vendas" style={{ minWidth: 820 }}>
                <thead>
                  <tr><th>Foto</th><th>Produto</th><th>Categoria</th><th>Un.</th><th className="num">Estoque</th><th>Situação</th></tr>
                </thead>
                <tbody>
                  {res.dados.map((p) => {
                    const subindo = subindoId === p.id;
                    return (
                      <tr key={p.id}>
                        <td>
                          <div className="cad-foto">
                            <label className={`cad-foto-alvo${subindo ? ' ocupado' : ''}`} title={p.imagemUrl ? 'Trocar foto' : 'Enviar foto'}>
                              {p.imagemUrl
                                ? <img src={p.imagemUrl} alt={`Foto de ${p.nome}`} loading="lazy" />
                                : <span className="cad-foto-vazia">{subindo ? 'Enviando…' : 'foto'}</span>}
                              <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" aria-label={`${p.imagemUrl ? 'Trocar' : 'Enviar'} foto de ${p.nome}`}
                                onChange={(e) => escolherFoto(p.id, e)} disabled={subindo} />
                              {subindo && p.imagemUrl && <span className="cad-foto-enviando">Enviando…</span>}
                            </label>
                            {p.imagemUrl && !subindo && (
                              <button type="button" className="cad-foto-remover" aria-label={`Remover foto de ${p.nome}`} title="Remover foto" onClick={() => removerFoto(p.id)}>
                                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
                              </button>
                            )}
                          </div>
                        </td>
                        <td><strong>{p.nome}</strong><span className="cad-sub">{p.codigo ?? '-'}</span></td>
                        <td>{p.categoria ?? <span className="cad-fraco">-</span>}</td>
                        <td>{p.unidade ?? <span className="cad-fraco">-</span>}</td>
                        <td className="num">{p.estoque <= 0 ? <Selo variante="vermelho">Sem estoque</Selo> : p.estoque.toLocaleString('pt-BR')}</td>
                        <td><Selo variante={p.ativo ? 'verde' : 'cinza'}>{p.ativo ? 'Ativo' : 'Inativo'}</Selo></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Paginador pagina={res.pagina} total={res.total} onMudar={setPagina} />
            <p className="cad-nota" style={{ marginTop: 12 }}>
              Qualquer foto serve (celular, internet, catálogo), até 5 MB: o sistema padroniza em 1000×1000 com fundo branco. Fotografe sobre fundo claro.
            </p>
          </>
        )}
    </>
  );
}
