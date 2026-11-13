'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { cadastroEmAnalise } from '@/lib/conta/status';
import { mascararCep, mascararDocumento, mascararTelefone, type TipoDocumento } from '@/lib/cadastro/documento';
import {
  CAMPO_ARMADILHA, CAMPOS_EM_ORDEM, CATEGORIAS, MAXIMO_SENHA, REGRA_SENHA, validarCadastro,
  type CampoCadastro, type ErrosCadastro,
} from '@/lib/cadastro/validar-cadastro';
import { useSessao } from './SessaoProvider';
import estilos from '@/app/cadastrar/cadastrar.module.css';

/** Tudo o que o formulário guarda. Só no estado do componente: nada vai para localStorage/sessionStorage. */
interface Valores {
  tipo: TipoDocumento;
  documento: string;
  nomeFantasia: string;
  razaoSocial: string;
  inscricaoEstadual: string;
  isentoIe: boolean;
  email: string;
  telefone: string;
  categoria: string;
  cep: string;
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  uf: string;
  senha: string;
  confirmacao: string;
  codigoIndicacao: string;
  armadilha: string;
}

const INICIAL: Valores = {
  tipo: 'CNPJ', documento: '', nomeFantasia: '', razaoSocial: '', inscricaoEstadual: '', isentoIe: false, email: '',
  telefone: '', categoria: '', cep: '', logradouro: '', numero: '', complemento: '', bairro: '', cidade: '', uf: '',
  senha: '', confirmacao: '', codigoIndicacao: '', armadilha: '',
};

const ROTULOS: Record<CampoCadastro, string> = {
  tipo: 'Tipo de cadastro', documento: 'Documento', nomeFantasia: 'Nome', razaoSocial: 'Razão social',
  inscricaoEstadual: 'Inscrição Estadual', email: 'E-mail', telefone: 'Telefone / WhatsApp', categoria: 'Categoria',
  cep: 'CEP', logradouro: 'Rua / Avenida', numero: 'Número', complemento: 'Complemento', bairro: 'Bairro',
  cidade: 'Cidade', uf: 'UF', senha: 'Senha', confirmacao: 'Confirmar senha', codigoIndicacao: 'Código de indicação',
};

const idDoCampo = (campo: CampoCadastro) => (campo === 'tipo' ? 'cad-tipo-CNPJ' : `cad-${campo}`);
const CODIGOS_JA_CLIENTE = ['CLIENTE_JA_EXISTE', 'CLIENTE_JA_EXISTE_PRIMEIRO_ACESSO'];

export interface PropsCadastro {
  appNome: string;
  whatsapp: string | null;
  horario: string[];
  temPolitica: boolean;
  indicacoesAtivas: boolean;
}

/** Campo de texto com rótulo, ajuda e erro ligados por aria-describedby. */
function Campo(props: {
  campo: CampoCadastro; rotulo: string; valor: string; aoMudar: (v: string) => void; erro?: string; ajuda?: ReactNode;
  largura: string; autoComplete: string; max: number; inputMode?: 'numeric' | 'tel' | 'email'; type?: string;
  desabilitado?: boolean; obrigatorio?: boolean;
}) {
  const id = idDoCampo(props.campo);
  const descricoes = [props.ajuda ? `${id}-ajuda` : '', props.erro ? `${id}-erro` : ''].filter(Boolean).join(' ');
  return (
    <div className={`${estilos.campo} ${props.largura}`}>
      <label htmlFor={id}>{props.rotulo}</label>
      <input
        id={id}
        name={props.campo}
        type={props.type ?? 'text'}
        inputMode={props.inputMode}
        autoComplete={props.autoComplete}
        maxLength={props.max}
        aria-required={props.obrigatorio || undefined}
        aria-invalid={props.erro ? true : undefined}
        aria-describedby={descricoes || undefined}
        disabled={props.desabilitado}
        value={props.valor}
        onChange={(e) => props.aoMudar(e.target.value)}
      />
      {props.ajuda && <p id={`${id}-ajuda`} className={estilos.ajuda}>{props.ajuda}</p>}
      {props.erro && <p id={`${id}-erro`} className={estilos.erroCampo}>{props.erro}</p>}
    </div>
  );
}

function CampoSenha(props: {
  campo: 'senha' | 'confirmacao'; rotulo: string; rotuloMostrar: string; valor: string; aoMudar: (v: string) => void;
  erro?: string; ajuda?: string; largura: string;
}) {
  const [visivel, setVisivel] = useState(false);
  const id = idDoCampo(props.campo);
  const descricoes = [props.ajuda ? `${id}-ajuda` : '', props.erro ? `${id}-erro` : ''].filter(Boolean).join(' ');
  return (
    <div className={`${estilos.campo} ${props.largura}`}>
      <label htmlFor={id}>{props.rotulo}</label>
      <div className={estilos.senha}>
        <input
          id={id}
          name={props.campo}
          type={visivel ? 'text' : 'password'}
          autoComplete="new-password"
          maxLength={MAXIMO_SENHA}
          aria-required
          aria-invalid={props.erro ? true : undefined}
          aria-describedby={descricoes || undefined}
          value={props.valor}
          onChange={(e) => props.aoMudar(e.target.value)}
        />
        <button type="button" className={estilos.mostrar} aria-label={props.rotuloMostrar} aria-pressed={visivel} aria-controls={id} onClick={() => setVisivel((v) => !v)}>
          {visivel ? 'Ocultar' : 'Mostrar'}
        </button>
      </div>
      {props.ajuda && <p id={`${id}-ajuda`} className={estilos.ajuda}>{props.ajuda}</p>}
      {props.erro && <p id={`${id}-erro`} className={estilos.erroCampo}>{props.erro}</p>}
    </div>
  );
}

/**
 * Cadastro de cliente novo: mesmos campos, ordem, textos e regras da tela de cadastro do app
 * (cadastro_screen.dart). A validação é a mesma do servidor do site (validarCadastro); quem decide
 * é a API. Depois do cadastro o cliente já está logado, com o cadastro em análise.
 */
export function FormularioCadastro({ appNome, whatsapp, horario, temPolitica, indicacoesAtivas }: PropsCadastro) {
  const { cadastrar } = useSessao();
  const [v, setV] = useState<Valores>(INICIAL);
  const [codigoMunicipio, setCodigoMunicipio] = useState<string | null>(null);
  const [erros, setErros] = useState<ErrosCadastro>({});
  const [erroGeral, setErroGeral] = useState<{ mensagem: string; codigo?: string } | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [avisoCep, setAvisoCep] = useState<string | null>(null);
  const [concluido, setConcluido] = useState<{ status: string | null } | null>(null);
  const ultimaBusca = useRef('');
  const resumo = useRef<HTMLDivElement>(null);
  const tituloSucesso = useRef<HTMLHeadingElement>(null);
  const travado = useRef(false);
  const ehCnpj = v.tipo === 'CNPJ';

  useEffect(() => {
    if (concluido) tituloSucesso.current?.focus();
  }, [concluido]);

  const mudar = <K extends keyof Valores>(campo: K) => (valor: Valores[K]) => setV((x) => ({ ...x, [campo]: valor }));

  const escolherTipo = (tipo: TipoDocumento) => setV((x) => ({
    ...x,
    tipo,
    documento: mascararDocumento(tipo, x.documento),
    // CPF não tem IE (como o app: limpa para não mandar IE de pessoa física).
    ...(tipo === 'CPF' ? { inscricaoEstadual: '', isentoIe: false, razaoSocial: '' } : {}),
  }));

  const aoMudarCep = async (texto: string) => {
    const cep = mascararCep(texto);
    setV((x) => ({ ...x, cep }));
    setCodigoMunicipio(null);
    const digitos = cep.replace(/\D/g, '');
    if (digitos.length !== 8) {
      ultimaBusca.current = '';
      return;
    }
    if (digitos === ultimaBusca.current) return;
    ultimaBusca.current = digitos;
    setAvisoCep('Buscando CEP…');
    try {
      const r = await fetch(`/api/cep/${digitos}`, { cache: 'no-store' });
      const j = (await r.json().catch(() => null)) as Partial<Record<'logradouro' | 'bairro' | 'cidade' | 'uf' | 'codigoMunicipio' | 'mensagem', string | null>> | null;
      if (ultimaBusca.current !== digitos) return;
      if (!r.ok || !j) {
        setAvisoCep(j?.mensagem ?? 'Não foi possível buscar o CEP. Preencha o endereço à mão.');
        return;
      }
      setAvisoCep(null);
      setCodigoMunicipio(typeof j.codigoMunicipio === 'string' ? j.codigoMunicipio : null);
      setV((x) => ({
        ...x,
        logradouro: j.logradouro || x.logradouro,
        bairro: j.bairro || x.bairro,
        cidade: j.cidade || x.cidade,
        uf: j.uf || x.uf,
      }));
    } catch {
      if (ultimaBusca.current === digitos) setAvisoCep('Não foi possível buscar o CEP. Preencha o endereço à mão.');
    }
  };

  const focarPrimeiroErro = (e: ErrosCadastro) => {
    const primeiro = CAMPOS_EM_ORDEM.find((c) => e[c]);
    if (primeiro) document.getElementById(idDoCampo(primeiro))?.focus();
  };

  const montarCorpo = () => ({
    tipo: v.tipo,
    documento: v.documento,
    nomeFantasia: v.nomeFantasia,
    razaoSocial: ehCnpj ? v.razaoSocial : '',
    inscricaoEstadual: ehCnpj && !v.isentoIe ? v.inscricaoEstadual : '',
    isentoIe: ehCnpj && v.isentoIe,
    email: v.email,
    telefone: v.telefone,
    categoria: v.categoria,
    endereco: {
      cep: v.cep, logradouro: v.logradouro, numero: v.numero, complemento: v.complemento, bairro: v.bairro,
      cidade: v.cidade, uf: v.uf, ...(codigoMunicipio ? { codigoMunicipio } : {}),
    },
    senha: v.senha,
    codigoIndicacao: indicacoesAtivas ? v.codigoIndicacao : '',
    [CAMPO_ARMADILHA]: v.armadilha,
  });

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    if (travado.current) return;
    const corpo = montarCorpo();
    const validacao = validarCadastro(corpo);
    const novos: ErrosCadastro = validacao.ok ? {} : { ...validacao.erros };
    if (!novos.senha && v.senha !== v.confirmacao) novos.confirmacao = 'As senhas não conferem';
    setErroGeral(null);
    setErros(novos);
    if (Object.keys(novos).length > 0) {
      focarPrimeiroErro(novos);
      return;
    }

    travado.current = true;
    setEnviando(true);
    try {
      const r = await cadastrar(corpo);
      if (r.ok) {
        setV((x) => ({ ...x, senha: '', confirmacao: '' }));
        setConcluido({ status: r.status });
        return;
      }
      // Erro: os dados continuam na tela, menos as senhas.
      setV((x) => ({ ...x, senha: '', confirmacao: '' }));
      if (r.erros && Object.keys(r.erros).length > 0) {
        const doServidor = r.erros as ErrosCadastro;
        setErros(doServidor);
        focarPrimeiroErro(doServidor);
        return;
      }
      setErroGeral({ mensagem: r.mensagem, codigo: r.codigo });
      window.setTimeout(() => resumo.current?.focus(), 0);
    } finally {
      travado.current = false;
      setEnviando(false);
    }
  };

  if (concluido) {
    const emAnalise = cadastroEmAnalise(concluido.status) || concluido.status === null;
    return (
      <div className={estilos.sucesso}>
        <h1 ref={tituloSucesso} tabIndex={-1}>{emAnalise ? 'Cadastro enviado' : 'Conta criada'}</h1>
        <p className={estilos.aviso} role="status">
          {emAnalise ? (
            <>
              <strong>A distribuidora vai analisar e liberar suas compras.</strong>
              Você já pode ver os preços e montar o carrinho. Para agilizar a aprovação, fale com a distribuidora.
            </>
          ) : (
            <>Você já pode fazer pedidos pelo site e pelo app {appNome}.</>
          )}
        </p>
        {(horario.length > 0 || whatsapp) && (
          <ul className={estilos.contato}>
            {horario.map((h) => <li key={h}>{h}</li>)}
            {whatsapp && (
              <li><a href={whatsapp} target="_blank" rel="noopener noreferrer">Falar com a distribuidora no WhatsApp</a></li>
            )}
          </ul>
        )}
        <div className={estilos.acoes}>
          <Link href="/" className={estilos.primario}>Continuar comprando</Link>
          <Link href="/conta" className={estilos.secundario}>Minha conta</Link>
        </div>
      </div>
    );
  }

  const listaErros = CAMPOS_EM_ORDEM.filter((c) => erros[c]);
  const jaCliente = erroGeral?.codigo && CODIGOS_JA_CLIENTE.includes(erroGeral.codigo);

  return (
    <>
      <h1>Criar conta</h1>
      <p className={estilos.introducao}>
        Já é cliente? <Link href="/entrar">Entre com seu CNPJ ou CPF</Link>. A mesma conta vale no app {appNome}.
      </p>

      <div ref={resumo} tabIndex={-1} role="alert" className={listaErros.length > 0 || erroGeral ? estilos.resumo : undefined}>
        {erroGeral && (
          <>
            <p>{erroGeral.mensagem}</p>
            {jaCliente && (
              <div className={estilos.resumoAcoes}>
                <Link href="/entrar">Entrar</Link>
                <Link href="/entrar?acesso=primeiro">Primeiro acesso ou esqueci minha senha</Link>
              </div>
            )}
          </>
        )}
        {listaErros.length > 0 && (
          <>
            <p>{listaErros.length === 1 ? 'Confira 1 campo:' : `Confira ${listaErros.length} campos:`}</p>
            <ul>
              {listaErros.map((c) => (
                <li key={c}><a href={`#${idDoCampo(c)}`}>{c === 'documento' ? v.tipo : ROTULOS[c]}: {erros[c]}</a></li>
              ))}
            </ul>
          </>
        )}
      </div>

      <form className={estilos.formulario} method="post" noValidate onSubmit={enviar}>
        <fieldset className={estilos.bloco}>
          <legend>Sua empresa</legend>
          <div className={estilos.grade}>
            <div className={`${estilos.campo} ${estilos.inteiro}`} role="radiogroup" aria-label="Tipo de cadastro">
              <div className={estilos.tipos}>
                {(['CNPJ', 'CPF'] as const).map((t) => (
                  <label key={t} className={estilos.tipo}>
                    <input id={`cad-tipo-${t}`} type="radio" name="tipo" value={t} checked={v.tipo === t} onChange={() => escolherTipo(t)} />
                    {t === 'CNPJ' ? 'Empresa (CNPJ)' : 'Pessoa física (CPF)'}
                  </label>
                ))}
              </div>
              {erros.tipo && <p className={estilos.erroCampo}>{erros.tipo}</p>}
            </div>
            <Campo
              campo="documento" rotulo={ehCnpj ? 'CNPJ' : 'CPF'} valor={v.documento} erro={erros.documento} largura={estilos.metade}
              aoMudar={(t) => mudar('documento')(mascararDocumento(v.tipo, t))} autoComplete="username" inputMode="numeric"
              max={ehCnpj ? 18 : 14} obrigatorio
            />
            <Campo
              campo="nomeFantasia" rotulo={ehCnpj ? 'Nome fantasia' : 'Nome do negócio'} valor={v.nomeFantasia} erro={erros.nomeFantasia}
              largura={estilos.metade} aoMudar={mudar('nomeFantasia')} autoComplete="organization" max={120} obrigatorio
            />
            {ehCnpj && (
              <>
                <Campo
                  campo="razaoSocial" rotulo="Razão social (opcional)" valor={v.razaoSocial} erro={erros.razaoSocial}
                  largura={estilos.inteiro} aoMudar={mudar('razaoSocial')} autoComplete="off" max={150}
                />
                <Campo
                  campo="inscricaoEstadual" rotulo="Inscrição Estadual" valor={v.inscricaoEstadual} erro={erros.inscricaoEstadual}
                  largura={estilos.metade} aoMudar={mudar('inscricaoEstadual')} autoComplete="off" inputMode="numeric" max={30}
                  desabilitado={v.isentoIe} obrigatorio={!v.isentoIe}
                />
                <div className={`${estilos.campo} ${estilos.metade}`} style={{ justifyContent: 'flex-end' }}>
                  <label className={estilos.marcar} style={{ minHeight: 50 }}>
                    <input
                      id="cad-isentoIe" type="checkbox" checked={v.isentoIe}
                      onChange={(e) => setV((x) => ({ ...x, isentoIe: e.target.checked, inscricaoEstadual: e.target.checked ? '' : x.inscricaoEstadual }))}
                    />
                    Isento de Inscrição Estadual
                  </label>
                </div>
              </>
            )}
            <Campo
              campo="email" rotulo="E-mail (opcional)" valor={v.email} erro={erros.email} largura={estilos.metade}
              aoMudar={mudar('email')} autoComplete="email" inputMode="email" type="email" max={254}
            />
            <Campo
              campo="telefone" rotulo="Telefone / WhatsApp" valor={v.telefone} erro={erros.telefone} largura={estilos.metade}
              aoMudar={(t) => mudar('telefone')(mascararTelefone(t))} autoComplete="tel" inputMode="tel" type="tel" max={15} obrigatorio
            />
            <div className={`${estilos.campo} ${estilos.inteiro}`}>
              <label htmlFor="cad-categoria">Categoria do estabelecimento (opcional)</label>
              <select
                id="cad-categoria" name="categoria" autoComplete="off" value={v.categoria}
                aria-invalid={erros.categoria ? true : undefined} aria-describedby={erros.categoria ? 'cad-categoria-erro' : undefined}
                onChange={(e) => mudar('categoria')(e.target.value)}
              >
                <option value="">Não informar</option>
                {CATEGORIAS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              {erros.categoria && <p id="cad-categoria-erro" className={estilos.erroCampo}>{erros.categoria}</p>}
            </div>
          </div>
        </fieldset>

        <fieldset className={estilos.bloco}>
          <legend>Endereço</legend>
          <div className={estilos.grade}>
            <Campo
              campo="cep" rotulo="CEP" valor={v.cep} erro={erros.cep} largura={estilos.terco} aoMudar={aoMudarCep}
              autoComplete="postal-code" inputMode="numeric" max={9} obrigatorio
              ajuda={<span aria-live="polite">{avisoCep ?? 'Preenchemos a rua, o bairro e a cidade pelo CEP.'}</span>}
            />
            <Campo
              campo="logradouro" rotulo="Rua / Avenida" valor={v.logradouro} erro={erros.logradouro} largura={estilos.doisTercos}
              aoMudar={mudar('logradouro')} autoComplete="address-line1" max={120} obrigatorio
            />
            <Campo
              campo="numero" rotulo="Número" valor={v.numero} erro={erros.numero} largura={estilos.terco}
              aoMudar={mudar('numero')} autoComplete="off" max={20} obrigatorio
            />
            <Campo
              campo="complemento" rotulo="Complemento (opcional)" valor={v.complemento} erro={erros.complemento}
              largura={estilos.doisTercos} aoMudar={mudar('complemento')} autoComplete="address-line2" max={80}
            />
            <Campo
              campo="bairro" rotulo="Bairro" valor={v.bairro} erro={erros.bairro} largura={estilos.metade}
              aoMudar={mudar('bairro')} autoComplete="address-level3" max={80} obrigatorio
            />
            <Campo
              campo="cidade" rotulo="Cidade" valor={v.cidade} erro={erros.cidade} largura={estilos.terco}
              aoMudar={mudar('cidade')} autoComplete="address-level2" max={80} obrigatorio
            />
            <Campo
              campo="uf" rotulo="UF" valor={v.uf} erro={erros.uf} largura={estilos.sexto}
              aoMudar={(t) => mudar('uf')(t.toUpperCase())} autoComplete="address-level1" max={2} obrigatorio
            />
          </div>
        </fieldset>

        <fieldset className={estilos.bloco}>
          <legend>Acesso</legend>
          <div className={estilos.grade}>
            <CampoSenha
              campo="senha" rotulo="Senha" rotuloMostrar="Mostrar senha" valor={v.senha} aoMudar={mudar('senha')}
              erro={erros.senha} ajuda={REGRA_SENHA} largura={estilos.metade}
            />
            <CampoSenha
              campo="confirmacao" rotulo="Confirmar senha" rotuloMostrar="Mostrar confirmação da senha" valor={v.confirmacao}
              aoMudar={mudar('confirmacao')} erro={erros.confirmacao} largura={estilos.metade}
            />
            {indicacoesAtivas && (
              <Campo
                campo="codigoIndicacao" rotulo="Código de indicação (opcional)" valor={v.codigoIndicacao} erro={erros.codigoIndicacao}
                largura={estilos.metade} aoMudar={(t) => mudar('codigoIndicacao')(t.toUpperCase())} autoComplete="off" max={20}
              />
            )}
          </div>
          <div className={estilos.armadilha} aria-hidden="true">
            <label htmlFor="cad-armadilha">Deixe este campo em branco</label>
            <input
              id="cad-armadilha" name={CAMPO_ARMADILHA} type="text" tabIndex={-1} autoComplete="off"
              value={v.armadilha} onChange={(e) => mudar('armadilha')(e.target.value)}
            />
          </div>
        </fieldset>

        {temPolitica && (
          <p className={estilos.aceite}>
            Ao criar a conta você declara que leu a <Link href="/privacidade" target="_blank">Política de privacidade</Link>.
          </p>
        )}
        <div className={estilos.acoes}>
          <button type="submit" className={estilos.primario} disabled={enviando}>
            {enviando ? 'Enviando…' : 'Criar conta'}
          </button>
        </div>
      </form>
    </>
  );
}
