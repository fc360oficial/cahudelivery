import { describe, expect, it } from 'vitest';
import { erroDaConta, senhaAtualRecusada } from './erros';

describe('erroDaConta', () => {
  it('400/401/403/409/422/429 levam a mensagem da API', () => {
    for (const s of [400, 401, 403, 409, 422, 429]) {
      expect(erroDaConta(s, 'Endereço já usado em pedidos')).toEqual({ status: s, corpo: { mensagem: 'Endereço já usado em pedidos' } });
    }
  });
  it('404 repassa o status com mensagem própria (não a da API)', () => {
    expect(erroDaConta(404, 'Cannot GET /v1/pedidos/x')).toEqual({ status: 404, corpo: { mensagem: 'Não encontrado.' } });
  });
  it('503 e o resto viram mensagem genérica, sem o texto da API', () => {
    expect(erroDaConta(503, 'ECONNREFUSED 10.0.0.5')).toEqual({ status: 503, corpo: { mensagem: 'Não foi possível falar com o servidor. Tente novamente.' } });
    expect(erroDaConta(500, 'stack trace')).toEqual({ status: 500, corpo: { mensagem: 'Não foi possível concluir agora. Tente novamente.' } });
    expect(erroDaConta(502, 'x').status).toBe(500);
  });
});

describe('senhaAtualRecusada', () => {
  it('401 com mensagem própria = senha atual errada; 401 do guard (Unauthorized) = sessão', () => {
    expect(senhaAtualRecusada(401, 'Senha atual incorreta')).toBe(true);
    expect(senhaAtualRecusada(401, 'Unauthorized')).toBe(false);
    expect(senhaAtualRecusada(400, 'Senha fraca')).toBe(false);
  });
});
