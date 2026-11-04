-- infra/sql/tenant/033_codigo_acesso.sql
-- Acesso do cliente sem senha padrão (03/11/2026):
--  * a retaguarda gera um código de uso único; com ele o cliente cria a senha
--    (primeiro acesso de quem veio do ERP e "esqueci minha senha");
--  * auth_tentativas limita erros de login e de código, por documento e por IP;
--  * quem ainda estava com a senha 123456 perde essa senha e as sessões abertas.

alter table cliente_credenciais add column if not exists senha_definida_em timestamptz;

-- Um código válido por cliente: gerar outro substitui o anterior. Guarda só o hash.
create table if not exists cliente_codigos_acesso (
  cliente_id  uuid primary key references clientes(id),
  codigo_hash text not null,
  expira_em   timestamptz not null,
  usado_em    timestamptz,
  tentativas  int not null default 0,
  gerado_por  uuid references usuarios_admin(id),
  criado_em   timestamptz not null default now()
);

create table if not exists auth_tentativas (
  chave         text primary key,            -- doc:<cnpj/cpf>, admin:<email> ou ip:<ip>
  falhas        int not null default 0,
  janela_em     timestamptz not null default now(),
  bloqueado_ate timestamptz
);

-- Apaga em vez de revogar: o refresh aceita token revogado há menos de 30 s.
delete from refresh_tokens r
 using cliente_credenciais cc
 where cc.cliente_id = r.sujeito_id and r.sujeito = 'cliente' and cc.senha_provisoria;

-- Valor que não é um hash argon2: nenhuma senha confere com ele.
update cliente_credenciais set senha_hash = 'sem-senha' where senha_provisoria;
