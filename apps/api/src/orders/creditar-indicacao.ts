interface Queryable {
  query(text: string, params?: unknown[]): Promise<{ rows: any[] }>;
}

/**
 * Credita R$100 na carteira de quem indicou, na primeira vez que o pedido
 * do indicado chega a FATURADO. indicacao_creditada_em funciona como lock —
 * garante que isso dispara uma única vez por indicado, não importa quantos
 * pedidos ele faça depois nem quantas vezes o status for resincronizado.
 * Compartilhado entre o OutboxWorker (polling do adaptador) e o inbound do
 * Dlinks (POST /pedidos-faturados) — os dois caminhos levam um pedido a
 * FATURADO e precisam do mesmo efeito colateral.
 */
export async function creditarIndicacao(pool: Queryable, pedidoId: string) {
  const { rows } = await pool.query(
    `select c.id as indicado_id, c.nome_fantasia as indicado_nome, c.indicado_por_cliente_id
       from pedidos p join clientes c on c.id = p.cliente_id
      where p.id = $1 and c.indicado_por_cliente_id is not null and c.indicacao_creditada_em is null`,
    [pedidoId],
  );
  const r = rows[0];
  if (!r) return;
  await pool.query(`insert into carteira_movimentos (cliente_id, valor, motivo) values ($1, 100, $2)`, [
    r.indicado_por_cliente_id,
    `Indicação: ${r.indicado_nome}`,
  ]);
  await pool.query(`update clientes set indicacao_creditada_em = now() where id = $1`, [r.indicado_id]);
}
