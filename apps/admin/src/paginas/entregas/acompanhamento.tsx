import { useEffect, useState } from 'react';
import { apiImagem } from '../../api';

/** Resposta de GET /admin/entregas/acompanhamento (apps/api/src/entregas/acompanhamento.service.ts). */
export interface Ocorrencia {
  id: string; tipo: 'avaria' | 'falta' | 'troca' | 'recusa_item'; produtoCodigo: string | null; produtoDescricao: string | null;
  quantidade: number | null; observacao: string | null; foto: string | null; registradaEm: string; resolvidaEm: string | null; resolucao: string | null;
}
export interface Parada {
  id: string; entregaId: string; ordem: number; status: 'pendente' | 'no_cliente' | 'entregue' | 'nao_entregue'; cliente: string; bairro: string | null; cidade: string | null;
  endereco: string; latitude: number | null; longitude: number | null; nota: string | null; origem: string; volumes: number;
  chegadaEm: string | null; chegadaDistanciaM: number | null; concluidaEm: string | null; trajetoMin: number | null; noClienteMin: number | null;
  recebedorNome: string | null; recebedorDocumento: string | null; motivoNaoEntrega: string | null; observacao: string | null;
  fotos: { assinatura: string | null; mercadoria: string | null; local: string | null }; ocorrencias: Ocorrencia[];
}
export interface Carga {
  id: string; numero: number; status: 'autorizada' | 'em_rota' | 'encerrada';
  caminhao: { nome: string; placa: string | null } | null; motorista: { nome: string; telefone: string | null } | null;
  saidaEm: string | null; retornoEm: string | null;
  ultimaPosicao: { lat: number; lng: number; em: string; precisaoM: number | null } | null; semSinalMin: number | null;
  trajeto: Array<[number, number]>; paradas: Parada[];
}
export interface Alerta { tipo: 'sem_sinal' | 'chegada_longe' | 'nao_entregue' | 'ocorrencia'; cargaId: string; paradaId: string | null; ocorrenciaId: string | null; em: string; texto: string }
export interface Acompanhamento {
  data: string; agora: string;
  resumo: { emRota: number; encerradas: number; aguardandoSaida: number; paradas: number; entregues: number; naoEntregues: number; noCliente: number; tempoMedioNoClienteMin: number | null };
  alertas: Alerta[]; cargas: Carga[];
}

export const CORES_CARGA = ['#1d5be0', '#e8710a', '#7a3fd1', '#0f8a7e', '#c2185b', '#5d7a1f', '#8d6e63', '#00838f'];
export const COR_PARADA: Record<Parada['status'], string> = { entregue: '#146c34', no_cliente: '#1d5be0', nao_entregue: '#b42318', pendente: '#9aa6ba' };
export const ROTULO_PARADA: Record<Parada['status'], [string, 'verde' | 'azul' | 'vermelho' | 'cinza']> = {
  entregue: ['Entregue', 'verde'], no_cliente: ['No cliente', 'azul'], nao_entregue: ['Não entregue', 'vermelho'], pendente: ['Falta entregar', 'cinza'],
};
export const MOTIVOS: Record<string, string> = {
  cliente_fechado: 'Cliente fechado', sem_recebedor: 'Sem ninguém para receber', recusou: 'Cliente recusou',
  endereco_nao_encontrado: 'Endereço não encontrado', outro: 'Outro motivo',
};
export const TIPO_OCORRENCIA: Record<Ocorrencia['tipo'], string> = { avaria: 'Avaria', falta: 'Falta', troca: 'Troca', recusa_item: 'Item recusado' };

export const hora = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '–');
export const duracao = (min: number | null) => (min === null ? '–' : min >= 60 ? `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}` : `${min} min`);
export const km = (m: number) => `${(m / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} km`;

/** Hoje no calendário do computador, em AAAA-MM-DD. */
export function hoje(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function situacaoCarga(c: Carga, agora: Date): { texto: string; selo: [string, 'azul' | 'verde' | 'cinza' | 'amarelo'] } {
  if (c.status === 'autorizada') return { texto: 'Ainda não saiu do CD', selo: ['Autorizada', 'cinza'] };
  if (c.status === 'encerrada') return { texto: `Voltou ao CD às ${hora(c.retornoEm)}`, selo: ['Encerrada', 'verde'] };
  const atual = c.paradas.find((p) => p.status === 'no_cliente');
  if (atual) return { texto: `No cliente: ${atual.cliente} há ${Math.max(0, Math.round((agora.getTime() - new Date(atual.chegadaEm!).getTime()) / 60000))} min`, selo: ['Em rota', 'azul'] };
  const prox = c.paradas.find((p) => p.status === 'pendente');
  if (prox) return { texto: `A caminho de ${prox.cliente}${prox.bairro ? ` (${prox.bairro})` : ''}`, selo: ['Em rota', 'azul'] };
  return { texto: 'Voltando para o CD', selo: ['Em rota', 'azul'] };
}

/** Miniatura de uma foto do motorista (baixada com o login); clique abre grande. */
export function Foto({ nome, rotulo, onAbrir }: { nome: string; rotulo: string; onAbrir: (url: string, rotulo: string) => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [erro, setErro] = useState(false);
  useEffect(() => {
    let vivo = true;
    let criada: string | null = null;
    apiImagem(`/admin/entregas/fotos/${encodeURIComponent(nome)}`)
      .then((u) => { criada = u; if (vivo) setUrl(u); else URL.revokeObjectURL(u); })
      .catch(() => vivo && setErro(true));
    return () => { vivo = false; if (criada) URL.revokeObjectURL(criada); };
  }, [nome]);
  return (
    <button type="button" className="er-foto" disabled={!url} onClick={() => url && onAbrir(url, rotulo)} aria-label={`Abrir foto: ${rotulo}`}>
      {url ? <img src={url} alt="" /> : <span className="er-foto-vazia">{erro ? 'Foto indisponível' : 'Carregando…'}</span>}
      <span className="er-foto-rotulo">{rotulo.split(' · ')[0]}</span>
    </button>
  );
}

/** Foto em tela cheia; fecha no clique fora, no X ou no Esc. */
export function FotoAberta({ foto, onFechar }: { foto: { url: string; rotulo: string } | null; onFechar: () => void }) {
  useEffect(() => {
    if (!foto) return;
    const tecla = (e: KeyboardEvent) => e.key === 'Escape' && onFechar();
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, [foto, onFechar]);
  if (!foto) return null;
  return (
    <div className="er-modal" role="dialog" aria-modal="true" aria-label={foto.rotulo} onClick={onFechar}>
      <figure onClick={(e) => e.stopPropagation()}>
        <img src={foto.url} alt={foto.rotulo} />
        <figcaption>{foto.rotulo}<button type="button" onClick={onFechar}>Fechar</button></figcaption>
      </figure>
    </div>
  );
}

/** Fotos de uma parada: linha assinada, mercadoria, fachada (não entregue) e das ocorrências. */
export function FotosDaParada({ p, onAbrir }: { p: Parada; onAbrir: (url: string, rotulo: string) => void }) {
  const lista: Array<[string, string]> = [];
  if (p.fotos.assinatura) lista.push([p.fotos.assinatura, `Comprovante assinado · ${p.cliente}`]);
  if (p.fotos.mercadoria) lista.push([p.fotos.mercadoria, `Mercadoria entregue · ${p.cliente}`]);
  if (p.fotos.local) lista.push([p.fotos.local, `Local · ${p.cliente}`]);
  for (const o of p.ocorrencias) if (o.foto) lista.push([o.foto, `${TIPO_OCORRENCIA[o.tipo]} · ${p.cliente}`]);
  if (!lista.length) return null;
  return <div className="er-fotos">{lista.map(([n, r]) => <Foto key={n} nome={n} rotulo={r} onAbrir={onAbrir} />)}</div>;
}
