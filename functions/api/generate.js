const SPEC_DOCS = `DECK SPEC FORMAT:
A JSON object with "meta" and "nodes" keys.

meta: { title: string, author: string, startNode: string, theme?: "dark" | "light" | "threshold" }
  - theme is optional. "dark" = cinematic dark with purple accents (default), "light" = warm white background with green accents, "threshold" = dark with lime accents and grid texture.

nodes: object keyed by node ID (kebab-case), each node has:
  - type: "hero" | "content" | "branch" | "chart" | "input"
  - title: string (required)
  - subtitle: string (for hero and branch types)
  - body: string with inline HTML (for content type, supports <p>, <strong>, <em>)
  - bullets: string[] (for content type, optional)
  - code: string (for content type, optional — HTML with syntax highlight spans using classes: kw, str, cm, fn, num)
  - chartType: "bar" | "scorecard" | "comparison" (for chart type only)
  - data: array (for chart type only)
    - bar: [{ label: string, value: number, color?: string }] — horizontal bars, max value = 100% width
    - scorecard: [{ label: string, value: string|number, delta?: string, color?: string }] — KPI cards with optional "+12%" or "-5%" deltas
    - comparison: [{ key: value, ... }] — first item keys become headers; true→checkmark, false→X; optional _highlight: true to accent a row
  - next: string | null (node ID for linear navigation, null for final slide)
  - branches: array of { label: string, desc: string, target: string } (for branch type only)

  INPUT NODE (type: "input"):
  Interactive input nodes gather audience preferences, priorities, or ratings. They use an "inputType" field:
  - "slider": single slider with value display
    Fields: inputType: "slider", min: number, max: number, step: number, default: number, labels: [minLabel, maxLabel], inputKey: string, next: string
  - "multiselect": tag/chip selection (click to toggle)
    Fields: inputType: "multiselect", options: string[], maxSelections?: number, inputKey: string, next: string
  - "ranking": drag-to-reorder prioritization list
    Fields: inputType: "ranking", items: string[], inputKey: string, next: string
  - "scale": multiple labeled sliders (rating matrix)
    Fields: inputType: "scale", dimensions: [{ label: string, min: number, max: number }], inputKey: string, next: string
  Input nodes use "next" for navigation (NOT "branches"). The inputKey stores the captured value in session data.

RULES:
- Every path through the graph must eventually reach a node with "next": null
- All branch targets must point to valid node IDs
- Branch nodes use "branches" array, NOT "next"
- Linear/hero/content/chart nodes use "next", NOT "branches"
- Use chart nodes for data visualization when the source content includes statistics, comparisons, or metrics
- Include 2-3 branch points for audience self-selection
- Use input nodes to gather audience preferences, priorities, or ratings. Input nodes create interactive moments that make the deck feel like a conversation, not a lecture. Don't overuse them — 1-2 per deck is ideal.
- Branch options should be creative and varied — avoid defaulting to technical vs. business splits. Consider audience identity, interest level, use case, learning style, or emotional resonance as branch dimensions.
- All branches should converge back to shared nodes (no orphaned dead ends)
- Start with a hero slide, end with a hero slide
- Node IDs should be kebab-case descriptive names`;

async function fetchGitHubContent(repoUrl) {
  const match = repoUrl.match(/github\.com\/([^\/]+)\/([^\/\?#]+)/);
  if (!match) throw new Error('Invalid GitHub URL');
  const [, owner, repo] = match;
  const repoName = repo.replace(/\.git$/, '');

  const fetchJson = async (url) => {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    return resp.json();
  };
  const fetchText = async (url) => {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    return resp.text();
  };

  let readme = await fetchText(`https://raw.githubusercontent.com/${owner}/${repoName}/main/README.md`);
  if (!readme) readme = await fetchText(`https://raw.githubusercontent.com/${owner}/${repoName}/master/README.md`);

  const meta = await fetchJson(`https://api.github.com/repos/${owner}/${repoName}`) || {};
  const tree = await fetchJson(`https://api.github.com/repos/${owner}/${repoName}/contents/`) || [];

  const parts = [`Repository: ${owner}/${repoName}`];
  if (meta.description) parts.push(`Description: ${meta.description}`);
  if (meta.language) parts.push(`Language: ${meta.language}`);
  if (meta.stargazers_count) parts.push(`Stars: ${meta.stargazers_count}`);
  if (meta.topics?.length) parts.push(`Topics: ${meta.topics.join(', ')}`);
  if (tree.length) {
    parts.push('\nFile structure:');
    tree.forEach(f => parts.push(`${f.type === 'dir' ? '📁' : '📄'} ${f.name}`));
  }
  if (readme) parts.push(`\nREADME (truncated):\n${readme.substring(0, 8000)}`);

  return parts.join('\n');
}

function buildGeneratePrompt(sourceContent, ctx) {
  const slideCount = { quick: '5-8', standard: '10-15', deep: '18-25' }[ctx.depth] || '10-15';
  const titleLine = ctx.title ? `- The deck title should be: ${ctx.title}` : '';
  const themeLine = ctx.theme && ctx.theme !== 'dark' ? `- Set meta.theme to "${ctx.theme}"` : '';

  // Build creative direction from dynamic wizard answers (replaces static audience/goal)
  const skipKeys = new Set(['source', 'repoUrl', 'pastedContent', 'sourceContent', 'depth', 'theme', 'title', 'apiKey']);
  const creativeDirection = Object.entries(ctx)
    .filter(([k, v]) => !skipKeys.has(k) && typeof v === 'string' && v.length > 0)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join('\n');

  return `You are a presentation designer. Generate a branching deck spec as valid JSON.

${SPEC_DOCS}

REQUIREMENTS:
- Target slide count: ${slideCount} (including branch variants)
${titleLine}
${themeLine}
${creativeDirection ? `\nCREATIVE DIRECTION (from the user's choices):\n${creativeDirection}\nUse these to shape the narrative angle, tone, emphasis, and structure of the deck.\n` : ''}
- Include 2-3 branch points where the audience can self-select their path
- Make branch questions feel like genuine moments of audience engagement
- All branches should converge back to shared closing slides
- Start with a compelling hero slide that hooks attention
- End with a strong closing hero slide
- Content should be insightful and specific, not generic

CRITICAL — BRANCH DIVERGENCE:
Each branch path MUST lead to genuinely different content, not the same ideas with different framing.
- Bad: Branch "Technical" vs "Business" → both explain the same features with different words
- Good: Branch "Technical" → shows architecture, code, system design. "Business" → shows market, ROI, competitive landscape. Completely different slides.
- Each branch path should have 2-4 unique nodes before converging. One shared "bridge" node is not enough.
- Branch labels should represent real audience self-selection: "I build things" vs "I buy things" vs "I invest in things" — not "Learn more" vs "See details"
- The convergence point should synthesize insights from all paths, not repeat what any single path said

SOURCE CONTENT:
${sourceContent}

Output ONLY the valid JSON deck spec. No markdown fences. No explanation. No trailing commas. Ensure all branch targets reference valid node IDs.`;
}

function extractJson(text) {
  try { return JSON.parse(text); } catch {}
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    try { return JSON.parse(fenceMatch[1]); } catch {}
  }
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first >= 0 && last > first) {
    try { return JSON.parse(text.substring(first, last + 1)); } catch {}
  }
  throw new Error('Could not parse JSON from Claude response');
}

function validateDeck(deck) {
  const errors = [];

  if (!deck || typeof deck !== 'object') {
    return ['Deck is not an object'];
  }
  if (!deck.meta || !deck.meta.title || !deck.meta.startNode) {
    errors.push('Missing meta.title or meta.startNode');
  }
  if (!deck.nodes || typeof deck.nodes !== 'object' || Object.keys(deck.nodes).length === 0) {
    errors.push('Missing or empty nodes');
  }
  if (errors.length) return errors;

  const nodeIds = new Set(Object.keys(deck.nodes));

  // startNode must exist
  if (!nodeIds.has(deck.meta.startNode)) {
    errors.push(`startNode "${deck.meta.startNode}" does not exist in nodes`);
  }

  for (const [id, node] of Object.entries(deck.nodes)) {
    if (!node.type) {
      errors.push(`Node "${id}" missing type`);
    }
    if (!node.title && node.type !== 'action') {
      errors.push(`Node "${id}" missing title`);
    }

    // Check branch targets
    if (node.branches && Array.isArray(node.branches)) {
      for (const b of node.branches) {
        if (!b.target || !nodeIds.has(b.target)) {
          errors.push(`Branch target "${b.target}" in node "${id}" does not exist`);
        }
      }
    }

    // Check next target
    if (node.next && !nodeIds.has(node.next)) {
      errors.push(`Next target "${node.next}" in node "${id}" does not exist`);
    }
  }

  // Check for reachability from startNode
  const visited = new Set();
  const queue = [deck.meta.startNode];
  while (queue.length) {
    const current = queue.shift();
    if (visited.has(current) || !nodeIds.has(current)) continue;
    visited.add(current);
    const node = deck.nodes[current];
    if (node.next) queue.push(node.next);
    if (node.branches) {
      for (const b of node.branches) {
        if (b.target) queue.push(b.target);
      }
    }
  }

  const unreachable = [...nodeIds].filter(id => !visited.has(id));
  if (unreachable.length) {
    errors.push(`Unreachable nodes: ${unreachable.join(', ')}`);
  }

  // Check at least one terminal node exists
  const hasTerminal = Object.values(deck.nodes).some(n => n.next === null && !n.branches);
  if (!hasTerminal) {
    errors.push('No terminal node found (node with next: null and no branches)');
  }

  return errors;
}

async function callClaude(apiKey, prompt) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8192,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Claude API error: ${response.status} ${err}`);
  }

  const result = await response.json();
  return result.content?.[0]?.text || '';
}

export async function onRequestPost({ request, env }) {
  try {
    const ctx = await request.json();
    const apiKey = env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return Response.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 });
    }

    // Fetch source content
    let sourceContent = '';
    if (ctx.source === 'github' && ctx.repoUrl) {
      sourceContent = await fetchGitHubContent(ctx.repoUrl);
    } else if (ctx.source === 'paste' || ctx.source === 'describe') {
      sourceContent = ctx.pastedContent || '';
    } else if (ctx.sourceContent) {
      sourceContent = ctx.sourceContent;
    }

    if (!sourceContent) {
      return Response.json({ error: 'No source content provided' }, { status: 400 });
    }

    const prompt = buildGeneratePrompt(sourceContent, ctx);

    // Generate with validation + retry (up to 2 attempts)
    const MAX_ATTEMPTS = 2;
    let deck = null;
    let lastErrors = [];

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const currentPrompt = attempt === 1
        ? prompt
        : `${prompt}\n\nIMPORTANT — Your previous attempt had these structural errors:\n${lastErrors.map(e => `- ${e}`).join('\n')}\nFix ALL of these issues. Ensure every branch target points to a valid node ID and all nodes are reachable from startNode.`;

      const text = await callClaude(apiKey, currentPrompt);
      deck = extractJson(text);

      const errors = validateDeck(deck);
      if (errors.length === 0) break;

      lastErrors = errors;
      console.log(`[generate] Attempt ${attempt} validation failed:`, errors);

      if (attempt === MAX_ATTEMPTS) {
        // Return the deck anyway with a warning — it's usable even if imperfect
        console.log('[generate] Returning deck with validation warnings after max attempts');
      }
    }

    // Save to R2
    const slug = (deck.meta?.title || 'deck').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const filename = `${slug}.json`;
    const deviceId = request.headers.get('X-Device-Id') || 'anonymous';
    const r2Key = `decks/${deviceId}/${filename}`;

    await env.STORAGE.put(r2Key, JSON.stringify(deck, null, 2), {
      customMetadata: { title: deck.meta?.title || '', nodeCount: String(Object.keys(deck.nodes || {}).length) },
    });

    // Save metadata to D1
    const deckId = `${slug}-${Date.now().toString(36)}`;
    await env.DB.prepare(`
      INSERT INTO decks (id, title, node_count, r2_key, device_id)
      VALUES (?, ?, ?, ?, ?)
    `).bind(
      deckId,
      deck.meta?.title || filename,
      Object.keys(deck.nodes || {}).length,
      r2Key,
      deviceId,
    ).run();

    return Response.json({ deck, filename, deckId });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
