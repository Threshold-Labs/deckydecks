export async function onRequestGet({ env, request }) {
  const url = new URL(request.url);
  const deviceId = request.headers.get('X-Device-Id') || null;

  let result;
  if (deviceId) {
    result = await env.DB.prepare('SELECT id, title, node_count, r2_key, created_at, updated_at FROM decks WHERE device_id = ? ORDER BY updated_at DESC').bind(deviceId).all();
  } else {
    result = await env.DB.prepare('SELECT id, title, node_count, r2_key, created_at, updated_at FROM decks ORDER BY updated_at DESC LIMIT 50').all();
  }

  return Response.json(result.results);
}
