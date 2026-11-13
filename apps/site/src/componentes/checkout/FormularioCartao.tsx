'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { lerValidade, luhnOk, urlDesafioSegura } from '@/lib/checkout/cartao';
import { formatarPreco } from '@/lib/formato/preco';
import conta from '@/componentes/conta/Conta.module.css';
import estilos from './BlocoPagamento.module.css';

/** "0000 0000 0000 0000" enquanto digita. */
const agruparNumero = (v: string) => v.replace(/\D/g, '').slice(0, 19).replace(/(\d{4})(?=\d)/g, '$1 ');
/** "MM/AA" enquanto digita. */
const formatarValidade = (v: string) => {
  const d = v.replace(/\D/g, '').slice(0, 4);
  return d.length <= 2 ? d : `${d.slice(0, 2)}/${d.slice(2)}`;
};

/** Tela, idioma e fuso que o banco usa na análise do 3DS (o IP e o navegador vão pelo servidor). */
function dadosDoNavegador() {
  const idioma = (navigator.language || 'pt-BR').slice(0, 10);
  return {
    altura: Math.max(1, Math.round(window.screen.height)),
    largura: Math.max(1, Math.round(window.screen.width)),
    profundidadeCor: Math.min(48, Math.max(1, window.screen.colorDepth || 24)),
    ...(/^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,6})?$/.test(idioma) ? { idioma } : {}),
    // A Rede quer UTC − hora local em horas (Recife, UTC−3 → 3), como o app.
    fusoHoras: Math.max(-14, Math.min(14, Math.trunc(new Date().getTimezoneOffset() / 60))),
  };
}

/**
 * Formulário do cartão. Os dados ficam só no estado deste componente e vão num único POST para
 * /api/conta/pedidos/[id]/pagar-cartao; o CVV é apagado a cada envio e tudo é apagado antes de ir
 * ao banco (3DS). Nada vai para URL, cookie ou armazenamento do navegador.
 */
export function FormularioCartao({ pedidoId, valor, recarregar, aoSessaoExpirar }: {
  pedidoId: string; valor: number | null; recarregar: () => void; aoSessaoExpirar: () => void;
}) {
  const [numero, setNumero] = useState('');
  const [nome, setNome] = useState('');
  const [validade, setValidade] = useState('');
  const [cvv, setCvv] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [indoAoBanco, setIndoAoBanco] = useState(false);

  // Voltar do banco pelo botão Voltar restaura a página do cache (bfcache) com "Abrindo a página
  // do seu banco…": devolve o formulário.
  useEffect(() => {
    const aoMostrar = (e: PageTransitionEvent) => {
      if (e.persisted) { setIndoAoBanco(false); setEnviando(false); }
    };
    window.addEventListener('pageshow', aoMostrar);
    return () => window.removeEventListener('pageshow', aoMostrar);
  }, []);

  const limparTudo = () => { setNumero(''); setNome(''); setValidade(''); setCvv(''); };

  const pagar = async (e: FormEvent) => {
    e.preventDefault();
    if (enviando) return;
    const digitos = numero.replace(/\D/g, '');
    const venc = lerValidade(validade);
    if (digitos.length < 13 || !luhnOk(digitos)) return setErro('Confira o número do cartão.');
    if (nome.trim().length < 2) return setErro('Informe o nome como está no cartão.');
    if (!venc) return setErro('Informe a validade no formato MM/AA.');
    if (!/^\d{3,4}$/.test(cvv)) return setErro('O código de segurança tem 3 ou 4 dígitos.');
    setEnviando(true);
    setErro(null);
    const corpo = JSON.stringify({ numero: digitos, nome: nome.trim(), validadeMes: venc.mes, validadeAno: venc.ano, cvv, dispositivo: dadosDoNavegador() });
    setCvv(''); // o CVV não fica na tela depois do envio
    let r: Response;
    try {
      r = await fetch(`/api/conta/pedidos/${pedidoId}/pagar-cartao`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: corpo });
    } catch {
      setEnviando(false);
      return setErro('Sem conexão. Confira na página do pedido se o pagamento entrou antes de tentar de novo.');
    }
    const j = (await r.json().catch(() => null)) as { status?: unknown; mensagem?: unknown; urlAutenticacao?: unknown } | null;
    if (r.status === 401) return aoSessaoExpirar();
    if (r.ok && j?.status === 'autenticar') {
      const url = urlDesafioSegura(j.urlAutenticacao);
      if (url) {
        // 3DS na própria aba: o banco volta para /conta/pedidos/<id>?pagamento=ok|falhou.
        limparTudo();
        setIndoAoBanco(true);
        window.location.assign(url);
        return;
      }
    }
    setEnviando(false);
    if (r.ok && j?.status === 'pago') {
      limparTudo();
      return recarregar();
    }
    if (r.ok && j?.status === 'recusado') return setErro(typeof j.mensagem === 'string' ? j.mensagem : 'Pagamento recusado. Tente outro cartão.');
    if (r.status === 404) { recarregar(); return setErro('Este pedido não tem pagamento com cartão em aberto. A página foi atualizada.'); }
    if (!r.ok && typeof j?.mensagem === 'string' && j.mensagem) return setErro(j.mensagem);
    setErro('Não foi possível confirmar o pagamento agora. Confira a situação do pedido antes de tentar de novo.');
    recarregar(); // a tela mostra o que a API sabe
  };

  if (indoAoBanco) {
    return <p className={conta.info} role="status">Abrindo a página do seu banco para confirmar a compra…</p>;
  }

  return (
    // method="post": se um dia for enviado sem JavaScript, o cartão nunca vai para a URL (GET).
    <form method="post" className={estilos.cartaoForm} onSubmit={pagar} aria-label="Pagar com cartão de crédito">
      <div className={conta.acoes}>
        <button type="submit" className={conta.primario} disabled={enviando}>
          {enviando ? 'Processando…' : `Pagar ${valor != null ? formatarPreco(valor) : ''}`.trim()}
        </button>
      </div>
      {erro && <p className={conta.erro} role="alert">{erro}</p>}
      <div className={conta.campos}>
        <div className={conta.campo}>
          <label htmlFor="cc-numero">Número do cartão</label>
          <input id="cc-numero" name="cc-number" autoComplete="cc-number" inputMode="numeric" maxLength={23} required
            placeholder="0000 0000 0000 0000" value={numero} onChange={(e) => setNumero(agruparNumero(e.target.value))} />
        </div>
        <div className={conta.campo}>
          <label htmlFor="cc-nome">Nome impresso no cartão</label>
          <input id="cc-nome" name="cc-name" autoComplete="cc-name" maxLength={30} required
            value={nome} onChange={(e) => setNome(e.target.value.toUpperCase())} />
        </div>
        <div className={`${conta.campo} ${conta.metade}`}>
          <label htmlFor="cc-validade">Validade (MM/AA)</label>
          <input id="cc-validade" name="cc-exp" autoComplete="cc-exp" inputMode="numeric" maxLength={5} required placeholder="MM/AA"
            value={validade} onChange={(e) => setValidade(formatarValidade(e.target.value))} />
        </div>
        <div className={`${conta.campo} ${conta.metade}`}>
          <label htmlFor="cc-cvv">Código de segurança (CVV)</label>
          <input id="cc-cvv" name="cc-csc" autoComplete="cc-csc" inputMode="numeric" maxLength={4} required
            value={cvv} onChange={(e) => setCvv(e.target.value.replace(/\D/g, '').slice(0, 4))} />
        </div>
      </div>
      <p className={estilos.dica}>
        Pagamento processado pela Rede (Itaú). Os dados do cartão não ficam salvos no site nem na distribuidora. Seu banco pode
        pedir para você confirmar a compra; nesse caso você vai para a página dele e volta para cá.
      </p>
    </form>
  );
}
