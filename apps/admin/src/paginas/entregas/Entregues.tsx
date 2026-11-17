import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../api';
import { CabecalhoPagina, Cartao, Selo, Vazio } from '../../vendas-ui';
import { FotoAberta, FotosDaParada, MOTIVOS, ROTULO_PARADA, TIPO_OCORRENCIA, duracao, hoje, hora, type Acompanhamento, type Parada } from './acompanhamento';
import '../vendas/cadastros.css';
import '../vendas/inicio-pedidos.css';
import './entregas.css';
import './em-rota.css';

type Filtro = 'todas' | 'entregue' | 'nao_entregue' | 'ocorrencia' | 'sem_foto';
const FILTROS: Array<[Filtro, string]> = [['todas', 'Todas'], ['entregue', 'Entregues'], ['nao_entregue', 'Não entregues'], ['ocorrencia', 'Com ocorrência'], ['sem_foto', 'Sem comprovante']];

const passa = (p: Parada, f: Filtro) =>
  f === 'todas' ? true
    : f === 'ocorrencia' ? p.ocorrencias.length > 0
      : f === 'sem_foto' ? p.status === 'entregue' && !p.fotos.assinatura
        : p.status === f;

export function EntregasEntregues() {
  const [data, setData] = useState(hoje());
  const [dados, setDados] = useState<Acompanhamento | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<Filtro>('todas');
  const [busca, setBusca] = useState('');
  const [foto, setFoto] = useState<{ url: string; rotulo: string } | null>(null);

  useEffect(() => {
    let vivo = true;
    setDados(null); setErro(null);
    api<Acompanhamento>(`/admin/entregas/acompanhamento?data=${data}`)
      .then((d) => vivo && setDados(d))
      .catch((e: Error) => vivo && setErro(e.message));
    return () => { vivo = false; };
  }, [data]);

  const abrir = useCallback((url: string, rotulo: string) => setFoto({ url, rotulo }), []);
  const termo = busca.trim().toLowerCase();
  const cargas = useMemo(() => (dados?.cargas ?? []).map((c) => ({
    ...c,
    feitas: c.paradas.filter((p) => (p.status === 'entregue' || p.status === 'nao_entregue') && passa(p, filtro)
      && (!termo || [p.cliente, p.bairro, p.nota, p.recebedorNome].some((v) => v?.toLowerCase().includes(termo)))),
  })).filter((c) => c.feitas.length > 0), [dados, filtro, termo]);
  const todas = (dados?.cargas ?? []).flatMap((c) => c.paradas);
  const entregues = todas.filter((p) => p.status === 'entregue');
  const semFoto = entregues.filter((p) => !p.fotos.assinatura).length;

  return (
    <div className="er-pagina">
      <CabecalhoPagina
        titulo="Entregues e comprovantes"
        subtitulo="Cada entrega feita com a foto da linha assinada no romaneio, quem recebeu, os horários e as ocorrências."
        acoes={<label className="ent-data">Dia<input type="date" value={data} onChange={(e) => e.target.value && setData(e.target.value)} /></label>}
      />
      {erro && <div className="cad-erro">{erro}</div>}
      {!dados && !erro && <Cartao><Vazio mensagem="Carregando…" /></Cartao>}
      {dados && (
        <>
          <div className="grid-indicadores">
            <Cartao className="indicador"><div><div className="rotulo">Entregues</div><div className="valor">{entregues.length}</div><div className="nota">de {todas.length} entregas do dia</div></div></Cartao>
            <Cartao className="indicador"><div><div className="rotulo">Com comprovante</div><div className="valor">{entregues.length - semFoto}</div><div className={`nota${semFoto ? ' ent-alerta' : ''}`}>{semFoto ? `${semFoto} sem foto do comprovante` : 'todas com foto'}</div></div></Cartao>
            <Cartao className="indicador"><div><div className="rotulo">Não entregues</div><div className={`valor${dados.resumo.naoEntregues ? ' er-vermelho' : ''}`}>{dados.resumo.naoEntregues}</div></div></Cartao>
            <Cartao className="indicador"><div><div className="rotulo">Ocorrências</div><div className="valor">{todas.reduce((s, p) => s + p.ocorrencias.length, 0)}</div><div className="nota">{todas.reduce((s, p) => s + p.ocorrencias.filter((o) => !o.resolvidaEm).length, 0)} sem resolução</div></div></Cartao>
          </div>

          <div className="cad-filtros er-filtros">
            <input type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar cliente, bairro, nota ou quem recebeu" aria-label="Buscar" />
            <div className="cad-chips" role="group" aria-label="Filtrar">
              {FILTROS.map(([f, rotulo]) => (
                <button key={f} type="button" className={`cad-chip${filtro === f ? ' ativo' : ''}`} aria-pressed={filtro === f} onClick={() => setFiltro(f)}>{rotulo}</button>
              ))}
            </div>
          </div>

          {cargas.length === 0 ? (
            <Cartao><Vazio mensagem={todas.length ? 'Nenhuma entrega com esse filtro.' : 'Nenhuma entrega feita neste dia.'} /></Cartao>
          ) : cargas.map((c) => (
            <Cartao key={c.id} className="er-entregues-carga">
              <div className="er-entregues-topo">
                <h2>{c.caminhao?.nome ?? 'Sem caminhão'} · Carga {c.numero}</h2>
                <span className="er-suave">{c.motorista?.nome ?? 'Sem motorista'} · saiu {hora(c.saidaEm)}{c.retornoEm ? ` · voltou ${hora(c.retornoEm)}` : ' · ainda na rua'}</span>
              </div>
              <ul className="er-entregues-lista">
                {c.feitas.map((p) => {
                  const [rotulo, variante] = ROTULO_PARADA[p.status];
                  return (
                    <li key={p.id} className="er-entregue">
                      <div className="er-entregue-info">
                        <div className="er-parada-nome"><strong>{p.ordem}. {p.cliente}</strong><Selo variante={variante}>{rotulo}</Selo></div>
                        <span className="er-suave">{[p.endereco, p.bairro].filter(Boolean).join(' · ')}{p.nota ? ` · NF ${p.nota}` : ''} · {p.volumes.toLocaleString('pt-BR')} vol.</span>
                        <div className="er-tempos">
                          <span>Chegou <b>{hora(p.chegadaEm)}</b></span><span>Saiu <b>{hora(p.concluidaEm)}</b></span><span>No cliente <b>{duracao(p.noClienteMin)}</b></span>
                        </div>
                        {p.recebedorNome && <span>Recebido por <b>{p.recebedorNome}</b>{p.recebedorDocumento ? ` · ${p.recebedorDocumento}` : ''}</span>}
                        {p.status === 'entregue' && !p.fotos.assinatura && <span className="ent-alerta">Sem foto do comprovante</span>}
                        {p.status === 'nao_entregue' && <div className="er-nota erro">Motivo: {MOTIVOS[p.motivoNaoEntrega ?? ''] ?? 'não informado'}{p.observacao ? `. ${p.observacao}` : ''}</div>}
                        {p.ocorrencias.map((o) => (
                          <div key={o.id} className="er-nota aviso"><b>{TIPO_OCORRENCIA[o.tipo]}:</b> {[o.quantidade !== null ? `${o.quantidade.toLocaleString('pt-BR')}x` : null, o.produtoDescricao, o.observacao].filter(Boolean).join(' · ')}{o.resolvidaEm ? ` · resolvida: ${o.resolucao}` : ' · sem resolução (resolva em Em rota)'}</div>
                        ))}
                      </div>
                      <FotosDaParada p={p} onAbrir={abrir} />
                    </li>
                  );
                })}
              </ul>
            </Cartao>
          ))}
        </>
      )}
      <FotoAberta foto={foto} onFechar={() => setFoto(null)} />
    </div>
  );
}
