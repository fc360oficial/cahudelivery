import { EredeProvedor, corpo3ds, mensagemRecusa, sanearNome, traduzirEstorno, traduzirStatusErede } from './erede.provedor';

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
    expect(mensagemRecusa('999', undefined, '202')).toContain('banco não confirmou');
  });
});

describe('EredeProvedor 3DS', () => {
  const ctx = {
    ip: '177.10.20.30',
    userAgent: 'Mozilla/5.0 (Linux; Android 14) CAHUDelivery',
    dispositivo: { profundidadeCor: 24, altura: 2400, largura: 1080, idioma: 'pt-BR', fusoHoras: 3 },
    cobranca: { endereco: 'Rua São João, 10 - Boa Vista', cidade: 'Recife', cep: '50050000', uf: 'PE', email: 'a@b.com', telefone: '(81) 99999-0000' },
    urlSucesso: 'https://cahudelivery.duckdns.org/v1/pagamentos/3ds/cahu/ok',
    urlFalha: 'https://cahudelivery.duckdns.org/v1/pagamentos/3ds/cahu/falhou',
  };
  const cfg3ds = { ...cfg, tresDS: { ativo: true } };

  it('desligado: corpo igual ao de antes, sem bloco threeDSecure', async () => {
    const p = new EredeProvedor(cfg);
    expect(p.usa3ds).toBe(false);
    const chamar = jest.spyOn(p as any, 'chamar').mockResolvedValue({ status: 200, body: { returnCode: '00', tid: 'T' }, texto: '{}' });
    await p.cobrar('P000042AAAAAAAAA', 10, cartao, ctx);
    expect((chamar.mock.calls[0][2] as any).threeDSecure).toBeUndefined();
  });

  it('ligado: manda MPI da Rede, decline por padrão, aparelho, cobrança e URLs de retorno', async () => {
    const p = new EredeProvedor(cfg3ds);
    const chamar = jest.spyOn(p as any, 'chamar').mockResolvedValue({
      status: 200, body: { returnCode: '00', tid: 'T1', threeDSecure: { returnCode: '200' } }, texto: '{}',
    });
    const r = await p.cobrar('P000042AAAAAAAAA', 10, cartao, ctx);
    const corpo = chamar.mock.calls[0][2] as any;
    expect(corpo.threeDSecure.embedded).toBe(true);
    expect(corpo.threeDSecure.onFailure).toBe('decline');
    expect(corpo.threeDSecure.ipAddress).toBe('177.10.20.30');
    expect(corpo.threeDSecure.device).toEqual({
      colorDepth: 24, deviceType3ds: 'BROWSER', javaEnabled: false, language: 'pt-BR',
      screenHeight: 2400, screenWidth: 1080, timeZoneOffset: 3,
    });
    expect(corpo.threeDSecure.billing.postalCode).toBe('50050-000');
    expect(corpo.threeDSecure.billing.address).toBe('Rua Sao Joao, 10 - Boa Vista');
    expect(corpo.threeDSecure.billing.phoneNumber).toBe('81999990000');
    expect(corpo.urls).toEqual([
      { kind: 'threeDSecureSuccess', url: ctx.urlSucesso },
      { kind: 'threeDSecureFailure', url: ctx.urlFalha },
    ]);
    expect(r.aprovado).toBe(true);
    expect(r.codigo3ds).toBe('200');
  });

  it('ligado sem dados do aparelho: exceção (não cobra sem 3DS às escondidas)', async () => {
    const p = new EredeProvedor(cfg3ds);
    await expect(p.cobrar('P000042AAAAAAAAA', 10, cartao)).rejects.toThrow('3DS');
  });

  it('220 = desafio: devolve a URL do emissor, não aprova nem recusa', async () => {
    const p = new EredeProvedor(cfg3ds);
    jest.spyOn(p as any, 'chamar').mockResolvedValue({
      status: 200, body: { returnCode: '220', threeDSecure: { embedded: true, url: 'https://mpi.rede/auth?token=x' } }, texto: '{}',
    });
    const r = await p.cobrar('P000042AAAAAAAAA', 10, cartao, ctx);
    expect(r.aprovado).toBe(false);
    expect(r.urlAutenticacao).toBe('https://mpi.rede/auth?token=x');
  });

  it('URL de retorno acima de 87 caracteres: erro antes de chamar a Rede', async () => {
    const p = new EredeProvedor(cfg3ds);
    const chamar = jest.spyOn(p as any, 'chamar');
    await expect(p.cobrar('P000042AAAAAAAAA', 10, cartao, { ...ctx, urlSucesso: `https://x.com/${'a'.repeat(90)}` })).rejects.toThrow('87');
    expect(chamar).not.toHaveBeenCalled();
  });

  it('consulta devolve tid e o código do 3DS (estorno precisa do tid)', () => {
    const s = traduzirStatusErede({ authorization: { status: 'Approved', tid: 'TID9', amount: 1000 }, threeDSecure: { returnCode: '200' } });
    expect(s.tid).toBe('TID9');
    expect(s.codigo3ds).toBe('200');
  });
});

describe('EredeProvedor estorno', () => {
  it('POST /{tid}/refunds com valor em centavos', async () => {
    const p = new EredeProvedor(cfg);
    const chamar = jest.spyOn(p as any, 'chamar').mockResolvedValue({ status: 200, body: { returnCode: '359', refundId: 'R1' }, texto: '{}' });
    const r = await p.estornar('TID1', 150.5);
    expect(chamar).toHaveBeenCalledWith('POST', '/TID1/refunds', { amount: 15050 });
    expect(r.status).toBe('concluido');
    expect(r.refundId).toBe('R1');
  });

  it('traduz os retornos de cancelamento da Rede', () => {
    expect(traduzirEstorno(200, { returnCode: '360' }).status).toBe('solicitado');
    expect(traduzirEstorno(200, { returnCode: '355' }).status).toBe('concluido'); // já cancelada
    const prazo = traduzirEstorno(200, { returnCode: '354' });
    expect(prazo.status).toBe('falhou');
    expect(prazo.tentarDeNovo).toBe(false);
    expect(prazo.mensagem).toContain('Prazo');
    expect(traduzirEstorno(200, { returnCode: '374' }).mensagem).toContain('chargeback');
    expect(traduzirEstorno(200, { returnCode: '370' }).tentarDeNovo).toBe(true);
    expect(traduzirEstorno(503, null).tentarDeNovo).toBe(true);
  });

  it('Rede fora do ar no estorno: falha passageira, sem exceção', async () => {
    const p = new EredeProvedor(cfg);
    jest.spyOn(p as any, 'chamar').mockRejectedValue(new Error('ECONNRESET'));
    const r = await p.estornar('TID1', 10);
    expect(r.status).toBe('falhou');
    expect(r.tentarDeNovo).toBe(true);
  });
});

describe('corpo3ds', () => {
  it('seFalhar continuar vira onFailure continue', () => {
    const c = corpo3ds(
      {
        ip: '1.2.3.4', userAgent: 'x', dispositivo: { profundidadeCor: 24, altura: 1, largura: 1, idioma: 'pt-BR', fusoHoras: 3 },
        cobranca: { endereco: '', cidade: '', cep: '', uf: '', email: '', telefone: '' }, urlSucesso: 'https://a/ok', urlFalha: 'https://a/f',
      },
      'continuar',
    );
    expect(c.threeDSecure.onFailure).toBe('continue');
  });
});
