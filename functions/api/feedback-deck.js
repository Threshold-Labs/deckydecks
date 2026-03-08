function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export async function onRequestGet({ env, request }) {
  try {
    const url = new URL(request.url);
    const filterDeck = url.searchParams.get('deck');

    // Query feedback
    let feedback;
    if (filterDeck) {
      feedback = (await env.DB.prepare('SELECT * FROM feedback WHERE deck_title = ? ORDER BY created_at').bind(filterDeck).all()).results;
    } else {
      feedback = (await env.DB.prepare('SELECT * FROM feedback ORDER BY created_at').all()).results;
    }

    // Query sessions
    const sessions = (await env.DB.prepare('SELECT * FROM sessions ORDER BY created_at').all()).results;

    // Group feedback by deck
    const byDeck = {};
    for (const f of feedback) {
      const deck = f.deck_title || 'Unknown';
      if (!byDeck[deck]) byDeck[deck] = [];
      byDeck[deck].push(f);
    }

    // Group sessions by deck
    const sessionsByDeck = {};
    for (const s of sessions) {
      const deck = s.deck_title || 'Unknown';
      if (!sessionsByDeck[deck]) sessionsByDeck[deck] = [];
      sessionsByDeck[deck].push(s);
    }

    const nodes = {};
    const deckList = Object.keys(byDeck);

    if (deckList.length === 0) {
      return Response.json({
        meta: { title: 'No Feedback Yet', author: 'DeckyDecks', startNode: 'empty' },
        nodes: { empty: { type: 'hero', title: 'No feedback collected yet.', subtitle: 'Navigate some decks and leave feedback to see it here.', next: null } }
      });
    }

    // Opening
    nodes['fb-open'] = {
      type: 'hero',
      title: 'Feedback Review',
      subtitle: `${feedback.length} feedback entries across ${deckList.length} deck(s). ${sessions.length} total sessions recorded.`,
      next: deckList.length === 1 ? `fb-deck-${slugify(deckList[0])}` : 'fb-choose-deck'
    };

    // Branch to choose deck if multiple
    if (deckList.length > 1) {
      nodes['fb-choose-deck'] = {
        type: 'branch',
        title: 'Which deck do you want to review?',
        subtitle: 'Each deck has its own feedback stream.',
        branches: deckList.map(d => {
          const deckSessions = sessionsByDeck[d] || [];
          const completed = deckSessions.filter(s => s.completed).length;
          return {
            label: d,
            desc: `${byDeck[d].length} feedback, ${deckSessions.length} sessions (${completed} completed)`,
            target: `fb-deck-${slugify(d)}`
          };
        })
      };
    }

    // Per-deck feedback nodes
    for (const deckTitle of deckList) {
      const items = byDeck[deckTitle];
      const deckSlug = slugify(deckTitle);
      const deckSessions = sessionsByDeck[deckTitle] || [];

      const completionRate = deckSessions.length > 0
        ? Math.round((deckSessions.filter(s => s.completed).length / deckSessions.length) * 100)
        : 0;
      const avgDuration = deckSessions.length > 0
        ? Math.round(deckSessions.reduce((a, s) => a + (s.duration_ms || 0), 0) / deckSessions.length / 1000)
        : 0;

      // Dropout points
      const dropouts = {};
      for (const s of deckSessions) {
        if (!s.completed && s.last_node) {
          dropouts[s.last_node] = (dropouts[s.last_node] || 0) + 1;
        }
      }

      const statsBullets = [
        `<strong>${deckSessions.length}</strong> sessions, <strong>${completionRate}%</strong> completion rate`,
        `<strong>${avgDuration}s</strong> average session duration`,
      ];
      if (Object.keys(dropouts).length > 0) {
        const topDropout = Object.entries(dropouts).sort((a, b) => b[1] - a[1])[0];
        statsBullets.push(`<strong>Top dropout:</strong> ${topDropout[0]} (${topDropout[1]} exits)`);
      }

      nodes[`fb-deck-${deckSlug}`] = {
        type: 'content',
        title: `${deckTitle} — Session Stats`,
        body: `<p>${items.length} feedback entries from ${deckSessions.length} sessions.</p>`,
        bullets: statsBullets,
        next: `fb-item-${deckSlug}-0`
      };

      // Each feedback item as accept/skip/reject branch
      items.forEach((item, i) => {
        const nodeId = `fb-item-${deckSlug}-${i}`;
        const nextNodeId = i < items.length - 1 ? `fb-item-${deckSlug}-${i + 1}` : `fb-summary-${deckSlug}`;
        const pathArr = typeof item.path_taken === 'string' ? JSON.parse(item.path_taken || '[]') : (item.path_taken || []);
        const pathStr = pathArr.join(' → ') || 'unknown path';

        nodes[nodeId] = {
          type: 'branch',
          title: `"${item.text}"`,
          subtitle: `Left at node: ${item.current_node || 'unknown'} | Path: ${pathStr}`,
          branches: [
            { label: 'Accept this feedback', desc: 'Include in refinement prompt', target: nextNodeId, contextKey: `fb-${i}`, contextValue: 'accept' },
            { label: 'Note but skip', desc: 'Interesting but not actionable now', target: nextNodeId, contextKey: `fb-${i}`, contextValue: 'skip' },
            { label: 'Disagree', desc: "This doesn't match the intent", target: nextNodeId, contextKey: `fb-${i}`, contextValue: 'reject' }
          ]
        };
      });

      nodes[`fb-summary-${deckSlug}`] = {
        type: 'hero',
        title: `Review complete for ${deckTitle}`,
        subtitle: 'Your accept/skip/reject choices have been recorded. Use the analytics export to generate a refinement prompt.',
        next: null
      };
    }

    return Response.json({
      meta: { title: 'Feedback Review', author: 'DeckyDecks', startNode: 'fb-open' },
      nodes
    });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
