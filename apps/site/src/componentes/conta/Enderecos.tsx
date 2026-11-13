'use client';

import { useRef, useState, type FormEvent } from 'react';
import type { Endereco } from '@/lib/conta/tipos';
import { formatarCep } from '@/lib/formato/documentos';
import { useDadosConta, useEnviarConta } from './api-conta';
import { Aviso, Carregando, ErroCarga, Vazio } from './Partes';
import estilos from './Conta.module.css';

type Campos = Omit<Endereco, 'id'>;

const VAZIO: Campos = {
  apelido: '', cep: '', logradouro: '', numero: '', complemento: '', bairro: '', cidade: '', uf: '', padrao: false,
};

function Campo(props: {
  id: string; rotulo: string; valor: string; aoMudar: (v: string) => void; largura: string;
  obrigatorio?: boolean; max: number; inputMode?: 'numeric'; autoComplete?: string;
}) {
  return (
    <div className={`${estilos.campo} ${props.largura}`}>
      <label htmlFor={props.id}>{props.rotulo}</label>
      <input
        id={props.id}
        required={props.obrigatorio}
        maxLength={props.max}
        inputMode={props.inputMode}
        autoComplete={props.autoComplete}
        value={props.valor}
        onChange={(e) => props.aoMudar(e.target.value)}
      />
    </div>
  );
}

/** Incluir/editar. CEP com 8 dígitos preenche rua, bairro, cidade e UF (busca pelo servidor do site). */
function FormularioEndereco({ inicial, id, aoSalvar, aoCancelar }: {
  inicial: Campos; id: string | null; aoSalvar: () => void; aoCancelar: () => void;
}) {
  const enviar = useEnviarConta();
  const [c, setC] = useState<Campos>({ ...inicial, apelido: inicial.apelido ?? '', complemento: inicial.complemento ?? '' });
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [avisoCep, setAvisoCep] = useState<string | null>(null);
  const ultimaBusca = useRef('');
  const mudar = (campo: keyof Campos) => (v: string) => setC((x) => ({ ...x, [campo]: v }));

  const aoMudarCep = async (v: string) => {
    setC((x) => ({ ...x, cep: v }));
    const digitos = v.replace(/\D/g, '');
    if (digitos.length !== 8 || digitos === ultimaBusca.current) return;
    ultimaBusca.current = digitos;
    setAvisoCep('Buscando CEP…');
    try {
      const r = await fetch(`/api/conta/cep/${digitos}`, { cache: 'no-store' });
      const j = (await r.json().catch(() => null)) as Partial<Record<'logradouro' | 'bairro' | 'cidade' | 'uf' | 'mensagem', string>> | null;
      if (ultimaBusca.current !== digitos) return;
      if (!r.ok || !j) return setAvisoCep(j?.mensagem ?? 'Não foi possível buscar o CEP. Preencha o endereço à mão.');
      setAvisoCep(null);
      setC((x) => ({
        ...x,
        logradouro: j.logradouro || x.logradouro,
        bairro: j.bairro || x.bairro,
        cidade: j.cidade || x.cidade,
        uf: j.uf || x.uf,
      }));
    } catch {
      setAvisoCep('Não foi possível buscar o CEP. Preencha o endereço à mão.');
    }
  };

  const salvar = async (e: FormEvent) => {
    e.preventDefault();
    if (salvando) return;
    setSalvando(true);
    setErro(null);
    const corpo = { ...c, uf: c.uf.trim().toUpperCase() };
    const r = id ? await enviar(`/api/conta/enderecos/${id}`, 'PUT', corpo) : await enviar('/api/conta/enderecos', 'POST', corpo);
    setSalvando(false);
    if (!r.ok) return setErro(r.mensagem);
    aoSalvar();
  };

  return (
    <form className={`${estilos.cartao} ${estilos.formulario}`} onSubmit={salvar} aria-labelledby="titulo-form-endereco">
      <div className={estilos.acoes}>
        <h2 id="titulo-form-endereco">{id ? 'Editar endereço' : 'Novo endereço'}</h2>
        <button type="submit" className={estilos.primario} disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar endereço'}</button>
        <button type="button" className={estilos.secundario} onClick={aoCancelar} disabled={salvando}>Cancelar</button>
      </div>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <div className={estilos.campos}>
        <Campo id="end-cep" rotulo="CEP" valor={c.cep} aoMudar={aoMudarCep} largura={estilos.terco} obrigatorio max={9} inputMode="numeric" autoComplete="postal-code" />
        <div className={`${estilos.campo} ${estilos.metade}`} aria-live="polite">
          {avisoCep && <span className={estilos.dica} style={{ marginTop: 34 }}>{avisoCep}</span>}
        </div>
        <Campo id="end-logradouro" rotulo="Rua / Avenida" valor={c.logradouro} aoMudar={mudar('logradouro')} largura="" obrigatorio max={120} autoComplete="address-line1" />
        <Campo id="end-numero" rotulo="Número" valor={c.numero} aoMudar={mudar('numero')} largura={estilos.terco} obrigatorio max={20} />
        <Campo id="end-complemento" rotulo="Complemento (opcional)" valor={c.complemento ?? ''} aoMudar={mudar('complemento')} largura={estilos.metade} max={80} />
        <Campo id="end-bairro" rotulo="Bairro" valor={c.bairro} aoMudar={mudar('bairro')} largura={estilos.metade} obrigatorio max={80} />
        <Campo id="end-cidade" rotulo="Cidade" valor={c.cidade} aoMudar={mudar('cidade')} largura={estilos.terco} obrigatorio max={80} />
        <Campo id="end-uf" rotulo="UF" valor={c.uf} aoMudar={(v) => setC((x) => ({ ...x, uf: v.toUpperCase() }))} largura={estilos.sexto} obrigatorio max={2} />
        <Campo id="end-apelido" rotulo="Apelido (opcional)" valor={c.apelido ?? ''} aoMudar={mudar('apelido')} largura={estilos.metade} max={40} />
        <label className={`${estilos.campo} ${estilos.marcar}`}>
          <input type="checkbox" checked={c.padrao} onChange={(e) => setC((x) => ({ ...x, padrao: e.target.checked }))} />
          Endereço padrão
        </label>
      </div>
    </form>
  );
}

export function Enderecos() {
  const carga = useDadosConta<Endereco[]>('/api/conta/enderecos');
  const enviar = useEnviarConta();
  const [editando, setEditando] = useState<Endereco | 'novo' | null>(null);
  const [confirmando, setConfirmando] = useState<string | null>(null);
  const [excluindo, setExcluindo] = useState(false);
  const [mensagem, setMensagem] = useState<{ tipo: 'erro' | 'sucesso'; texto: string } | null>(null);

  const salvo = () => {
    setEditando(null);
    setMensagem({ tipo: 'sucesso', texto: 'Endereço salvo.' });
    carga.recarregar();
  };

  const excluir = async (id: string) => {
    setExcluindo(true);
    setMensagem(null);
    const r = await enviar(`/api/conta/enderecos/${id}`, 'DELETE');
    setExcluindo(false);
    setConfirmando(null);
    if (!r.ok) return setMensagem({ tipo: 'erro', texto: r.mensagem });
    setMensagem({ tipo: 'sucesso', texto: 'Endereço excluído.' });
    carga.recarregar();
  };

  const lista = carga.dados;
  return (
    <>
      <h1>Endereços</h1>
      {!editando && (
        <div className={estilos.acoes}>
          <button type="button" className={estilos.primario} onClick={() => { setMensagem(null); setEditando('novo'); }}>Novo endereço</button>
        </div>
      )}
      {mensagem && <Aviso tipo={mensagem.tipo}>{mensagem.texto}</Aviso>}
      {editando && (
        <FormularioEndereco
          key={editando === 'novo' ? 'novo' : editando.id}
          id={editando === 'novo' ? null : editando.id}
          inicial={editando === 'novo' ? VAZIO : editando}
          aoSalvar={salvo}
          aoCancelar={() => setEditando(null)}
        />
      )}
      {carga.fase === 'erro' ? (
        <ErroCarga mensagem={carga.erro} aoTentar={carga.recarregar} />
      ) : !lista ? (
        <Carregando />
      ) : lista.length === 0 ? (
        <Vazio titulo="Nenhum endereço">
          <p>Cadastre onde a distribuidora deve entregar.</p>
        </Vazio>
      ) : (
        <ul className={estilos.listaEnderecos} aria-label="Seus endereços">
          {lista.map((e) => (
            <li key={e.id} className={estilos.cartao}>
              <div className={estilos.topoCartao}>
                <strong>{e.apelido ?? `${e.logradouro}, ${e.numero}`}</strong>
                {e.padrao && <span className={`${estilos.etiqueta} ${estilos.tomAndamento}`}>Padrão</span>}
              </div>
              <div className={estilos.acoes}>
                {confirmando === e.id ? (
                  <>
                    <button type="button" className={`${estilos.perigoso} ${estilos.pequeno}`} disabled={excluindo} onClick={() => excluir(e.id)}>
                      {excluindo ? 'Excluindo…' : 'Confirmar exclusão'}
                    </button>
                    <button type="button" className={`${estilos.secundario} ${estilos.pequeno}`} disabled={excluindo} onClick={() => setConfirmando(null)}>Manter</button>
                  </>
                ) : (
                  <>
                    <button type="button" className={`${estilos.secundario} ${estilos.pequeno}`} onClick={() => { setMensagem(null); setEditando(e); }}>Editar</button>
                    <button type="button" className={`${estilos.secundario} ${estilos.pequeno}`} onClick={() => { setMensagem(null); setConfirmando(e.id); }}>Excluir</button>
                  </>
                )}
              </div>
              <p>{e.logradouro}, {e.numero}{e.complemento && ` — ${e.complemento}`}</p>
              <p className={estilos.suave}>{e.bairro} · {e.cidade}/{e.uf} · CEP {formatarCep(e.cep)}</p>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
