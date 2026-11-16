import type { Request } from 'express';
import { ipDaRequisicao } from '../auth/limite-auth.service';
import { ipv4DoCliente } from './orders.controller';

const req = (xff: string | undefined, socket: string | undefined) =>
  ({ headers: xff === undefined ? {} : { 'x-forwarded-for': xff }, socket: { remoteAddress: socket } }) as unknown as Request;

describe('ipv4DoCliente', () => {
  it('IPv4 encaminhado pelo Caddy ou pelo site (conexão local): usa o primeiro da lista', () => {
    expect(ipv4DoCliente(req('200.1.2.3, 10.0.0.1', '127.0.0.1'))).toBe('200.1.2.3');
    expect(ipv4DoCliente(req('200.1.2.3', '::1'))).toBe('200.1.2.3');
    expect(ipv4DoCliente(req('200.1.2.3', '::ffff:127.0.0.1'))).toBe('200.1.2.3');
  });

  it('IPv4 mapeado em IPv6 no encaminhado: devolve o IPv4', () => {
    expect(ipv4DoCliente(req('::ffff:200.1.2.3', '127.0.0.1'))).toBe('200.1.2.3');
  });

  it('IPv6 encaminhado sem IPv4 mapeado: null, nunca o endereço do socket', () => {
    expect(ipv4DoCliente(req('2804:14c:1:2::5', '127.0.0.1'))).toBeNull();
  });

  it('sem X-Forwarded-For: usa o socket', () => {
    expect(ipv4DoCliente(req(undefined, '::ffff:189.4.5.6'))).toBe('189.4.5.6');
    expect(ipv4DoCliente(req(undefined, '::1'))).toBeNull();
  });

  it('conexão direta na porta da API: ignora o X-Forwarded-For que o visitante escreveu', () => {
    expect(ipv4DoCliente(req('200.1.2.3', '::ffff:189.4.5.6'))).toBe('189.4.5.6');
    expect(ipv4DoCliente(req('2804:14c:1:2::5, 10.0.0.1', '::ffff:10.0.0.9'))).toBe('10.0.0.9');
  });
});

describe('ipDaRequisicao (chave do bloqueio por IP)', () => {
  it('atrás do Caddy ou do site: IP gravado no X-Forwarded-For', () => {
    expect(ipDaRequisicao(req('200.1.2.3', '127.0.0.1'))).toBe('200.1.2.3');
    expect(ipDaRequisicao(req('2804:14c:1:2::5', '::1'))).toBe('2804:14c:1:2::5');
  });

  it('direto na porta da API: trocar o cabeçalho a cada tentativa não muda a chave', () => {
    expect(ipDaRequisicao(req('1.1.1.1', '::ffff:189.4.5.6'))).toBe('189.4.5.6');
    expect(ipDaRequisicao(req('2.2.2.2', '::ffff:189.4.5.6'))).toBe('189.4.5.6');
    expect(ipDaRequisicao(req('3.3.3.3', '192.168.2.1'))).toBe('192.168.2.1');
  });

  it('conexão local sem encaminhado (script no próprio servidor): o próprio endereço local', () => {
    expect(ipDaRequisicao(req(undefined, '127.0.0.1'))).toBe('127.0.0.1');
  });

  it('sem endereço nenhum: "desconhecido"', () => {
    expect(ipDaRequisicao(req(undefined, undefined))).toBe('desconhecido');
  });
});
