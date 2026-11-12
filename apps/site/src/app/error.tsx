'use client';

import estilos from './estados.module.css';

export default function Erro({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className={`conteudo ${estilos.estado}`} role="alert">
      <h1>Não foi possível carregar</h1>
      <p>O servidor não respondeu agora. Seu carrinho continua salvo. Tente de novo em instantes.</p>
      <div className={estilos.acoes}>
        <button type="button" className={estilos.botao} onClick={reset}>Tentar novamente</button>
      </div>
    </div>
  );
}
