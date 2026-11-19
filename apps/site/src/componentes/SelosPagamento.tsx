import estilos from './SelosPagamento.module.css';

/**
 * Formas de pagamento do rodapé em selo: o símbolo do PIX e as bandeiras de cartão, em vez do nome escrito.
 * Os desenhos são feitos aqui (sem arquivo de imagem nem site de fora). Forma sem símbolo (boleto, dinheiro,
 * saldo da carteira) continua aparecendo pelo nome.
 */

const Pix = () => (
  <span className={estilos.selo} role="img" aria-label="PIX" title="PIX">
    <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="#32BCAD">
      <path d="M5.283 18.36a3.505 3.505 0 0 0 2.493-1.032l3.6-3.6a.684.684 0 0 1 .946 0l3.613 3.613a3.504 3.504 0 0 0 2.493 1.032h.71l-4.56 4.56a3.647 3.647 0 0 1-5.156 0L4.85 18.36ZM18.428 5.627a3.505 3.505 0 0 0-2.493 1.032l-3.613 3.614a.67.67 0 0 1-.946 0l-3.6-3.6A3.505 3.505 0 0 0 5.283 5.64h-.434l4.573-4.572a3.646 3.646 0 0 1 5.156 0l4.559 4.559ZM1.068 9.422 3.79 6.699h1.492a2.483 2.483 0 0 1 1.744.722l3.6 3.6a1.73 1.73 0 0 0 2.443 0l3.614-3.613a2.482 2.482 0 0 1 1.744-.723h1.767l2.737 2.737a3.646 3.646 0 0 1 0 5.156l-2.736 2.736h-1.768a2.482 2.482 0 0 1-1.744-.722l-3.613-3.613a1.77 1.77 0 0 0-2.444 0l-3.6 3.6a2.483 2.483 0 0 1-1.744.722H3.791l-2.723-2.723a3.646 3.646 0 0 1 0-5.156" />
    </svg>
    <b className={estilos.pix}>pix</b>
  </span>
);

const Visa = () => (
  <span className={estilos.selo} role="img" aria-label="Cartão Visa" title="Visa">
    <svg aria-hidden="true" viewBox="0 0 48 20" width="44" height="18">
      <text x="24" y="16" textAnchor="middle" fontFamily="Arial, Helvetica, sans-serif" fontSize="18" fontWeight="900" fontStyle="italic" fill="#1A1F71" letterSpacing="-0.5">VISA</text>
    </svg>
  </span>
);

const Mastercard = () => (
  <span className={estilos.selo} role="img" aria-label="Cartão Mastercard" title="Mastercard">
    <svg aria-hidden="true" viewBox="0 0 40 24" width="36" height="22">
      <circle cx="14" cy="12" r="10" fill="#EB001B" />
      <circle cx="26" cy="12" r="10" fill="#F79E1B" />
      <path d="M20 4a10 10 0 0 1 0 16 10 10 0 0 1 0-16Z" fill="#FF5F00" />
    </svg>
  </span>
);

const Elo = () => (
  <span className={`${estilos.selo} ${estilos.escuro}`} role="img" aria-label="Cartão Elo" title="Elo">
    <svg aria-hidden="true" viewBox="0 0 46 22" width="42" height="20">
      <circle cx="9" cy="11" r="6.2" fill="none" stroke="#FFCB05" strokeWidth="2.6" strokeDasharray="13 26" transform="rotate(-150 9 11)" />
      <circle cx="9" cy="11" r="6.2" fill="none" stroke="#00A4E0" strokeWidth="2.6" strokeDasharray="13 26" transform="rotate(-30 9 11)" />
      <circle cx="9" cy="11" r="6.2" fill="none" stroke="#EF4123" strokeWidth="2.6" strokeDasharray="13 26" transform="rotate(90 9 11)" />
      <text x="32" y="16" textAnchor="middle" fontFamily="Arial, Helvetica, sans-serif" fontSize="15" fontWeight="700" fill="#FFFFFF">elo</text>
    </svg>
  </span>
);

const Hipercard = () => (
  <span className={`${estilos.selo} ${estilos.vermelho}`} role="img" aria-label="Cartão Hipercard" title="Hipercard">
    <svg aria-hidden="true" viewBox="0 0 62 20" width="56" height="18">
      <text x="31" y="14.5" textAnchor="middle" fontFamily="Arial, Helvetica, sans-serif" fontSize="12.5" fontWeight="700" fontStyle="italic" fill="#FFFFFF">Hipercard</text>
    </svg>
  </span>
);

const Amex = () => (
  <span className={`${estilos.selo} ${estilos.azul}`} role="img" aria-label="Cartão American Express" title="American Express">
    <svg aria-hidden="true" viewBox="0 0 50 22" width="46" height="20">
      <text x="25" y="9.5" textAnchor="middle" fontFamily="Arial, Helvetica, sans-serif" fontSize="8.2" fontWeight="900" fill="#FFFFFF" letterSpacing="0.6">AMERICAN</text>
      <text x="25" y="19" textAnchor="middle" fontFamily="Arial, Helvetica, sans-serif" fontSize="8.2" fontWeight="900" fill="#FFFFFF" letterSpacing="1.1">EXPRESS</text>
    </svg>
  </span>
);

const BANDEIRAS: Record<string, () => React.JSX.Element> = { visa: Visa, mastercard: Mastercard, elo: Elo, hipercard: Hipercard, amex: Amex };
const NOMES: Record<string, string> = { boleto: 'Boleto', dinheiro: 'Dinheiro', carteira: 'Saldo da carteira' };

export function SelosPagamento({ formas, bandeiras }: { formas: string[]; bandeiras: string[] }) {
  const cartoes = formas.includes('cartao') ? bandeiras.filter((b) => BANDEIRAS[b]) : [];
  return (
    <ul className={estilos.selos} aria-label="Formas de pagamento aceitas">
      {formas.includes('pix') && <li><Pix /></li>}
      {cartoes.map((b) => { const Selo = BANDEIRAS[b]; return <li key={b}><Selo /></li>; })}
      {/* cartão aceito mas sem bandeira configurada: fica o nome, como era */}
      {formas.includes('cartao') && cartoes.length === 0 && <li><span className={estilos.texto}>Cartão de crédito</span></li>}
      {formas.filter((f) => NOMES[f]).map((f) => <li key={f}><span className={estilos.texto}>{NOMES[f]}</span></li>)}
    </ul>
  );
}
