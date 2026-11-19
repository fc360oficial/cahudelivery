'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { sugerir, tokensDe, type ItemBusca } from '@/lib/catalogo/sugestoes';
import { formatarPreco, precoPorUnidade } from '@/lib/formato/preco';
import { BotaoAdicionar } from './BotaoAdicionar';
import cabecalho from './Cabecalho.module.css';
import estilos from './BuscaSugestoes.module.css';

const embalagem = (i: ItemBusca) => { const s = String(i.unidadeVenda ?? '').toUpperCase() || 'UN'; return i.qtdPorEmbalagem > 1 ? `${s} ${i.qtdPorEmbalagem}un` : s; };

/**
 * Campo de busca do cabeçalho com sugestões enquanto a pessoa digita (Tiago, 19/11/2026): produtos com foto,
 * embalagem, preço da caixa e da unidade e o botão de adicionar; ao lado, atalhos para refinar e as categorias.
 * O índice do catálogo é baixado uma vez, na primeira vez que o campo recebe o foco. Sem JavaScript, ou se o
 * índice falhar, o campo continua sendo o formulário de sempre: Enter abre /busca.
 */
export function BuscaSugestoes() {
  const [q, setQ] = useState('');
  const [aberto, setAberto] = useState(false);
  const [itens, setItens] = useState<ItemBusca[] | null>(null);
  const [categoria, setCategoria] = useState<string | null>(null);
  const pediu = useRef(false);
  const area = useRef<HTMLDivElement>(null);
  const campo = useRef<HTMLInputElement>(null);
  const caminho = usePathname();

  const carregar = useCallback(() => {
    if (pediu.current) return;
    pediu.current = true;
    fetch('/api/busca/indice')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('falha'))))
      .then((lista: unknown) => { if (Array.isArray(lista)) setItens(lista as ItemBusca[]); })
      .catch(() => { pediu.current = false; });   // tenta de novo no próximo foco; até lá vale o Enter
  }, []);

  // mudou de página: fecha; na página de resultados o campo mostra o que foi buscado
  useEffect(() => {
    setAberto(false); setCategoria(null);
    setQ(caminho === '/busca' ? (new URLSearchParams(window.location.search).get('q') ?? '').slice(0, 80) : '');
  }, [caminho]);

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => { if (area.current && !area.current.contains(e.target as Node)) setAberto(false); };
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') { setAberto(false); campo.current?.blur(); } };
    document.addEventListener('mousedown', fora); document.addEventListener('keydown', tecla);
    return () => { document.removeEventListener('mousedown', fora); document.removeEventListener('keydown', tecla); };
  }, [aberto]);

  const buscando = tokensDe(q).length > 0;
  const r = useMemo(() => (itens && buscando ? sugerir(itens, q, { categoria }) : null), [itens, q, categoria, buscando]);
  const mostrar = aberto && buscando && r !== null;
  const hrefTodos = `/busca?q=${encodeURIComponent(q.trim())}`;

  return (
    <div className={cabecalho.buscaArea} ref={area}>
      <form action="/busca" role="search" className={cabecalho.busca} onSubmit={() => setAberto(false)}>
        <label htmlFor="campo-busca" className="so-leitor">Buscar produto</label>
        <input id="campo-busca" name="q" type="search" placeholder="O que sua loja precisa hoje?" required minLength={2} maxLength={80}
          autoComplete="off" ref={campo} value={q} aria-expanded={mostrar} aria-controls="sugestoes-busca"
          onChange={(e) => { setQ(e.target.value); setCategoria(null); setAberto(true); }}
          onFocus={() => { carregar(); setAberto(true); }} />
        <button type="submit" aria-label="Buscar">
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
            <circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" />
          </svg>
        </button>
      </form>

      {mostrar && r && (
        <div id="sugestoes-busca" className={estilos.painel} data-testid="sugestoes-busca">
          {r.total === 0 && !categoria ? (
            <p className={estilos.vazio}>
              <strong>Não achamos “{q.trim()}”.</strong> Confira a escrita ou tente outra palavra. Se a distribuidora tiver o produto,
              o vendedor inclui no seu pedido: fale pelo WhatsApp.
            </p>
          ) : (
            <>
              {(r.refinos.length > 0 || r.categorias.length > 1) && (
                <div className={estilos.lado}>
                  <h2>Refinar</h2>
                  <ul>
                    {r.refinos.map((x) => (
                      <li key={x.texto}>
                        <button type="button" onClick={() => { setQ(x.texto); setCategoria(null); campo.current?.focus(); }}>
                          {x.texto}<small>{x.n}</small>
                        </button>
                      </li>
                    ))}
                    {r.categorias.length > 1 && r.categorias.map((c) => (
                      <li key={c.nome}>
                        <button type="button" aria-pressed={categoria === c.nome} className={categoria === c.nome ? estilos.ativo : undefined}
                          onClick={() => setCategoria(categoria === c.nome ? null : c.nome)}>
                          <span>em <b>{c.nome}</b></span><small>{c.n}</small>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className={estilos.produtos}>
                <h2>Produtos</h2>
                <ul>
                  {r.produtos.map((p) => {
                    const unidade = p.preco != null ? precoPorUnidade(p.preco, p.qtdPorEmbalagem) : null;
                    return (
                      <li key={p.id} data-testid="sugestao-produto">
                        <Link href={p.caminho} className={estilos.foto} tabIndex={-1} aria-hidden="true">
                          {p.foto ? <img src={p.foto} alt="" loading="lazy" decoding="async" /> : <span>Sem foto</span>}
                        </Link>
                        <span className={estilos.texto}>
                          <Link href={p.caminho} className={estilos.nome}>{p.nome}</Link>
                          <span className={estilos.emb}>{embalagem(p)}</span>
                        </span>
                        <span className={estilos.preco}>
                          {p.preco != null ? (
                            <>
                              {p.precoDe != null && <s>{formatarPreco(p.precoDe)}</s>}
                              <strong>{formatarPreco(p.preco)}</strong>
                              {unidade != null && <small>{formatarPreco(unidade)} a unidade</small>}
                            </>
                          ) : <small>Preço sob consulta</small>}
                        </span>
                        <span className={estilos.acao}>
                          {p.comprar && <BotaoAdicionar produtoId={p.id} qtdMinima={p.qtdMinima} nome={p.nome} />}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
              <div className={estilos.rodape}>
                <Link href={hrefTodos}>{r.total === 1 ? 'Ver o resultado' : `Ver os ${r.total} resultados`} de “{q.trim()}”</Link>
                <span>Enter abre a lista completa</span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
