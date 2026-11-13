'use client';

import { useState, type FormEvent } from 'react';
import { useSessao } from '@/componentes/SessaoProvider';
import { situacaoCadastro } from '@/lib/conta/status';
import type { Perfil } from '@/lib/conta/tipos';
import { formatarDocumento, formatarTelefone } from '@/lib/formato/documentos';
import { useDadosConta, useEnviarConta } from './api-conta';
import { Aviso, Carregando, ErroCarga, Etiqueta } from './Partes';
import estilos from './Conta.module.css';

function FormularioPerfil({ perfil, aoSalvar }: { perfil: Perfil; aoSalvar: (p: Perfil) => void }) {
  const enviar = useEnviarConta();
  const { recarregar: recarregarSessao } = useSessao();
  const [nomeFantasia, setNomeFantasia] = useState(perfil.nomeFantasia);
  const [telefone, setTelefone] = useState(perfil.telefone ? formatarTelefone(perfil.telefone) : '');
  const [salvando, setSalvando] = useState(false);
  const [resultado, setResultado] = useState<{ tipo: 'erro' | 'sucesso'; texto: string } | null>(null);

  const salvar = async (e: FormEvent) => {
    e.preventDefault();
    if (salvando) return;
    setSalvando(true);
    setResultado(null);
    const r = await enviar<Perfil>('/api/conta/perfil', 'PUT', { nomeFantasia, telefone });
    setSalvando(false);
    if (!r.ok) return setResultado({ tipo: 'erro', texto: r.mensagem });
    aoSalvar(r.dados);
    setResultado({ tipo: 'sucesso', texto: 'Dados salvos.' });
    void recarregarSessao(); // o "Olá, <nome>" do cabeçalho
  };

  return (
    <form className={estilos.formulario} onSubmit={salvar} aria-labelledby="titulo-editar">
      <div className={estilos.acoes}>
        <h2 id="titulo-editar">Alterar dados</h2>
        <button type="submit" className={estilos.primario} disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</button>
      </div>
      {resultado && <Aviso tipo={resultado.tipo}>{resultado.texto}</Aviso>}
      <div className={estilos.campos}>
        <div className={`${estilos.campo} ${estilos.metade}`}>
          <label htmlFor="dados-nome">Nome fantasia</label>
          <input id="dados-nome" required minLength={2} maxLength={120} value={nomeFantasia} onChange={(e) => setNomeFantasia(e.target.value)} />
        </div>
        <div className={`${estilos.campo} ${estilos.metade}`}>
          <label htmlFor="dados-telefone">Telefone / WhatsApp</label>
          <input id="dados-telefone" type="tel" inputMode="tel" autoComplete="tel" required maxLength={20} value={telefone} onChange={(e) => setTelefone(e.target.value)} />
        </div>
      </div>
      <p className={estilos.dica}>Para alterar documento, razão social ou e-mail, fale com a distribuidora.</p>
    </form>
  );
}

function CampoSenha({ id, rotulo, valor, aoMudar, autoComplete, minimo }: { id: string; rotulo: string; valor: string; aoMudar: (v: string) => void; autoComplete: string; minimo?: number }) {
  return (
    <div className={`${estilos.campo} ${estilos.terco}`}>
      <label htmlFor={id}>{rotulo}</label>
      <input id={id} type="password" autoComplete={autoComplete} required minLength={minimo} maxLength={200} value={valor} onChange={(e) => aoMudar(e.target.value)} />
    </div>
  );
}

function TrocarSenha({ appNome }: { appNome: string }) {
  const enviar = useEnviarConta();
  const [senhaAtual, setSenhaAtual] = useState('');
  const [novaSenha, setNovaSenha] = useState('');
  const [confirmacao, setConfirmacao] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<{ tipo: 'erro' | 'sucesso'; texto: string } | null>(null);

  const trocar = async (e: FormEvent) => {
    e.preventDefault();
    if (enviando) return;
    if (novaSenha !== confirmacao) return setResultado({ tipo: 'erro', texto: 'A confirmação não é igual à nova senha.' });
    if (novaSenha === senhaAtual) return setResultado({ tipo: 'erro', texto: 'A nova senha precisa ser diferente da atual.' });
    setEnviando(true);
    setResultado(null);
    const r = await enviar('/api/conta/senha', 'POST', { senhaAtual, novaSenha });
    setEnviando(false);
    if (!r.ok) return setResultado({ tipo: 'erro', texto: r.mensagem });
    setSenhaAtual('');
    setNovaSenha('');
    setConfirmacao('');
    setResultado({ tipo: 'sucesso', texto: `Senha alterada. Use a nova senha aqui e no app ${appNome}.` });
  };

  return (
    <form className={`${estilos.cartao} ${estilos.formulario}`} onSubmit={trocar} aria-labelledby="titulo-senha">
      <div className={estilos.acoes}>
        <h2 id="titulo-senha">Trocar senha</h2>
        <button type="submit" className={estilos.primario} disabled={enviando}>{enviando ? 'Trocando…' : 'Trocar senha'}</button>
      </div>
      {resultado && <Aviso tipo={resultado.tipo}>{resultado.texto}</Aviso>}
      <div className={estilos.campos}>
        <CampoSenha id="senha-atual" rotulo="Senha atual" valor={senhaAtual} aoMudar={setSenhaAtual} autoComplete="current-password" />
        <CampoSenha id="senha-nova" rotulo="Nova senha" valor={novaSenha} aoMudar={setNovaSenha} autoComplete="new-password" minimo={6} />
        <CampoSenha id="senha-confirmacao" rotulo="Confirme a nova senha" valor={confirmacao} aoMudar={setConfirmacao} autoComplete="new-password" minimo={6} />
      </div>
      <p className={estilos.dica}>Mínimo de 6 caracteres. A senha vale aqui e no app {appNome}.</p>
    </form>
  );
}

export function DadosCadastrais({ appNome }: { appNome: string }) {
  const carga = useDadosConta<Perfil>('/api/conta/perfil');

  return (
    <>
      <h1>Dados cadastrais</h1>
      {carga.fase === 'erro' ? (
        <ErroCarga mensagem={carga.erro} aoTentar={carga.recarregar} />
      ) : !carga.dados ? (
        <Carregando />
      ) : (
        <>
          <section className={estilos.cartao} aria-labelledby="titulo-cadastro">
            <div className={estilos.topoCartao}>
              <h2 id="titulo-cadastro">Cadastro</h2>
              <Etiqueta rotulo={situacaoCadastro(carga.dados.status)} />
            </div>
            <dl className={estilos.dados}>
              <dt>Razão social</dt><dd>{carga.dados.razaoSocial ?? '—'}</dd>
              <dt>Nome fantasia</dt><dd>{carga.dados.nomeFantasia || '—'}</dd>
              <dt>{carga.dados.tipo ?? 'CNPJ/CPF'}</dt><dd>{formatarDocumento(carga.dados.documento)}</dd>
              <dt>E-mail</dt><dd>{carga.dados.email ?? '—'}</dd>
              <dt>Telefone</dt><dd>{formatarTelefone(carga.dados.telefone)}</dd>
              <dt>Situação do cadastro</dt><dd>{situacaoCadastro(carga.dados.status).rotulo}</dd>
            </dl>
          </section>
          <section className={estilos.cartao}>
            <FormularioPerfil perfil={carga.dados} aoSalvar={carga.definir} />
          </section>
          <TrocarSenha appNome={appNome} />
        </>
      )}
    </>
  );
}
