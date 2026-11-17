import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../api';
import { CabecalhoPagina, Cartao, Selo, Vazio, formatarDataHora, type VarianteSelo } from '../../vendas-ui';
import '../vendas/cadastros.css';
import '../vendas/inicio-pedidos.css';
import './entregas.css';
import { DetalheEntrega } from './DetalheEntrega';

interface Endereco { logradouro: string | null; numero: string | null; complemento: string | null; bairro: string | null; cidade: string | null; uf: string | null; cep: string | null }
interface Entrega {
  id: string; origem: string; pedidoNumero: string | null; cliente: string; telefone: string | null; endereco: Endereco;
  latitude: number | null; longitude: number | null; nota: { numero: string; serie: string | null } | null; emitidaEm: string | null;
  total: number | null; volumes: number; pesoKg: number | null; itensSemPeso: number; itens: number;
}
interface Resposta {
  resumo: { entregas: number; volumes: number; pesoKg: number; comPesoIncompleto: number; semLocalizacao: number };
  entregas: Entrega[];
}

const ORIGEM: Record<string, [string, VarianteSelo]> = {
  app: ['App', 'azul'],
  site: ['Site', 'cinza'],
  vendedor: ['Vendedor', 'verde'],
  televendas: ['Televendas', 'amarelo'],
};
const rotuloOrigem = (o: string): [string, VarianteSelo] => ORIGEM[o] ?? [o.charAt(0).toUpperCase() + o.slice(1), 'cinza'];

const numero = (n: number, casas = 0) => n.toLocaleString('pt-BR', { maximumFractionDigits: casas });
const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
/** "JABOATAO DOS GUARARAPES" (nota) e "Jaboatão dos Guararapes" (cadastro) são a mesma cidade. */
const chaveCidade = (s: string | null) => semAcento(s ?? '').trim().toUpperCase() || 'SEM CIDADE';
const temMinuscula = (s: string) => s !== s.toUpperCase();

/** Há quanto tempo a nota foi emitida, pelo calendário: "hoje", "ontem", "há 3 dias". */
function idadeDaNota(iso: string): string {
  const emitida = new Date(iso);
  const hoje = new Date();
  const dias = Math.round((new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate()).getTime() - new Date(emitida.getFullYear(), emitida.getMonth(), emitida.getDate()).getTime()) / 86400000);
  if (dias <= 0) return 'hoje';
  return dias === 1 ? 'ontem' : `há ${dias} dias`;
}

function Peso({ e }: { e: Entrega }) {
  if (e.pesoKg === null) return <span className="ent-alerta">sem peso</span>;
  return (
    <>
      ≈ {numero(e.pesoKg, 1)} kg
      {e.itensSemPeso > 0 && <span className="cad-sub ent-alerta">{e.itensSemPeso} {e.itensSemPeso === 1 ? 'item' : 'itens'} sem peso</span>}
    </>
  );
}

export function EntregasNotasAEntregar() {
  const [dados, setDados] = useState<Resposta | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [origem, setOrigem] = useState('');
  const [busca, setBusca] = useState('');
  const [aberta, setAberta] = useState<string | null>(null);
  const fecharDetalhe = useCallback(() => setAberta(null), []);

  const carregar = useCallback(() => {
    api<Resposta>('/admin/entregas/notas-a-entregar').then((d) => { setDados(d); setErro(null); }).catch((e: Error) => setErro(e.message));
  }, []);
  useEffect(carregar, [carregar]);

  const origens = useMemo(() => [...new Set(dados?.entregas.map((e) => e.origem) ?? [])].sort(), [dados]);

  const grupos = useMemo(() => {
    const termo = semAcento(busca).trim().toUpperCase();
    const visiveis = (dados?.entregas ?? []).filter((e) => {
      if (origem && e.origem !== origem) return false;
      if (!termo) return true;
      const alvo = semAcento([e.cliente, e.endereco.bairro, e.endereco.cidade, e.endereco.logradouro, e.nota?.numero, e.pedidoNumero].filter(Boolean).join(' ')).toUpperCase();
      return alvo.includes(termo);
    });
    const mapa = new Map<string, { cidade: string; entregas: Entrega[] }>();
    for (const e of visiveis) {
      const chave = chaveCidade(e.endereco.cidade);
      const nome = e.endereco.cidade?.trim() || 'Sem cidade';
      const g = mapa.get(chave) ?? { cidade: nome, entregas: [] };
      // Mostra a grafia com acento e minúsculas quando alguma entrega tiver.
      if (!temMinuscula(g.cidade) && temMinuscula(nome)) g.cidade = nome;
      g.entregas.push(e);
      mapa.set(chave, g);
    }
    const lista = [...mapa.values()];
    for (const g of lista) {
      g.entregas.sort((a, b) => (a.endereco.bairro ?? '').localeCompare(b.endereco.bairro ?? '', 'pt-BR') || a.cliente.localeCompare(b.cliente, 'pt-BR'));
    }
    return lista.sort((a, b) => b.entregas.length - a.entregas.length || a.cidade.localeCompare(b.cidade, 'pt-BR'));
  }, [dados, origem, busca]);

  const totalVisivel = grupos.reduce((s, g) => s + g.entregas.length, 0);
  const r = dados?.resumo;

  return (
    <>
      <CabecalhoPagina
        titulo="Notas a entregar"
        subtitulo="Tudo que já foi faturado e ainda não saiu para entrega, do aplicativo, do site, dos vendedores e do televendas."
        acoes={<button type="button" className="cad-btn cad-btn-claro" onClick={carregar}>Atualizar</button>}
      />
      {erro && <div className="cad-erro">{erro}</div>}

      {r && (
        <div className="grid-indicadores">
          <Cartao className="indicador">
            <div><div className="rotulo">Entregas aguardando</div><div className="valor">{numero(r.entregas)}</div></div>
          </Cartao>
          <Cartao className="indicador">
            <div><div className="rotulo">Volumes (caixas e fardos)</div><div className="valor">{numero(r.volumes, 1)}</div></div>
          </Cartao>
          <Cartao className="indicador">
            <div>
              <div className="rotulo">Peso estimado</div>
              <div className="valor">≈ {numero(r.pesoKg)} kg</div>
              {r.comPesoIncompleto > 0 && <div className="nota ent-alerta">{r.comPesoIncompleto} {r.comPesoIncompleto === 1 ? 'entrega tem' : 'entregas têm'} item sem peso</div>}
            </div>
          </Cartao>
          <Cartao className="indicador">
            <div>
              <div className="rotulo">Sem ponto no mapa</div>
              <div className="valor">{numero(r.semLocalizacao)}</div>
              <div className="nota">entram na carga pelo bairro</div>
            </div>
          </Cartao>
        </div>
      )}

      {dados && dados.entregas.length > 0 && (
        <div className="cad-filtros">
          <input type="search" aria-label="Buscar" placeholder="Buscar cliente, bairro ou nota" value={busca} onChange={(e) => setBusca(e.target.value)} />
          <div className="cad-chips" style={{ margin: 0 }} role="group" aria-label="Origem do pedido">
            <button type="button" className={`cad-chip${origem === '' ? ' ativo' : ''}`} aria-pressed={origem === ''} onClick={() => setOrigem('')}>Todas</button>
            {origens.map((o) => (
              <button key={o} type="button" className={`cad-chip${origem === o ? ' ativo' : ''}`} aria-pressed={origem === o} onClick={() => setOrigem(o)}>{rotuloOrigem(o)[0]}</button>
            ))}
          </div>
        </div>
      )}

      {dados === null && !erro ? <Cartao><Vazio mensagem="Carregando…" /></Cartao>
        : dados && dados.entregas.length === 0 ? <Cartao><Vazio mensagem="Nenhuma nota faturada aguardando entrega. Elas aparecem aqui assim que o ERP avisa o faturamento." /></Cartao>
        : dados && totalVisivel === 0 ? <Cartao><Vazio mensagem="Nenhuma entrega com esse filtro." /></Cartao>
        : dados && (
          <div className="tabela-vendas-wrap">
            <table className="tabela-vendas ent-tabela">
              <thead>
                <tr><th>Cliente</th><th>Bairro</th><th>Nota</th><th>Veio de</th><th className="num">Volumes</th><th className="num">Peso estimado</th></tr>
              </thead>
              <tbody>
                {grupos.map((g) => {
                  const peso = g.entregas.reduce((s, e) => s + (e.pesoKg ?? 0), 0);
                  const volumes = g.entregas.reduce((s, e) => s + e.volumes, 0);
                  return [
                    <tr key={`g-${g.cidade}`} className="ent-grupo">
                      <th colSpan={4} scope="colgroup">{g.cidade} <small>{g.entregas.length} {g.entregas.length === 1 ? 'entrega' : 'entregas'}</small></th>
                      <td className="num">{numero(volumes, 1)}</td>
                      <td className="num">≈ {numero(peso)} kg</td>
                    </tr>,
                    ...g.entregas.map((e) => {
                      const [rotulo, variante] = rotuloOrigem(e.origem);
                      return (
                        <tr key={e.id}>
                          <td className="ent-quebra ent-cliente">
                            <button type="button" className="ent-abrir" onClick={() => setAberta(e.id)}>{e.cliente}</button>
                            <span className="cad-sub">{[e.endereco.logradouro, e.endereco.numero].filter(Boolean).join(', ') || 'endereço não informado'}</span>
                          </td>
                          <td className="ent-quebra">{e.endereco.bairro ?? <span className="cad-fraco">-</span>}</td>
                          <td title={e.emitidaEm ? `Emitida em ${formatarDataHora(e.emitidaEm)}` : undefined}>
                            {e.nota ? e.nota.numero : <span className="ent-alerta">nota não recebida</span>}
                            <span className="cad-sub">{[e.pedidoNumero && `pedido ${e.pedidoNumero}`, e.emitidaEm && idadeDaNota(e.emitidaEm)].filter(Boolean).join(' · ')}</span>
                          </td>
                          <td><Selo variante={variante}>{rotulo}</Selo></td>
                          <td className="num">{numero(e.volumes, 1)}</td>
                          <td className="num"><Peso e={e} /></td>
                        </tr>
                      );
                    }),
                  ];
                })}
              </tbody>
            </table>
          </div>
        )}
      <DetalheEntrega entregaId={aberta} onFechar={fecharDetalhe} />
    </>
  );
}
