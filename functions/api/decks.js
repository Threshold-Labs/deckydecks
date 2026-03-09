export async function onRequestGet({ env, request }) {
  const deviceId = request.headers.get('X-Device-Id') || null;

  // Extract user ID from auth header if present
  let userId = null;
  const authHeader = request.headers.get('Authorization') || '';
  if (authHeader.startsWith('Bearer thld_ut_')) {
    userId = authHeader.substring(7, 47);
  }

  // Show decks belonging to this device, this user, or unowned (legacy)
  let result;
  if (deviceId && userId) {
    result = await env.DB.prepare(
      'SELECT id, title, node_count, r2_key, device_id, user_id, created_at, updated_at FROM decks WHERE device_id = ? OR user_id = ? OR (device_id IS NULL AND user_id IS NULL) ORDER BY updated_at DESC'
    ).bind(deviceId, userId).all();
  } else if (deviceId) {
    result = await env.DB.prepare(
      'SELECT id, title, node_count, r2_key, device_id, user_id, created_at, updated_at FROM decks WHERE device_id = ? OR (device_id IS NULL AND user_id IS NULL) ORDER BY updated_at DESC'
    ).bind(deviceId).all();
  } else {
    result = await env.DB.prepare(
      'SELECT id, title, node_count, r2_key, device_id, user_id, created_at, updated_at FROM decks ORDER BY updated_at DESC LIMIT 50'
    ).all();
  }

  return Response.json(result.results);
}
