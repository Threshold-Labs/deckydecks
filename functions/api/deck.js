export async function onRequestPut({ request, env }) {
  try {
    const deck = await request.json();

    if (!deck || !deck.meta || !deck.nodes) {
      return Response.json({ error: 'Invalid deck: missing meta or nodes' }, { status: 400 });
    }

    const slug = (deck.meta.title || 'deck').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const deckId = `${slug}-${Date.now().toString(36)}`;
    const deviceId = request.headers.get('X-Device-Id') || 'anonymous';
    const r2Key = `decks/${deviceId}/${slug}.json`;

    // Extract user ID from auth header if present
    let userId = null;
    const authHeader = request.headers.get('Authorization') || '';
    if (authHeader.startsWith('Bearer thld_ut_')) {
      userId = authHeader.substring(7, 47);
    }

    // Strip internal properties before saving
    const cleanDeck = { ...deck };
    delete cleanDeck._remoteId;

    await env.STORAGE.put(r2Key, JSON.stringify(cleanDeck, null, 2), {
      customMetadata: { title: deck.meta.title || '', nodeCount: String(Object.keys(deck.nodes).length) },
    });

    await env.DB.prepare(`
      INSERT INTO decks (id, title, node_count, r2_key, device_id, user_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(
      deckId,
      deck.meta.title || slug,
      Object.keys(deck.nodes).length,
      r2Key,
      deviceId,
      userId,
    ).run();

    return Response.json({ deckId });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
