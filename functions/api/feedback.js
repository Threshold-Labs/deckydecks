export async function onRequestPost({ request, env }) {
  try {
    const entry = await request.json();
    const deviceId = request.headers.get('X-Device-Id') || null;

    await env.DB.prepare(`
      INSERT INTO feedback (session_id, deck_title, current_node, text, path_taken, branch_choices, timestamp, device_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      entry.sessionId || null,
      entry.deckTitle || null,
      entry.currentNode || null,
      entry.text,
      JSON.stringify(entry.pathTaken || []),
      JSON.stringify(entry.branchChoices || []),
      entry.timestamp || new Date().toISOString(),
      deviceId,
    ).run();

    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 400 });
  }
}

export async function onRequestGet({ env, request }) {
  const url = new URL(request.url);
  const deckFilter = url.searchParams.get('deck');

  let result;
  if (deckFilter) {
    result = await env.DB.prepare('SELECT * FROM feedback WHERE deck_title = ? ORDER BY created_at DESC').bind(deckFilter).all();
  } else {
    result = await env.DB.prepare('SELECT * FROM feedback ORDER BY created_at DESC').all();
  }

  return Response.json(result.results);
}
