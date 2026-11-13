import { describe, expect, it, vi } from 'vitest';
import { decidirSessao } from './estado-sessao';

const AGORA = 1_800_000_000_000;
const jwt = (expSegundos: number) =>
  `h.${Buffer.from(JSON.stringify({ exp: expSegundos })).toString('base64url')}.s`;
const VALIDO = jwt(AGORA / 1000 + 600);
const VENCIDO = jwt(AGORA / 1000 - 10);

describe('decidirSessao', () => {
  it('sem cookies: visitante, sem chamar a API', async () => {
    const renovar = vi.fn();
    expect(await decidirSessao({ acesso: null, renova: null }, AGORA, renovar)).toEqual({ estado: 'visitante' });
    expect(renovar).not.toHaveBeenCalled();
  });

  it('access token válido: logado com ele', async () => {
    const renovar = vi.fn();
    expect(await decidirSessao({ acesso: VALIDO, renova: 'r' }, AGORA, renovar))
      .toEqual({ estado: 'logado', token: VALIDO });
    expect(renovar).not.toHaveBeenCalled();
  });

  it('access ausente + refresh aceito: logado com o token novo', async () => {
    const renovar = vi.fn().mockResolvedValue('novo');
    expect(await decidirSessao({ acesso: null, renova: 'r' }, AGORA, renovar)).toEqual({ estado: 'logado', token: 'novo' });
    expect(renovar).toHaveBeenCalledWith('r');
  });

  it('access ausente + refresh recusado (401): expirada, não visitante', async () => {
    const renovar = vi.fn().mockResolvedValue(null);
    expect(await decidirSessao({ acesso: null, renova: 'lixo' }, AGORA, renovar)).toEqual({ estado: 'expirada' });
  });

  it('só access vencido, sem refresh: expirada', async () => {
    const renovar = vi.fn();
    expect(await decidirSessao({ acesso: VENCIDO, renova: null }, AGORA, renovar)).toEqual({ estado: 'expirada' });
  });

  it('refresh falha por outro motivo: o erro sobe', async () => {
    const renovar = vi.fn().mockRejectedValue(new Error('API fora'));
    await expect(decidirSessao({ acesso: null, renova: 'r' }, AGORA, renovar)).rejects.toThrow('API fora');
  });
});
