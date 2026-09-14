-- Fotos de produto padronizadas (1000x1000 + miniatura 300x300 geradas pela API no upload).
-- url_miniatura nula = foto antiga ainda não reprocessada; o app usa url como fallback.
alter table produto_imagens add column if not exists url_miniatura text;
