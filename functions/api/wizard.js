async function fetchGitHubContent(repoUrl) {
  const match = repoUrl.match(/github\.com\/([^\/]+)\/([^\/\?#]+)/);
  if (!match) throw new Error('Invalid GitHub URL');
  const [, owner, repo] = match;
  const repoName = repo.replace(/\.git$/, '');

  const fetchText = async (url) => {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    return resp.text();
  };
  const fetchJson = async (url) => {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    return resp.json();
  };

  let readme = await fetchText(`https://raw.githubusercontent.com/${owner}/${repoName}/main/README.md`);
  if (!readme) readme = await fetchText(`https://raw.githubusercontent.com/${owner}/${repoName}/master/README.md`);

  const meta = await fetchJson(`https://api.github.com/repos/${owner}/${repoName}`) || {};
  const parts = [`Repository: ${owner}/${repoName}`];
  if (meta.description) parts.push(`Description: ${meta.description}`);
  if (readme) parts.push(`\nREADME (truncated):\n${readme.substring(0, 4000)}`);

  return parts.join('\n');
}

export async function onRequestPost({ request, env }) {
  try {
    const ctx = await request.json();
    const apiKey = env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return Response.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 });
    }

    // Get source content
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

    const prompt = `You are helping someone create a branching presentation deck. Based on their source content below, generate exactly 2 smart questions that will shape the deck. Each question should have 3 options.

These questions replace generic "who is the audience?" and "what is the goal?" prompts. Instead, derive questions from the ACTUAL CONTENT — what angles, perspectives, or approaches are naturally present in the material?

Good question types:
- "What angle matters most?" with options derived from themes in the content
- "What should the audience walk away with?" with outcome-based options
- "What's the context?" with situational options (e.g., "team onboarding", "conference talk", "investor meeting")
- "What should we emphasize?" with content-specific options
- "How should we frame this?" with narrative/tone options

BAD questions (never ask these):
- "Technical vs Business vs Mixed" — too generic
- "Pitch vs Demo vs Explain" — too generic
- Anything that doesn't reference the actual content

SOURCE CONTENT:
${sourceContent.substring(0, 6000)}

Respond with ONLY valid JSON, no markdown fences. Format:
{
  "questions": [
    {
      "title": "The question to ask",
      "subtitle": "Brief context for why this matters",
      "contextKey": "a short camelCase key like 'angle' or 'emphasis'",
      "options": [
        { "label": "Option label (2-5 words)", "desc": "One sentence description", "value": "short value string" },
        { "label": "...", "desc": "...", "value": "..." },
        { "label": "...", "desc": "...", "value": "..." }
      ]
    },
    {
      "title": "...",
      "subtitle": "...",
      "contextKey": "...",
      "options": [...]
    }
  ]
}`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Claude API error: ${response.status} ${err}`);
    }

    const result = await response.json();
    const text = result.content?.[0]?.text || '';

    // Parse JSON
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      const first = text.indexOf('{');
      const last = text.lastIndexOf('}');
      if (first >= 0 && last > first) {
        parsed = JSON.parse(text.substring(first, last + 1));
      } else {
        throw new Error('Could not parse wizard response');
      }
    }

    // Validate structure
    if (!parsed.questions || !Array.isArray(parsed.questions) || parsed.questions.length < 1) {
      throw new Error('Invalid wizard response structure');
    }

    // Ensure we have exactly 2 questions with 2-4 options each
    const questions = parsed.questions.slice(0, 2).map(q => ({
      title: q.title,
      subtitle: q.subtitle || '',
      contextKey: q.contextKey || 'customChoice',
      options: (q.options || []).slice(0, 4).map(o => ({
        label: o.label,
        desc: o.desc || '',
        value: o.value || o.label,
      })),
    }));

    return Response.json({ questions });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
