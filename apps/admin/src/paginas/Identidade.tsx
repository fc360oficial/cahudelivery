import { useEffect, useState } from 'react';
import { api, uploadCompleto, definirLogoDaSessao, LOGO_PADRAO } from '../api';
import { CabecalhoPagina, Cartao } from '../vendas-ui';
import './vendas/cadastros.css';

interface Identidade { logoUrl: string | null; distribuidora: string }

export function Identidade() {
  const [dados, setDados] = useState<Identidade | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [semImagem, setSemImagem] = useState(false);

  useEffect(() => {
    api<Identidade>('/admin/identidade')
      .then((r) => { setDados(r); definirLogoDaSessao(r.logoUrl); })
      .catch((e: Error) => setErro(e.message));
  }, []);

  async function enviar(e: React.ChangeEvent<HTMLInputElement>) {
    const campo = e.target;
    const arquivo = campo.files?.[0];
    if (!arquivo) return;
    setOcupado(true); setErro(null); setOk(null);
    try {
      const { url } = await uploadCompleto(arquivo, undefined, '/admin/identidade');
      await salvar(url, 'Logo atualizada.');
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setOcupado(false);
      campo.value = '';
    }
  }

  async function salvar(url: string | null, msg: string) {
    const r = await api<{ logoUrl: string | null }>('/admin/identidade/logo', { method: 'PUT', body: JSON.stringify({ url }) });
    setDados((d) => (d ? { ...d, logoUrl: r.logoUrl } : d));
    setSemImagem(false);
    definirLogoDaSessao(r.logoUrl);
    setOk(msg);
  }

  async function remover() {
    setOcupado(true); setErro(null); setOk(null);
    try {
      await salvar(null, 'Logo removida. O menu volta a usar a logo padrão.');
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  const atual = dados?.logoUrl ?? null;
  const exibida = atual ?? LOGO_PADRAO;
  return (
    <>
      <CabecalhoPagina titulo="Identidade" subtitulo="A logo da distribuidora, mostrada no menu da retaguarda." />
      <p className="cad-nota">A logo aparece no rodapé do menu, para todos os usuários desta distribuidora. Use fundo transparente ou branco.</p>
      {erro && <div className="cad-erro" role="alert">{erro}</div>}
      {ok && <div className="cad-ok" role="status">{ok}</div>}
      <Cartao>
        <div className="cad-filtros">
          <label className={`cad-btn cad-cat-foto${ocupado ? ' ocupado' : ''}`} htmlFor="identidade-logo">
            {ocupado ? 'Enviando…' : atual ? 'Trocar logo' : 'Enviar logo'}
            <input id="identidade-logo" type="file" accept="image/png,image/jpeg,image/webp,image/gif" disabled={ocupado || !dados} onChange={enviar} />
          </label>
          {atual && <button type="button" className="cad-btn cad-btn-claro" disabled={ocupado} onClick={remover}>Remover</button>}
        </div>
        <div className="identidade-previa">
          <span className="identidade-rotulo">Como aparece no menu</span>
          <div className="av-cliente-previa">
            {semImagem
              ? <span className="cad-fraco">Sem logo para mostrar.</span>
              : <span className="identidade-chip"><img src={exibida} alt={`Logo de ${dados?.distribuidora ?? 'distribuidora'}`} onError={() => setSemImagem(true)} /></span>}
            <strong>{dados?.distribuidora}</strong>
          </div>
          {!atual && dados && <p className="cad-nota">Nenhuma logo enviada: o menu usa a logo padrão.</p>}
        </div>
      </Cartao>
    </>
  );
}
