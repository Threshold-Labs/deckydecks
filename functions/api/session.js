export async function onRequestPost({ request, env }) {
  try {
    const session = await request.json();
    const deviceId = request.headers.get('X-Device-Id') || null;

    await env.DB.prepare(`
      INSERT INTO sessions (session_id, deck_title, started_at, ended_at, duration_ms, path, branch_decisions, last_node, completed, dwell_times, engaged_times, idle_times, device_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      session.sessionId,
      session.deckTitle || null,
      session.startedAt || null,
      session.endedAt || new Date().toISOString(),
      session.totalDurationMs || 0,
      JSON.stringify(session.path || []),
      JSON.stringify(session.branchDecisions || []),
      session.lastNode || null,
      session.completed ? 1 : 0,
      JSON.stringify(session.dwellTimes || {}),
      JSON.stringify(session.engagedTimes || {}),
      JSON.stringify(session.idleTimes || {}),
      deviceId,
    ).run();

    return Response.json({ ok: true, sessionId: session.sessionId });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 400 });
  }
}
