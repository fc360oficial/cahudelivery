import { useCallback, useEffect, useRef, useState } from 'react';
import { api, uploadCompleto } from '../../api';
import { CabecalhoPagina, Cartao, Selo, Vazio } from '../../vendas-ui';
import './cadastros.css';

interface Cat {
  id: string; pai_id: string | null; nome: string; imagem_url: string | null; ordem: number; ativo: boolean; produtos: number;
}

const VAZIA = { nome: '', paiId: '', ordem: 0, imagemUrl: '' };

export function VendasCategorias() {
  const [dados, setDados] = useState<Cat[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [subindoFoto, setSubindoFoto] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [form, setForm] = useState(VAZIA);
  const [editando, setEditando] = useState<string | null>(null);
  const inputNome = useRef<HTMLInputElement>(null);
  const nomeEditando = dados?.find((c) => c.id === editando)?.nome;

  const carregar = useCallback(() => {
    api<Cat[]>('/admin/vendas/categorias').then((r) => { setDados(r); setErro(null); }).catch((e: Error) => setErro(e.message));
  }, []);
  useEffect(carregar, [carregar]);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setSalvando(true);
    try {
      const body = JSON.stringify({ nome: form.nome, paiId: form.paiId || undefined, ordem: Number(form.ordem), imagemUrl: form.imagemUrl });
      await (editando
        ? api(`/admin/vendas/categorias/${editando}`, { method: 'PUT', body })
        : api('/admin/vendas/categorias', { method: 'POST', body }));
      setForm(VAZIA);
      setEditando(null);
      carregar();
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  async function alternar(c: Cat) {
    try {
      await api(`/admin/vendas/categorias/${c.id}`, {
        method: 'PUT',
        body: JSON.stringify({ nome: c.nome, paiId: c.pai_id ?? undefined, ativo: !c.ativo }),
      });
      carregar();
    } catch (err) {
      setErro((err as Error).message);
    }
  }

  async function escolherFoto(e: React.ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0];
    const campo = e.target;
    if (!arquivo) return;
    setSubindoFoto(true);
    try {
      const { url } = await uploadCompleto(arquivo, 'categoria', '/admin/vendas');
      setForm((f) => ({ ...f, imagemUrl: url }));
      setErro(null);
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setSubindoFoto(false);
      campo.value = '';
    }
  }

  function editar(c: Cat) {
    setEditando(c.id);
    setForm({ nome: c.nome, paiId: c.pai_id ?? '', ordem: c.ordem, imagemUrl: c.imagem_url ?? '' });
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setTimeout(() => inputNome.current?.focus(), 300);
  }

  const raizes = dados?.filter((c) => !c.pai_id) ?? [];
  const filhasDe = (id: string) => dados?.filter((c) => c.pai_id === id) ?? [];

  return (
    <>
      <CabecalhoPagina titulo="Categorias" subtitulo="Agrupam os produtos no aplicativo de vendas, com foto, ordem e subcategorias." />
      <p className="cad-nota">As categorias são do catálogo: valem para o aplicativo de vendas e para o Delivery.</p>
      {editando && (
        <div className="cad-ok" role="status">Editando <strong>{nomeEditando}</strong>. Altere abaixo e clique em Salvar edição.</div>
      )}
      <Cartao className="cad-cat-form">
        <form className="cad-filtros" onSubmit={salvar}>
          <label className="cad-cat-campo" htmlFor="cat-nome">Nome
            <input id="cat-nome" ref={inputNome} type="text" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} required />
          </label>
          <label className="cad-cat-campo" htmlFor="cat-pai">Dentro de
            <select id="cat-pai" value={form.paiId} onChange={(e) => setForm({ ...form, paiId: e.target.value })}>
              <option value="">(categoria principal)</option>
              {raizes.filter((c) => c.id !== editando).map((c) => <option key={c.id} value={c.id}>Sub de: {c.nome}</option>)}
            </select>
          </label>
          <label className="cad-cat-campo" htmlFor="cat-ordem">Ordem
            <input id="cat-ordem" type="number" value={form.ordem} onChange={(e) => setForm({ ...form, ordem: Number(e.target.value) })} />
          </label>
          <label className={`cad-btn cad-btn-claro cad-cat-foto${subindoFoto ? ' ocupado' : ''}`} htmlFor="cat-foto">
            {form.imagemUrl && <img src={form.imagemUrl} alt="Foto da categoria" />}
            {subindoFoto ? 'Enviando…' : form.imagemUrl ? 'Trocar foto' : 'Foto'}
            <input id="cat-foto" type="file" accept="image/png,image/jpeg,image/webp" disabled={subindoFoto} onChange={escolherFoto} />
          </label>
          {form.imagemUrl && <button type="button" className="cad-btn cad-btn-claro cad-btn-mini" title="Remover foto" onClick={() => setForm((f) => ({ ...f, imagemUrl: '' }))}>Remover foto</button>}
          <button type="submit" className="cad-btn" disabled={salvando || subindoFoto}>{editando ? 'Salvar edição' : 'Adicionar'}</button>
          {editando && <button type="button" className="cad-btn cad-btn-claro" onClick={() => { setEditando(null); setForm(VAZIA); }}>Cancelar</button>}
        </form>
      </Cartao>
      {erro && <div className="cad-erro" role="alert">{erro}</div>}
      {!dados && !erro ? <Cartao><Vazio mensagem="Carregando…" /></Cartao>
        : dados && dados.length === 0 ? <Cartao><Vazio mensagem="Nenhuma categoria cadastrada ainda." /></Cartao>
        : dados && (
          <div className="tabela-vendas-wrap">
            <table className="tabela-vendas">
              <thead><tr><th>Categoria</th><th>Produtos</th><th>Ordem</th><th>Situação</th><th>Ações</th></tr></thead>
              <tbody>
                {raizes.flatMap((c) => [c, ...filhasDe(c.id)]).map((c) => (
                  <tr key={c.id}>
                    <td>
                      <span className={`cad-cat-nome${c.pai_id ? ' sub' : ''}`}>
                        {c.imagem_url
                          ? <img src={c.imagem_url} alt="" />
                          : <span className="cad-cat-semfoto" title="Sem foto" />}
                        {c.pai_id ? <span className="cad-fraco">↳ {c.nome}</span> : <strong>{c.nome}</strong>}
                      </span>
                    </td>
                    <td>{c.produtos}</td>
                    <td>{c.ordem}</td>
                    <td><Selo variante={c.ativo ? 'verde' : 'cinza'}>{c.ativo ? 'Ativa' : 'Inativa'}</Selo></td>
                    <td>
                      <div className="cad-cat-acoes">
                        <button type="button" className="cad-btn cad-btn-claro cad-btn-mini" onClick={() => editar(c)}>Editar</button>
                        <button type="button" className="cad-btn cad-btn-claro cad-btn-mini" onClick={() => alternar(c)}>{c.ativo ? 'Desativar' : 'Ativar'}</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </>
  );
}
