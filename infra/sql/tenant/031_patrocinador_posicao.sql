-- Posição da vitrine patrocinada na Home (30/09/2026, pedido do Tiago):
--   topo          = antes de tudo (acima das Ofertas da Semana)
--   ofertas       = logo depois do bloco Ofertas da Semana
--   mais_vendidos = depois de Mais vendidos / Vencimento Próximo, antes das prateleiras (comportamento antigo do "topo")
--   categoria     = depois da categoria em apos_categoria_id
alter table patrocinadores add column if not exists posicao text not null default 'mais_vendidos';
alter table patrocinadores drop constraint if exists patrocinadores_posicao_chk;
alter table patrocinadores add constraint patrocinadores_posicao_chk
  check (posicao in ('topo', 'ofertas', 'mais_vendidos', 'categoria'));
update patrocinadores set posicao = 'categoria' where apos_categoria_id is not null and posicao = 'mais_vendidos';
insert into schema_migrations (versao) values ('031') on conflict do nothing;
