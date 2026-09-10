-- 019: login por documento. Email vira contato (opcional, pode repetir);
-- clientes sem senha (vindos do Dlinks) ganham a senha inicial provisória 123456.

alter table clientes alter column email drop not null;
alter table clientes drop constraint if exists clientes_email_key;

alter table cliente_credenciais
  add column if not exists senha_provisoria boolean not null default false;

-- placeholders criados pela sync do Dlinks viram "sem email"
update clientes set email = null where email like '%@sem-email.dlinks.local';

-- hash argon2id de "123456" (qualquer hash válido serve para todas as linhas)
insert into cliente_credenciais (cliente_id, senha_hash, senha_provisoria)
select c.id, '$argon2id$v=19$m=65536,t=3,p=4$pCZRHLzsSCpZdEmlsECCCQ$NK4iz/FLAA2F0F6FWh586R2IWIku7HlwPIwqyH30+Ic', true
  from clientes c
 where not exists (select 1 from cliente_credenciais cc where cc.cliente_id = c.id);
