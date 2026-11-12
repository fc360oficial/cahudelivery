'use client';

import { useEffect, useState } from 'react';

const LIMITE_MS = 10 * 60 * 1000;

export function AvisoDesatualizado({ geradoEm }: { geradoEm: number }) {
  const [antiga, setAntiga] = useState(false);
  useEffect(() => { setAntiga(Date.now() - geradoEm > LIMITE_MS); }, [geradoEm]);
  if (!antiga) return null;
  const hora = new Date(geradoEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return (
    <p role="status" className="conteudo" style={{ paddingBlock: 12, margin: '0 auto', fontSize: 13, color: 'var(--tinta-suave)' }}>
      Preços conferidos às {hora}. Atualize a página para ver os valores de agora.
    </p>
  );
}
