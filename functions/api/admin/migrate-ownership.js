export async function onRequestPost({ request, env }) {
  try {
    const { deviceId, userId } = await request.json();

    if (!deviceId && !userId) {
      return Response.json({ error: 'Must provide deviceId or userId' }, { status: 400 });
    }

    const claimAll = request.headers.get('X-Claim-All') === 'true';

    let result;
    if (claimAll) {
      // Claim ALL decks (admin bootstrap)
      result = await env.DB.prepare(`
        UPDATE decks SET device_id = ?, user_id = ?, updated_at = datetime('now')
      `).bind(deviceId || null, userId || null).run();
    } else {
      // Claim only unowned decks
      result = await env.DB.prepare(`
        UPDATE decks
        SET device_id = ?, user_id = ?, updated_at = datetime('now')
        WHERE (device_id IS NULL OR device_id = '' OR device_id = 'anonymous' OR device_id = 'none')
          AND (user_id IS NULL OR user_id = '' OR user_id = 'none')
      `).bind(deviceId || null, userId || null).run();
    }

    return Response.json({ ok: true, changes: result.meta?.changes || 0 });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
