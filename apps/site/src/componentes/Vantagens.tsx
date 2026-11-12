import type { ConfigLoja } from '@/lib/api/tipos';
import { formatarPreco } from '@/lib/formato/preco';
import estilos from './Vantagens.module.css';

const ICONES = {
  caixa: 'M3 8l9-5 9 5v8l-9 5-9-5zM3 8l9 5 9-5M12 13v8',
  loja: 'M4 9l1-5h14l1 5M4 9v11h16V9M4 9h16M9 20v-6h6v6',
  nota: 'M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h7',
  conversa: 'M21 12a8.5 8.5 0 0 1-12.6 7.4L3 21l1.7-5.1A8.5 8.5 0 1 1 21 12z',
} as const;

function Item({ icone, titulo, texto }: { icone: keyof typeof ICONES; titulo: string; texto: string }) {
  return (
    <li className={estilos.item}>
      <span className={estilos.icone} aria-hidden="true">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d={ICONES[icone]} />
        </svg>
      </span>
      <span><strong>{titulo}</strong><span className={estilos.texto}>{texto}</span></span>
    </li>
  );
}

/** Faixa de confiança logo abaixo dos banners: só afirma o que a configuração da loja confirma. */
export function Vantagens({ config }: { config: ConfigLoja }) {
  const horario = [config.horarioSemana && `Seg a sex ${config.horarioSemana}`, config.horarioSabado && `sáb ${config.horarioSabado}`]
    .filter(Boolean).join(' · ');
  return (
    <div className="conteudo">
      <ul className={estilos.lista} aria-label="Como funciona a compra">
        <Item icone="caixa" titulo="Preço de atacado" texto="Valor da caixa e da unidade em todo produto" />
        <Item icone="loja" titulo="Venda para lojistas"
          texto={config.pedidoMinimo != null ? `Pedido a partir de ${formatarPreco(config.pedidoMinimo)}` : 'Compra exclusiva para CNPJ'} />
        <Item icone="nota" titulo="Nota fiscal no seu CNPJ" texto="Em todo pedido faturado" />
        <Item icone="conversa" titulo="Atendimento no WhatsApp" texto={horario || 'Fale direto com a distribuidora'} />
      </ul>
    </div>
  );
}
