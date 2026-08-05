import { useParams } from 'react-router-dom';

export function IndicaLanding() {
  const { codigo } = useParams<{ codigo: string }>();
  return (
    <div className="login-fundo">
      <div className="login-card">
        <div className="login-logo">
          <img src="/logo.png" alt="" onError={(e) => { e.currentTarget.parentElement!.style.display = 'none'; }} />
        </div>
        <h1>Você foi indicado!</h1>
        <p style={{ marginBottom: 4 }}>Baixe o app CAHU Delivery e digite o código abaixo no cadastro:</p>
        <div
          style={{
            fontSize: 28,
            fontWeight: 800,
            letterSpacing: 4,
            textAlign: 'center',
            padding: '16px 0',
            margin: '12px 0',
            background: '#f3f4f6',
            borderRadius: 12,
          }}
        >
          {codigo?.toUpperCase()}
        </div>
        <p style={{ fontSize: 13, color: 'var(--texto-2)' }}>
          Assim que seu primeiro pedido for faturado, quem te indicou ganha R$100 de saldo.
        </p>
      </div>
    </div>
  );
}
