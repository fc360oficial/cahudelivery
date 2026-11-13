'use client';

import { useState } from 'react';
import type { Credito } from '@/lib/conta/tipos';
import { useDadosConta, useEnviarConta } from './api-conta';
import { Aviso, Carregando, ErroCarga } from './Partes';
import estilos from './Conta.module.css';

/** Mesmos textos da tela Crédito do app: a API só diz se há análise pendente. */
export function CreditoConta() {
  const carga = useDadosConta<Credito>('/api/conta/credito');
  const enviar = useEnviarConta();
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const solicitar = async () => {
    setEnviando(true);
    setErro(null);
    const r = await enviar<Credito>('/api/conta/credito/solicitar', 'POST');
    setEnviando(false);
    if (r.ok) carga.definir(r.dados);
    else setErro(r.mensagem);
  };

  return (
    <>
      <h1>Crédito</h1>
      {carga.fase === 'erro' ? (
        <ErroCarga mensagem={carga.erro} aoTentar={carga.recarregar} />
      ) : !carga.dados ? (
        <Carregando />
      ) : (
        <section className={estilos.cartao} aria-labelledby="titulo-credito">
          <h2 id="titulo-credito">
            {carga.dados.pendente ? 'Sua solicitação está em análise' : 'Crédito para boleto a prazo indisponível'}
          </h2>
          <p className={estilos.suave}>
            {carga.dados.pendente
              ? 'A distribuidora vai avaliar seu cadastro em breve.'
              : 'No momento não conseguimos conceder crédito para esta conta. Solicite uma nova análise para reavaliarmos seu acesso.'}
          </p>
          {!carga.dados.pendente && (
            <div className={estilos.acoes}>
              <button type="button" className={estilos.primario} onClick={solicitar} disabled={enviando}>
                {enviando ? 'Enviando…' : 'Solicitar análise de crédito'}
              </button>
            </div>
          )}
          {erro && <Aviso tipo="erro">{erro}</Aviso>}
        </section>
      )}
    </>
  );
}
