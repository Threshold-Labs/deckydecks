function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function decomposeFeedback(text) {
  if (!text || typeof text !== 'string') return [];

  // Split on paragraph breaks first
  let chunks = text.split(/\n\n+/);

  // Further split each chunk on list markers and numbered lists
  let pieces = [];
  for (const chunk of chunks) {
    const subParts = chunk.split(/\n\s*[-*]\s+|\n\s*\d+[.)]\s+/);
    pieces.push(...subParts);
  }

  // Further split on sentence boundaries (". ", "! ") but not abbreviations
  let sentences = [];
  for (const piece of pieces) {
    const parts = piece.split(/(?<=[.!])\s+/);
    sentences.push(...parts);
  }

  // Clean up and filter short fragments
  return sentences
    .map(s => s.replace(/^[-*•]\s*/, '').trim())
    .filter(s => s.length >= 15);
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

      // Decompose each feedback item into discrete claims, then build branch nodes
      let claimIndex = 0;
      const allClaims = [];
      for (const item of items) {
        const claims = decomposeFeedback(item.text);
        // If decomposition yields nothing, use original text as single claim
        const effectiveClaims = claims.length > 0 ? claims : (item.text && item.text.length >= 15 ? [item.text] : []);
        for (const claim of effectiveClaims) {
          allClaims.push({ claim, source: item });
        }
      }

      allClaims.forEach((entry, i) => {
        const nodeId = `fb-item-${deckSlug}-${i}`;
        const nextNodeId = i < allClaims.length - 1 ? `fb-item-${deckSlug}-${i + 1}` : `fb-summary-${deckSlug}`;
        const pathArr = typeof entry.source.path_taken === 'string' ? JSON.parse(entry.source.path_taken || '[]') : (entry.source.path_taken || []);
        const pathStr = pathArr.join(' → ') || 'unknown path';

        nodes[nodeId] = {
          type: 'branch',
          title: `"${entry.claim}"`,
          subtitle: `Left at node: ${entry.source.current_node || 'unknown'} | Path: ${pathStr}`,
          branches: [
            { label: 'Accept this feedback', desc: 'Include in refinement prompt', target: nextNodeId, contextKey: `fb-${i}`, contextValue: 'accept' },
            { label: 'Note but skip', desc: 'Interesting but not actionable now', target: nextNodeId, contextKey: `fb-${i}`, contextValue: 'skip' },
            { label: 'Disagree', desc: "This doesn't match the intent", target: nextNodeId, contextKey: `fb-${i}`, contextValue: 'reject' }
          ]
        };
      });

      nodes[`fb-summary-${deckSlug}`] = {
        type: 'branch',
        title: `Review complete for ${deckTitle}`,
        subtitle: 'Your accept/skip/reject choices have been recorded. Generate a refinement prompt via GET /api/feedback-refinement',
        branches: [
          { label: 'Generate refinement prompt', desc: 'GET /api/feedback-refinement to build a ./deck refine command', target: `fb-done-${deckSlug}` },
          { label: 'Done', desc: 'Finish review without generating prompt', target: `fb-done-${deckSlug}` }
        ]
      };

      nodes[`fb-done-${deckSlug}`] = {
        type: 'hero',
        title: `${deckTitle} — Review Complete`,
        subtitle: 'Choices saved. Use /api/feedback-refinement to retrieve your refinement prompt.',
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
