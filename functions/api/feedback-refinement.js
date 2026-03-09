export async function onRequestGet({ env, request }) {
  try {
    const url = new URL(request.url);
    const deckFilter = url.searchParams.get('deck');

    // Find the most recent "Feedback Review" session
    const session = (await env.DB.prepare(
      `SELECT * FROM sessions WHERE deck_title = 'Feedback Review' ORDER BY created_at DESC LIMIT 1`
    ).all()).results[0];

    if (!session) {
      return Response.json({ error: 'No feedback review session found' }, { status: 404 });
    }

    // Parse branch decisions
    let decisions;
    try {
      decisions = JSON.parse(session.branch_decisions || '{}');
    } catch {
      decisions = {};
    }

    // Filter for feedback triage decisions (those with contextKey/contextValue pattern fb-N)
    const accepted = [];
    const skipped = [];
    const rejected = [];

    for (const [nodeId, decision] of Object.entries(decisions)) {
      if (!decision || typeof decision !== 'object') continue;

      const key = decision.contextKey || '';
      const value = decision.contextValue || '';

      // Match fb-N pattern from the feedback deck builder
      if (!key.match(/^fb-\d+$/)) continue;

      const feedbackText = decision.nodeTitle
        ? decision.nodeTitle.replace(/^"|"$/g, '')
        : nodeId;

      if (value === 'accept') {
        accepted.push(feedbackText);
      } else if (value === 'skip') {
        skipped.push(feedbackText);
      } else if (value === 'reject') {
        rejected.push(feedbackText);
      }
    }

    // Build refinement prompt
    let refinementPrompt = '';
    if (accepted.length > 0) {
      const bullets = accepted.map(t => `- ${t}`).join('\n');
      const deckTarget = deckFilter ? ` for "${deckFilter}"` : '';
      refinementPrompt = `Based on user feedback${deckTarget}, make these changes:\n${bullets}`;
      if (rejected.length > 0) {
        const rejectedBullets = rejected.map(t => `- ${t}`).join('\n');
        refinementPrompt += `\n\nThe following feedback was explicitly rejected (do NOT implement):\n${rejectedBullets}`;
      }
    }

    return Response.json({
      sessionId: session.session_id,
      reviewedAt: session.created_at,
      accepted,
      skipped,
      rejected,
      refinementPrompt,
    });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
