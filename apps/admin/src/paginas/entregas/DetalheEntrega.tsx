import { useEffect, useState } from 'react';
import { api } from '../../api';
import { formatarDataHora, formatarReais } from '../../vendas-ui';

/** GET /admin/entregas/entregas/:id (NotasAEntregarService.detalhe). */
interface Detalhe {
  id: string; origem: string; pedidoNumero: string | null; situacao: string; cliente: string; documento: string | null; telefone: string | null;
  endereco: string; nota: { numero: string; serie: string | null; chave: string | null; emitidaEm: string | null } | null;
  pedidoEm: string | null; pagamento: string | null; total: number | null;
  itens: Array<{ codigo: string | null; descricao: string; unidade: string | null; quantidade: number; valorUnitario: number | null; valorTotal: number | null; pesoKg: number | null }>;
  pesoKg: number | null; itensSemPeso: number;
  carga: { numero: number; status: string; data: string; caminhao: string | null; motorista: string | null; entregaStatus: string; naCarga: boolean } | null;
}

const ORIGEM: Record<string, string> = { app: 'Aplicativo', site: 'Site', vendedor: 'Vendedor', televendas: 'Televendas', teste: 'Teste' };
const SITUACAO: Record<string, string> = { FATURADO: 'Faturado', ENTREGUE: 'Entregue', CANCELADO: 'Cancelado', SAIU_ENTREGA: 'Saiu para entrega' };
const STATUS_CARGA: Record<string, string> = { rascunho: 'aguardando autorização', autorizada: 'autorizada', em_rota: 'em rota', encerrada: 'encerrada', cancelada: 'cancelada' };
const STATUS_LINHA: Record<string, string> = { pendente: 'falta entregar', entregue: 'entregue', nao_entregue: 'não entregue' };
const num = (n: number, casas = 0) => n.toLocaleString('pt-BR', { maximumFractionDigits: casas });
const dataBr = (iso: string) => iso.split('-').reverse().join('/');

/** Abre por cima da tela o pedido (ou a nota do televendas) com os produtos e a carga em que está. */
export function DetalheEntrega({ entregaId, onFechar }: { entregaId: string | null; onFechar: () => void }) {
  const [d, setD] = useState<Detalhe | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!entregaId) return;
    let vivo = true;
    setD(null); setErro(null);
    api<Detalhe>(`/admin/entregas/entregas/${encodeURIComponent(entregaId)}`)
      .then((r) => vivo && setD(r))
      .catch((e: Error) => vivo && setErro(e.message));
    const tecla = (e: KeyboardEvent) => e.key === 'Escape' && onFechar();
    window.addEventListener('keydown', tecla);
    return () => { vivo = false; window.removeEventListener('keydown', tecla); };
  }, [entregaId, onFechar]);

  if (!entregaId) return null;
  return (
    <div className="de-fundo" onClick={onFechar}>
      <section className="de-painel" role="dialog" aria-modal="true" aria-label="Detalhe da entrega" onClick={(e) => e.stopPropagation()}>
        <header className="de-topo">
          <div>
            <span className="de-origem">{d ? ORIGEM[d.origem] ?? d.origem : 'Entrega'}{d?.pedidoNumero ? ` · pedido ${d.pedidoNumero}` : ''}</span>
            <h2>{d?.cliente ?? 'Carregando…'}</h2>
          </div>
          <button type="button" className="cad-btn cad-btn-claro" onClick={onFechar}>Fechar</button>
        </header>
        {erro && <div className="cad-erro">{erro}</div>}
        {d && (
          <div className="de-corpo">
            <dl className="de-dados">
              <div><dt>Endereço</dt><dd>{d.endereco || 'não informado'}</dd></div>
              {d.telefone && <div><dt>Telefone</dt><dd>{d.telefone}</dd></div>}
              {d.documento && <div><dt>CNPJ/CPF</dt><dd>{d.documento}</dd></div>}
              <div><dt>Nota fiscal</dt><dd>{d.nota ? `${d.nota.numero}${d.nota.serie ? ` série ${d.nota.serie}` : ''}${d.nota.emitidaEm ? ` · ${formatarDataHora(d.nota.emitidaEm)}` : ''}` : 'ainda não recebida'}</dd></div>
              {d.pedidoEm && <div><dt>Pedido feito</dt><dd>{formatarDataHora(d.pedidoEm)}</dd></div>}
              <div><dt>Situação</dt><dd>{SITUACAO[d.situacao] ?? d.situacao}</dd></div>
              <div><dt>Carga</dt><dd>{d.carga
                ? `${d.carga.naCarga ? '' : 'Saiu da '}Carga ${d.carga.numero} de ${dataBr(d.carga.data)} · ${STATUS_CARGA[d.carga.status] ?? d.carga.status}${d.carga.caminhao ? ` · ${d.carga.caminhao}` : ''}${d.carga.motorista ? ` · ${d.carga.motorista}` : ''} · ${STATUS_LINHA[d.carga.entregaStatus] ?? d.carga.entregaStatus}`
                : 'ainda não está em nenhuma carga'}</dd></div>
            </dl>
            <div className="de-tabela">
              <table>
                <thead><tr><th>Produto</th><th className="num">Qtd</th><th className="num de-unit">Valor unit.</th><th className="num">Total</th><th className="num">Peso</th></tr></thead>
                <tbody>
                  {d.itens.map((i, k) => (
                    <tr key={`${i.codigo ?? ''}-${k}`}>
                      <td><strong>{i.descricao}</strong>{i.codigo && <span className="cad-sub">cód. {i.codigo}</span>}</td>
                      <td className="num">{num(i.quantidade, 3)}{i.unidade ? ` ${i.unidade}` : ''}</td>
                      <td className="num de-unit">{i.valorUnitario === null ? '–' : formatarReais(i.valorUnitario)}</td>
                      <td className="num">{i.valorTotal === null ? '–' : formatarReais(i.valorTotal)}</td>
                      <td className="num">{i.pesoKg === null ? <span className="ent-alerta">sem peso</span> : `≈ ${num(i.pesoKg, 1)} kg`}</td>
                    </tr>
                  ))}
                  {d.itens.length === 0 && <tr><td colSpan={5} className="cad-fraco">Sem itens.</td></tr>}
                </tbody>
                <tfoot>
                  <tr>
                    <th>{d.itens.length} {d.itens.length === 1 ? 'produto' : 'produtos'}</th>
                    <th className="num">{num(d.itens.reduce((s, i) => s + i.quantidade, 0), 3)}</th>
                    <th className="de-unit"></th>
                    <th className="num">{d.total === null ? '–' : formatarReais(d.total)}</th>
                    <th className="num">{d.pesoKg === null ? '–' : `≈ ${num(d.pesoKg, 1)} kg`}{d.itensSemPeso > 0 && <span className="cad-sub ent-alerta">{d.itensSemPeso} sem peso</span>}</th>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
