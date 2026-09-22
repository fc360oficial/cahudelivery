import { useEffect, useState } from 'react';
import { api, fmtDocumento } from './api';

interface Ficha {
  id: string;
  tipo: string;
  documento: string;
  razao_social: string | null;
  nome_fantasia: string;
  inscricao_estadual: string | null;
  cep: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  codigo_municipio: string | null;
  municipio_tentativas: number | null;
}

/**
 * Linha "rótulo + valor + copiar". Valor ausente não ganha botão de copiar.
 * `copiarValor` permite copiar algo diferente do texto exibido (ex.: código
 * do município sem a cidade/UF junto); default é o próprio `valor`.
 * `ausente` troca o texto mostrado quando não há valor (default "—").
 */
function Campo({
  rotulo,
  valor,
  copiarValor,
  ausente = '—',
}: {
  rotulo: string;
  valor: string | null;
  copiarValor?: string | null;
  ausente?: string;
}) {
  const [copiado, setCopiado] = useState(false);
  const paraCopiar = copiarValor !== undefined ? copiarValor : valor;

  async function copiar() {
    if (!paraCopiar) return;
    try {
      await navigator.clipboard.writeText(paraCopiar);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1200);
    } catch {
      // Navegador sem permissão de área de transferência: o valor continua na tela para copiar à mão.
    }
  }

  return (
    <div className="ficha-linha">
      <span className="ficha-rotulo">{rotulo}</span>
      <span className="ficha-valor">{valor ?? ausente}</span>
      {paraCopiar && (
        <button className="btn-mini" onClick={copiar} title={`Copiar ${rotulo}`}>
          {copiado ? 'Copiado' : 'Copiar'}
        </button>
      )}
    </div>
  );
}

export function FichaCliente({ id, onFechar }: { id: string; onFechar: () => void }) {
  const [ficha, setFicha] = useState<Ficha | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    api<Ficha>(`/admin/clientes/${id}/ficha`).then(setFicha).catch((e) => setErro((e as Error).message));
  }, [id]);

  useEffect(() => {
    function aoTeclar(e: KeyboardEvent) {
      if (e.key === 'Escape') onFechar();
    }
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [onFechar]);

  const municipioTexto = ficha?.codigo_municipio
    ? `${ficha.codigo_municipio} · ${ficha.cidade ?? ''}/${ficha.uf ?? ''}`
    : null;

  // Sem código: distingue "worker ainda tentando" de "worker desistiu" (5
  // tentativas) de "não há endereço" (tentativas null) — não pode dizer
  // "buscando" para sempre depois que o worker já aposentou o endereço.
  const municipioAusente =
    ficha?.municipio_tentativas == null
      ? '—'
      : ficha.municipio_tentativas >= 5
        ? '— (não encontrado)'
        : '— (buscando)';

  const logradouro = ficha?.logradouro
    ? [ficha.logradouro, ficha.numero, ficha.complemento].filter(Boolean).join(', ')
    : null;

  return (
    <div className="modal-fundo" onClick={onFechar}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-cab">
          <strong>Ficha — {ficha?.nome_fantasia ?? '…'}</strong>
          <button className="btn-mini" onClick={onFechar}>Fechar</button>
        </div>

        {erro && <div className="erro-texto">{erro}</div>}
        {!ficha && !erro && <div className="vazio">Carregando…</div>}

        {ficha && (
          <>
            <div className="ficha-bloco">DADOS FISCAIS</div>
            <Campo rotulo={ficha.tipo === 'CNPJ' ? 'CNPJ' : 'CPF'} valor={fmtDocumento(ficha.documento)} />
            {ficha.tipo === 'CNPJ' && <Campo rotulo="Razão social" valor={ficha.razao_social} />}
            <Campo rotulo="Nome fantasia" valor={ficha.nome_fantasia} />
            {ficha.tipo === 'CNPJ' && <Campo rotulo="Inscrição Estadual" valor={ficha.inscricao_estadual} />}
            <Campo
              rotulo="Cód. município"
              valor={municipioTexto}
              copiarValor={ficha.codigo_municipio}
              ausente={municipioAusente}
            />

            <div className="ficha-bloco">ENDEREÇO</div>
            <Campo rotulo="CEP" valor={ficha.cep} />
            <Campo rotulo="Logradouro" valor={logradouro} />
            <Campo rotulo="Bairro" valor={ficha.bairro} />
            <Campo rotulo="Cidade/UF" valor={ficha.cidade ? `${ficha.cidade}/${ficha.uf ?? ''}` : null} />
          </>
        )}
      </div>
    </div>
  );
}
