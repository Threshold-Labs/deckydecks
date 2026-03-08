const SPEC_DOCS = `DECK SPEC FORMAT:
A JSON object with "meta" and "nodes" keys.

meta: { title: string, author: string, startNode: string }

nodes: object keyed by node ID (kebab-case), each node has:
  - type: "hero" | "content" | "branch"
  - title: string (required)
  - subtitle: string (for hero and branch types)
  - body: string with inline HTML (for content type, supports <p>, <strong>, <em>)
  - bullets: string[] (for content type, optional)
  - code: string (for content type, optional — HTML with syntax highlight spans using classes: kw, str, cm, fn, num)
  - next: string | null (node ID for linear navigation, null for final slide)
  - branches: array of { label: string, desc: string, target: string } (for branch type only)

RULES:
- Every path through the graph must eventually reach a node with "next": null
- All branch targets must point to valid node IDs
- Branch nodes use "branches" array, NOT "next"
- Linear/hero/content nodes use "next", NOT "branches"
- Include 2-3 branch points for audience self-selection
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

  return `You are a presentation designer. Generate a branching deck spec as valid JSON.

${SPEC_DOCS}

REQUIREMENTS:
- Audience: ${ctx.audience || 'mixed'}
- Goal: ${ctx.goal || 'explain'}
- Target slide count: ${slideCount} (including branch variants)
${titleLine}
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

    // Call Claude API
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
      return Response.json({ error: `Claude API error: ${response.status} ${err}` }, { status: 502 });
    }

    const result = await response.json();
    const text = result.content?.[0]?.text || '';
    const deck = extractJson(text);

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
