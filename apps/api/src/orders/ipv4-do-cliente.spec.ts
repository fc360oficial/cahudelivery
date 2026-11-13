import type { Request } from 'express';
import { ipv4DoCliente } from './orders.controller';

const req = (xff: string | undefined, socket: string | undefined) =>
  ({ headers: xff === undefined ? {} : { 'x-forwarded-for': xff }, socket: { remoteAddress: socket } }) as unknown as Request;

describe('ipv4DoCliente', () => {
  it('IPv4 encaminhado: usa o primeiro da lista', () => {
    expect(ipv4DoCliente(req('200.1.2.3, 10.0.0.1', '127.0.0.1'))).toBe('200.1.2.3');
  });

  it('IPv4 mapeado em IPv6 no encaminhado: devolve o IPv4', () => {
    expect(ipv4DoCliente(req('::ffff:200.1.2.3', '127.0.0.1'))).toBe('200.1.2.3');
  });

  it('IPv6 encaminhado sem IPv4 mapeado: null, nunca o endereço do socket', () => {
    expect(ipv4DoCliente(req('2804:14c:1:2::5', '127.0.0.1'))).toBeNull();
    expect(ipv4DoCliente(req('2804:14c:1:2::5, 10.0.0.1', '::ffff:10.0.0.9'))).toBeNull();
  });

  it('sem X-Forwarded-For: usa o socket', () => {
    expect(ipv4DoCliente(req(undefined, '::ffff:189.4.5.6'))).toBe('189.4.5.6');
    expect(ipv4DoCliente(req(undefined, '::1'))).toBeNull();
  });
});
