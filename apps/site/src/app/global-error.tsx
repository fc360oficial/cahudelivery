'use client';

import '@/estilos/tokens.css';

/** Erro no layout raiz (ex.: API fora do ar com o cache frio). Não pode contar com layout, fontes ou módulos CSS. */
export default function ErroGlobal({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="pt-BR">
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif', color: '#141414', background: '#ffffff' }}>
        <div role="alert" style={{ maxWidth: 720, margin: '0 auto', padding: '96px 24px', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 16 }}>
          <h1 style={{ fontSize: 40, margin: 0 }}>Não foi possível carregar</h1>
          <p style={{ margin: 0, color: '#5f5f5a', fontSize: 17, maxWidth: 520 }}>
            O servidor não respondeu agora. Seu carrinho continua salvo. Tente de novo em instantes.
          </p>
          <button type="button" onClick={reset}
            style={{ height: 52, padding: '0 28px', border: 0, borderRadius: 999, background: '#141414', color: '#ffffff', fontWeight: 600, fontSize: 16, cursor: 'pointer' }}>
            Tentar novamente
          </button>
        </div>
      </body>
    </html>
  );
}
