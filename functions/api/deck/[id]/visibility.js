export async function onRequestPut({ params, request, env }) {
  const deckId = params.id;
  const { visibility } = await request.json();

  if (!['public', 'login'].includes(visibility)) {
    return Response.json({ error: 'Invalid visibility. Must be "public" or "login".' }, { status: 400 });
  }

  // Verify deck exists and caller owns it
  const deck = await env.DB.prepare('SELECT device_id, user_id FROM decks WHERE id = ?').bind(deckId).first();
  if (!deck) {
    return Response.json({ error: 'Deck not found' }, { status: 404 });
  }

  const callerDevice = request.headers.get('X-Device-Id') || null;
  const authHeader = request.headers.get('Authorization') || '';
  let callerUser = null;
  if (authHeader.startsWith('Bearer thld_ut_')) {
    callerUser = authHeader.substring(7, 47);
  }

  // Only the owner can change visibility
  const isOwner = (callerDevice && deck.device_id === callerDevice) ||
                  (callerUser && deck.user_id === callerUser) ||
                  (!deck.device_id && !deck.user_id); // legacy unowned decks
  if (!isOwner) {
    return Response.json({ error: 'Not authorized to modify this deck' }, { status: 403 });
  }

  await env.DB.prepare('UPDATE decks SET visibility = ?, updated_at = datetime(?) WHERE id = ?')
    .bind(visibility, new Date().toISOString(), deckId)
    .run();

  return Response.json({ ok: true, visibility });
}
