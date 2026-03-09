export async function onRequestGet({ params, request, env }) {
  const deckId = params.id;

  // Look up in D1 for R2 key and visibility
  const row = await env.DB.prepare('SELECT r2_key, visibility, device_id, user_id FROM decks WHERE id = ?').bind(deckId).first();
  if (!row) {
    return Response.json({ error: 'Deck not found' }, { status: 404 });
  }

  // Enforce visibility
  if (row.visibility === 'login') {
    const authHeader = request.headers.get('Authorization') || '';
    if (!authHeader.startsWith('Bearer thld_ut_')) {
      return Response.json({ error: 'This deck requires login to view' }, { status: 401 });
    }
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
