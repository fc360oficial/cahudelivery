import { useEffect, useState } from 'react';
import { api } from '../api';

interface Config {
  pedido_minimo?: { tipo: string; valor: number };
  formas_pagamento?: string[];
  aprovacao_cadastro?: boolean;
  horario_atendimento?: Record<string, string>;
  limite_estoque_baixo?: number;
  dias_vencimento_proximo?: number;
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
            {['pix', 'boleto'].map((f) => (
              <button key={f} type="button" className={`pill-filtro ${formas.includes(f) ? 'ativo' : ''}`} onClick={() => toggleForma(f)}>
                {f.toUpperCase()}
              </button>
            ))}
          </div>
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
          <div className="rotulo">Horário de atendimento</div>
          <div className="filtros" style={{ marginTop: 8, marginBottom: 0 }}>
            <label>Seg–Sex <input value={cfg.horario_atendimento?.seg_sex ?? ''} onChange={(e) => setCfg({ ...cfg, horario_atendimento: { ...cfg.horario_atendimento, seg_sex: e.target.value } })} placeholder="08:00-18:00" style={{ width: 130, marginLeft: 6 }} /></label>
            <label>Sábado <input value={cfg.horario_atendimento?.sab ?? ''} onChange={(e) => setCfg({ ...cfg, horario_atendimento: { ...cfg.horario_atendimento, sab: e.target.value } })} placeholder="08:00-12:00" style={{ width: 130, marginLeft: 6 }} /></label>
          </div>
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
