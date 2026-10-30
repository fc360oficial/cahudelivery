import { useEffect, useState } from 'react';
import { api, PAGAMENTO_LABEL } from '../api';

interface Config {
  pedido_minimo?: { tipo: string; valor: number };
  formas_pagamento?: string[];
  aprovacao_cadastro?: boolean;
  horario_atendimento?: Record<string, string>;
  limite_estoque_baixo?: number;
  dias_vencimento_proximo?: number;
  indicacoes_ativas?: boolean;
  cartao_em_breve?: boolean;
  contato_whatsapp?: string;
  politica_cancelamento?: string;
  politica_privacidade?: string;
  cartao_valor_maximo?: { valor: number };
  cartao_pedidos_anteriores?: { valor: number };
}

export function Configuracoes() {
  const [cfg, setCfg] = useState<Config | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    api<Config>('/admin/configuracoes').then(setCfg).catch((e) => setErro(e.message));
  }, []);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (!cfg) return;
    setSalvando(true); setOk(false);
    try {
      const novo = await api<Config>('/admin/configuracoes', { method: 'PATCH', body: JSON.stringify({ valores: cfg }) });
      setCfg(novo); setErro(null); setOk(true);
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  if (erro && !cfg) return <div className="erro-texto">{erro}</div>;
  if (!cfg) return <div className="vazio">Carregando…</div>;

  const formas = cfg.formas_pagamento ?? [];
  const toggleForma = (f: string) =>
    setCfg({ ...cfg, formas_pagamento: formas.includes(f) ? formas.filter((x) => x !== f) : [...formas, f] });

  return (
    <>
      <h1>Configurações</h1>
      <form onSubmit={salvar} style={{ display: 'grid', gap: 14, maxWidth: 560 }}>
        <div className="card">
          <div className="rotulo">Pedido mínimo (R$)</div>
          <input type="number" step="0.01" min="0" value={cfg.pedido_minimo?.valor ?? 0}
            onChange={(e) => setCfg({ ...cfg, pedido_minimo: { tipo: 'valor', valor: Number(e.target.value) } })}
            style={{ marginTop: 8, width: 160 }} />
          <div style={{ color: 'var(--texto-2)', marginTop: 6 }}>0 = sem pedido mínimo. O app mostra a barra "faltam R$ X".</div>
        </div>

        <div className="card">
          <div className="rotulo">Estoque baixo</div>
          <input type="number" min="0" value={cfg.limite_estoque_baixo ?? 0}
            onChange={(e) => setCfg({ ...cfg, limite_estoque_baixo: Number(e.target.value) })}
            style={{ marginTop: 8, width: 160 }} />
          <div style={{ color: 'var(--texto-2)', marginTop: 6 }}>0 = selo desativado. Produtos com estoque igual ou menor que esse número mostram "X em estoque" no app.</div>
        </div>

        <div className="card">
          <div className="rotulo">Vencimento próximo</div>
          <input type="number" min="0" value={cfg.dias_vencimento_proximo ?? 0}
            onChange={(e) => setCfg({ ...cfg, dias_vencimento_proximo: Number(e.target.value) })}
            style={{ marginTop: 8, width: 160 }} />
          <div style={{ color: 'var(--texto-2)', marginTop: 6 }}>0 = vitrine desativada. Produtos com validade cadastrada dentro desse número de dias aparecem na vitrine "Vencimento Próximo" do app.</div>
        </div>

        <div className="card">
          <div className="rotulo">Formas de pagamento aceitas</div>
          <div className="filtros" style={{ marginTop: 8, marginBottom: 0 }}>
            {['pix', 'cartao', 'boleto'].map((f) => (
              <button key={f} type="button" className={`pill-filtro ${formas.includes(f) ? 'ativo' : ''}`} onClick={() => toggleForma(f)}>
                {PAGAMENTO_LABEL[f]}
              </button>
            ))}
          </div>
          <div style={{ color: 'var(--texto-2)', marginTop: 6 }}>Só as formas marcadas aparecem no checkout do app. Cartão = crédito/débito na maquininha, na entrega (sem cobrança online).</div>
          {!formas.includes('cartao') && (
            <div style={{ marginTop: 12 }}>
              <div className="filtros" style={{ marginBottom: 0 }}>
                <button type="button" className={`pill-filtro ${cfg.cartao_em_breve ? 'ativo' : ''}`} onClick={() => setCfg({ ...cfg, cartao_em_breve: !cfg.cartao_em_breve })}>
                  Mostrar "Cartão de crédito — em breve" no app
                </button>
              </div>
              <div style={{ color: 'var(--texto-2)', marginTop: 6 }}>Com o cartão desligado, o app mostra o cartão travado com o selo "Em breve" e orienta a comprar direto na distribuidora (sem prometer prazo). Desmarque para simplesmente esconder o cartão.</div>
            </div>
          )}
        </div>

        {formas.includes('cartao') && (
          <div className="card">
            <div className="rotulo">Proteção do cartão online (chargeback)</div>
            <div className="filtros" style={{ marginTop: 8, marginBottom: 0 }}>
              <label>Valor máximo por pedido (R$)
                <input type="number" step="0.01" min="0" value={cfg.cartao_valor_maximo?.valor ?? 0}
                  onChange={(e) => setCfg({ ...cfg, cartao_valor_maximo: { valor: Number(e.target.value) } })}
                  style={{ width: 130, marginLeft: 6 }} />
              </label>
              <label>Pedidos entregues antes de liberar
                <input type="number" min="0" step="1" value={cfg.cartao_pedidos_anteriores?.valor ?? 0}
                  onChange={(e) => setCfg({ ...cfg, cartao_pedidos_anteriores: { valor: Math.max(0, Math.round(Number(e.target.value))) } })}
                  style={{ width: 80, marginLeft: 6 }} />
              </label>
            </div>
            <div style={{ color: 'var(--texto-2)', marginTop: 6 }}>
              0 = sem limite. Acima do valor, ou para cliente com menos pedidos faturados/entregues que o mínimo, o app pede PIX (PIX não tem chargeback).
            </div>
          </div>
        )}

        <div className="card">
          <div className="rotulo">WhatsApp da distribuidora</div>
          <input value={cfg.contato_whatsapp ?? ''} onChange={(e) => setCfg({ ...cfg, contato_whatsapp: e.target.value })}
            placeholder="(81) 99999-9999" style={{ marginTop: 8, width: 200 }} />
          <div style={{ color: 'var(--texto-2)', marginTop: 6 }}>Número usado pelo botão "Falar com a distribuidora" no app (ex.: no aviso do cartão em breve). Vazio = sem botão.</div>
        </div>

        <div className="card">
          <div className="rotulo">Cadastro de clientes</div>
          <div className="filtros" style={{ marginTop: 8, marginBottom: 0 }}>
            <button type="button" className={`pill-filtro ${cfg.aprovacao_cadastro ? 'ativo' : ''}`} onClick={() => setCfg({ ...cfg, aprovacao_cadastro: true })}>
              Exige aprovação da equipe
            </button>
            <button type="button" className={`pill-filtro ${!cfg.aprovacao_cadastro ? 'ativo' : ''}`} onClick={() => setCfg({ ...cfg, aprovacao_cadastro: false })}>
              Aprovação automática
            </button>
          </div>
        </div>

        <div className="card">
          <div className="rotulo">Programa de indicação (Indique e Ganhe)</div>
          <div className="filtros" style={{ marginTop: 8, marginBottom: 0 }}>
            <button type="button" className={`pill-filtro ${cfg.indicacoes_ativas ? 'ativo' : ''}`} onClick={() => setCfg({ ...cfg, indicacoes_ativas: true })}>
              Ativo
            </button>
            <button type="button" className={`pill-filtro ${!cfg.indicacoes_ativas ? 'ativo' : ''}`} onClick={() => setCfg({ ...cfg, indicacoes_ativas: false })}>
              Desativado
            </button>
          </div>
          <div style={{ color: 'var(--texto-2)', marginTop: 6 }}>Desativado = esconde "Indique e ganhe" e o campo de código no cadastro do app. A fila aqui na retaguarda continua visível.</div>
        </div>

        <div className="card">
          <div className="rotulo">Horário de atendimento</div>
          <div className="filtros" style={{ marginTop: 8, marginBottom: 0 }}>
            <label>Seg–Sex <input value={cfg.horario_atendimento?.seg_sex ?? ''} onChange={(e) => setCfg({ ...cfg, horario_atendimento: { ...cfg.horario_atendimento, seg_sex: e.target.value } })} placeholder="08:00-18:00" style={{ width: 130, marginLeft: 6 }} /></label>
            <label>Sábado <input value={cfg.horario_atendimento?.sab ?? ''} onChange={(e) => setCfg({ ...cfg, horario_atendimento: { ...cfg.horario_atendimento, sab: e.target.value } })} placeholder="08:00-12:00" style={{ width: 130, marginLeft: 6 }} /></label>
          </div>
        </div>

        <div className="card">
          <div className="rotulo">Políticas do app</div>
          <div style={{ color: 'var(--texto-2)', marginTop: 6 }}>
            Texto puro, exibido como está no Perfil do app (a de cancelamento também aparece na tela do cartão). Vazio = a entrada some do app.
            Exigência das lojas de aplicativo (LGPD) e do pagamento online com cartão (Rede / CDC art. 49). Versão de referência em docs/politicas.md.
          </div>
          <label style={{ display: 'block', marginTop: 12 }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Trocas, cancelamento e reembolso</div>
            <textarea value={cfg.politica_cancelamento ?? ''} onChange={(e) => setCfg({ ...cfg, politica_cancelamento: e.target.value })}
              rows={12} style={{ width: '100%', fontFamily: 'inherit', fontSize: 13, lineHeight: 1.5 }} />
          </label>
          <label style={{ display: 'block', marginTop: 12 }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Política de privacidade</div>
            <textarea value={cfg.politica_privacidade ?? ''} onChange={(e) => setCfg({ ...cfg, politica_privacidade: e.target.value })}
              rows={12} style={{ width: '100%', fontFamily: 'inherit', fontSize: 13, lineHeight: 1.5 }} />
          </label>
        </div>

        <div className="filtros">
          <button className="btn" disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar configurações'}</button>
          {ok && <span style={{ color: 'var(--verde)', alignSelf: 'center' }}>✓ Salvo</span>}
          {erro && <span className="erro-texto" style={{ alignSelf: 'center' }}>{erro}</span>}
        </div>
      </form>
    </>
  );
}
