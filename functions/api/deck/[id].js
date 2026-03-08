export async function onRequestGet({ params, env }) {
  const deckId = params.id;

  // Look up in D1 for R2 key
  const row = await env.DB.prepare('SELECT r2_key FROM decks WHERE id = ?').bind(deckId).first();
  if (!row) {
    return Response.json({ error: 'Deck not found' }, { status: 404 });
  }

  const obj = await env.STORAGE.get(row.r2_key);
  if (!obj) {
    return Response.json({ error: 'Deck data not found in storage' }, { status: 404 });
  }

  const body = await obj.text();
  return new Response(body, {
    headers: { 'Content-Type': 'application/json' },
  });
}
