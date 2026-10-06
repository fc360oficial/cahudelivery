import { EredeProvedor, mensagemRecusa, sanearNome, traduzirStatusErede } from './erede.provedor';

const cfg = { pv: '109038630', chaveIntegracao: 'chave-teste', softDescriptor: 'CAHUDELIVERY' };

const cartao = { numero: '5448280000000007', nome: 'JOAO DA SILVA', validadeMes: 12, validadeAno: 2028, cvv: '123' };

describe('EredeProvedor', () => {
  it('novaRef: 16 alfanuméricos com o número do pedido dentro (limite da e.Rede)', () => {
    const p = new EredeProvedor(cfg);
    const ref = p.novaRef(42);
    expect(ref).toHaveLength(16);
    expect(ref).toMatch(/^P000042[A-Za-z0-9]{9}$/);
    expect(p.novaRef(42)).not.toBe(ref); // cada tentativa tem referência própria
  });

  it('criarCobranca não chama rede: só abre a janela local, sem copia e cola', async () => {
    const p = new EredeProvedor(cfg);
    const chamar = jest.spyOn(p as any, 'chamar');
    const antes = Date.now();
    const c = await p.criarCobranca({ ref: 'P000042AAAAAAAAA', valor: 150.5, expiracaoSegundos: 1800, descricao: 'Pedido #42' });
    expect(chamar).not.toHaveBeenCalled();
    expect(c.copiaCola).toBeNull();
    expect(c.expiraEm.getTime()).toBeGreaterThanOrEqual(antes + 1800 * 1000);
  });

  it('cobrar aprovada: capture automática, valor em centavos e returnCode 00', async () => {
    const p = new EredeProvedor(cfg);
    const chamar = jest.spyOn(p as any, 'chamar').mockResolvedValue({
      status: 200,
      body: { returnCode: '00', tid: 'TID1', brand: { authorizationCode: 'A1' } },
      texto: '{}',
    });
    const r = await p.cobrar('P000042AAAAAAAAA', 150.5, cartao);
    expect(r.aprovado).toBe(true);
    expect(r.tid).toBe('TID1');
    expect(r.autorizacao).toBe('A1');
    const corpo = chamar.mock.calls[0][2] as any;
    expect(corpo.capture).toBe(true);
    expect(corpo.kind).toBe('credit');
    expect(corpo.amount).toBe(15050);
    expect(corpo.reference).toBe('P000042AAAAAAAAA');
    expect(corpo.softDescriptor).toBe('CAHUDELIVERY');
  });

  it('cobrar recusada: aprovado=false com mensagem amigável, sem exceção', async () => {
    const p = new EredeProvedor(cfg);
    jest.spyOn(p as any, 'chamar').mockResolvedValue({
      status: 200,
      body: { returnCode: '111', returnMessage: 'Unauthorized. Insufficient funds.', brand: { returnCode: '51' } },
      texto: '{}',
    });
    const r = await p.cobrar('P000042AAAAAAAAA', 150.5, cartao);
    expect(r.aprovado).toBe(false);
    expect(r.codigo).toBe('111');
    expect(r.mensagem).toContain('limite');
  });

  it('cobrar com erro de requisição (sem returnCode): exceção, não recusa', async () => {
    const p = new EredeProvedor(cfg);
    jest.spyOn(p as any, 'chamar').mockResolvedValue({ status: 400, body: null, texto: 'Bad Request' });
    await expect(p.cobrar('P000042AAAAAAAAA', 150.5, cartao)).rejects.toThrow('e.Rede transação 400');
  });

  it('consultar: 78 (transação não existe) fica pendente — cliente ainda não digitou o cartão', async () => {
    const p = new EredeProvedor(cfg);
    jest.spyOn(p as any, 'chamar').mockResolvedValue({ status: 404, body: { returnCode: '78' }, texto: '{}' });
    const s = await p.consultar('P000042AAAAAAAAA');
    expect(s.status).toBe('pendente');
  });

  it('traduz os status da e.Rede (Denied fica pendente: pode tentar outro cartão)', () => {
    expect(traduzirStatusErede({ authorization: { status: 'Pending' } }).status).toBe('pendente');
    expect(traduzirStatusErede({ authorization: { status: 'Denied' } }).status).toBe('pendente');
    expect(traduzirStatusErede({ authorization: { status: 'Canceled' } }).status).toBe('cancelado');
    const pago = traduzirStatusErede({
      authorization: { status: 'Approved', amount: 15050 },
      capture: { amount: 15050, dateTime: '2026-10-06T10:00:00-03:00' },
    });
    expect(pago.status).toBe('pago');
    expect(pago.valorPago).toBe(150.5);
    expect(pago.pagoEm).toEqual(new Date('2026-10-06T10:00:00-03:00'));
  });

  it('tratarWebhook sempre vazio: cartão não tem webhook, a confirmação é síncrona', () => {
    expect(new EredeProvedor(cfg).tratarWebhook()).toEqual([]);
  });

  it('sanearNome tira acento, caracteres especiais e corta em 30', () => {
    expect(sanearNome('João d’Ávila-Souza')).toBe('Joao dAvilaSouza');
    expect(sanearNome('  Maria   José  ')).toBe('Maria Jose');
    expect(sanearNome('A'.repeat(40))).toHaveLength(30);
  });

  it('mensagemRecusa mapeia os casos que mudam a ação do cliente', () => {
    expect(mensagemRecusa('111')).toContain('limite');
    expect(mensagemRecusa('58', '54')).toContain('vencido');
    expect(mensagemRecusa('119')).toContain('segurança');
    expect(mensagemRecusa('999')).toContain('recusado pelo emissor');
  });
});
