export async function onRequestGet() {
  return Response.json({ status: 'ok', engine: 'cloudflare-worker' });
}
