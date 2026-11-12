'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { destinoInterno } from '@/lib/sessao/credenciais';
import { useSessao, type ResultadoEntrada } from './SessaoProvider';
import estilos from '@/app/entrar/entrar.module.css';

type Modo = 'entrar' | 'primeiro';

const ESPERA_AVISO_MS = 4000;

function CampoSenha(props: { id: string; rotulo: string; valor: string; aoMudar: (v: string) => void; autoComplete: string; minimo?: number }) {
  const [visivel, setVisivel] = useState(false);
  return (
    <div className={estilos.campo}>
      <label htmlFor={props.id}>{props.rotulo}</label>
      <div className={estilos.senha}>
        <input
          id={props.id}
          type={visivel ? 'text' : 'password'}
          autoComplete={props.autoComplete}
          required
          minLength={props.minimo}
          maxLength={200}
          value={props.valor}
          onChange={(e) => props.aoMudar(e.target.value)}
        />
        <button type="button" className={estilos.mostrar} aria-label="Mostrar senha" aria-pressed={visivel} aria-controls={props.id} onClick={() => setVisivel((v) => !v)}>
          {visivel ? 'Ocultar' : 'Mostrar'}
        </button>
      </div>
    </div>
  );
}

export function FormularioEntrar({ appNome, whatsapp }: { appNome: string; whatsapp: string | null }) {
  const { entrar, primeiroAcesso } = useSessao();
  const router = useRouter();
  const [modo, setModo] = useState<Modo>('entrar');
  const [explicacao, setExplicacao] = useState<string | null>(null);
  const [identificador, setIdentificador] = useState('');
  const [senha, setSenha] = useState('');
  const [codigo, setCodigo] = useState('');
  const [novaSenha, setNovaSenha] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [destinoEmAnalise, setDestinoEmAnalise] = useState<string | null>(null);

  // Cadastro em análise: avisa, mas segue para onde o cliente ia.
  useEffect(() => {
    if (!destinoEmAnalise) return;
    const t = window.setTimeout(() => router.push(destinoEmAnalise), ESPERA_AVISO_MS);
    return () => window.clearTimeout(t);
  }, [destinoEmAnalise, router]);

  const abrirPrimeiroAcesso = (texto: string | null) => {
    setModo('primeiro');
    setExplicacao(texto);
    setErro(null);
    setSenha('');
  };

  const concluir = (r: ResultadoEntrada) => {
    if (!r.ok) {
      if (r.codigo === 'PRIMEIRO_ACESSO_PENDENTE') abrirPrimeiroAcesso(r.mensagem);
      else setErro(r.mensagem);
      return;
    }
    const destino = destinoInterno(new URLSearchParams(window.location.search).get('voltar'));
    if (r.status && r.status !== 'ativo') setDestinoEmAnalise(destino);
    else router.push(destino);
  };

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    if (enviando) return;
    setEnviando(true);
    setErro(null);
    try {
      concluir(modo === 'entrar'
        ? await entrar({ identificador, senha })
        : await primeiroAcesso({ identificador, codigo: codigo.trim(), novaSenha }));
    } finally {
      setEnviando(false);
    }
  };

  if (destinoEmAnalise) {
    return (
      <div className={estilos.formulario}>
        <p className={estilos.aviso} role="status">
          <strong>Seu cadastro está em análise</strong>
          Você já pode ver os preços e montar o carrinho. A distribuidora vai liberar seus pedidos em breve.
        </p>
        <button type="button" className={estilos.primario} onClick={() => router.push(destinoEmAnalise)}>Continuar</button>
      </div>
    );
  }

  return (
    <>
      {modo === 'primeiro' && (
        <p className={estilos.explicacao}>
          {explicacao ?? 'Primeiro acesso ou esqueceu a senha?'} Digite o código que a distribuidora enviou e crie
          uma senha nova. Ela passa a valer aqui e no app {appNome}.
        </p>
      )}
      <form className={estilos.formulario} onSubmit={enviar}>
        <div className={estilos.campo}>
          <label htmlFor="entrar-documento">CNPJ ou CPF</label>
          <input
            id="entrar-documento"
            inputMode="numeric"
            autoComplete="username"
            required
            maxLength={18}
            value={identificador}
            onChange={(e) => setIdentificador(e.target.value)}
          />
        </div>

        {modo === 'entrar' ? (
          <CampoSenha id="entrar-senha" rotulo="Senha" valor={senha} aoMudar={setSenha} autoComplete="current-password" />
        ) : (
          <>
            <div className={estilos.campo}>
              <label htmlFor="entrar-codigo">Código da distribuidora</label>
              <input
                id="entrar-codigo"
                autoComplete="one-time-code"
                required
                minLength={4}
                maxLength={12}
                value={codigo}
                onChange={(e) => setCodigo(e.target.value)}
              />
            </div>
            <CampoSenha id="entrar-nova-senha" rotulo="Nova senha" valor={novaSenha} aoMudar={setNovaSenha} autoComplete="new-password" minimo={6} />
          </>
        )}

        {erro && <p className={estilos.erro} role="alert">{erro}</p>}

        <button type="submit" className={estilos.primario} disabled={enviando}>
          {enviando ? 'Entrando…' : modo === 'entrar' ? 'Entrar' : 'Criar senha e entrar'}
        </button>

        {modo === 'entrar' ? (
          <button type="button" className={estilos.link} onClick={() => abrirPrimeiroAcesso(null)}>
            Primeiro acesso ou esqueci minha senha
          </button>
        ) : (
          <button type="button" className={estilos.link} onClick={() => { setModo('entrar'); setErro(null); setExplicacao(null); }}>
            Voltar para entrar com senha
          </button>
        )}
      </form>

      <div className={estilos.ajuda}>
        <p>Use o mesmo CNPJ/CPF e a mesma senha do app {appNome}.</p>
        <p>
          Ainda não é cliente?{' '}
          {whatsapp ? <a href={whatsapp} target="_blank" rel="noopener noreferrer">Fale com a distribuidora</a> : 'Fale com a distribuidora.'}
        </p>
      </div>
    </>
  );
}
