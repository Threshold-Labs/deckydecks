#!/usr/bin/env node
/**
 * Deck Engine — Local generation server
 *
 * Bridges the browser UI to `claude -p` for deck generation and refinement.
 * No API key needed — uses your local claude CLI auth.
 *
 * Usage:
 *   node server.js              # starts on port 3333
 *   node server.js --port 8080  # custom port
 *
 * Endpoints:
 *   GET  /                      → serves index.html
 *   GET  /deck/:name            → serves a deck JSON file
 *   GET  /decks                 → lists available deck JSON files
 *   POST /generate              → generates a deck via claude -p
 *   POST /refine                → refines an existing deck via claude -p
 *   GET  /health                → server status
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile, spawn } = require('child_process');
const url = require('url');

const PORT = parseInt(process.argv.find((_, i, a) => a[i - 1] === '--port') || '3333');
const DIR = __dirname;
const MODEL = 'sonnet';

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// ---- Deck spec format docs (shared with CLI) ----
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

// ---- GitHub content fetcher ----
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

  // Fetch README (try main, then master)
  let readme = await fetchText(`https://raw.githubusercontent.com/${owner}/${repoName}/main/README.md`);
  if (!readme) readme = await fetchText(`https://raw.githubusercontent.com/${owner}/${repoName}/master/README.md`);

  // Fetch metadata
  const meta = await fetchJson(`https://api.github.com/repos/${owner}/${repoName}`) || {};

  // Fetch file tree
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

// ---- Run claude -p ----
function runClaude(prompt) {
  return new Promise((resolve, reject) => {
    // Unset CLAUDECODE env var to allow nested invocation
    const env = { ...process.env };
    delete env.CLAUDECODE;

    const child = spawn('claude', ['-p', '--model', MODEL], {
      env,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });

    child.on('close', code => {
      if (code !== 0 && !stdout) {
        reject(new Error(stderr || `claude exited with code ${code}`));
      } else {
        resolve(stdout);
      }
    });

    child.on('error', err => {
      reject(new Error(`Failed to run claude: ${err.message}`));
    });

    child.stdin.write(prompt);
    child.stdin.end();
  });
}

// ---- Extract JSON from claude output ----
function extractJson(text) {
  // Direct parse
  try { return JSON.parse(text); } catch {}

  // Code fence
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    try { return JSON.parse(fenceMatch[1]); } catch {}
  }

  // First { to last }
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first >= 0 && last > first) {
    try { return JSON.parse(text.substring(first, last + 1)); } catch {}
  }

  throw new Error('Could not parse JSON from Claude response');
}

// ---- Build generation prompt ----
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

// ---- Build refinement prompt ----
function buildRefinePrompt(deckSpec, instruction) {
  return `You are refining a branching presentation deck spec. Here is the current spec:

\`\`\`json
${JSON.stringify(deckSpec, null, 2)}
\`\`\`

${SPEC_DOCS}

INSTRUCTION:
${instruction}

RULES:
- Preserve the overall structure unless the instruction specifically asks to change it
- All branch targets must point to valid node IDs
- All paths must converge (no dead ends except the final node)
- Keep the same startNode unless instructed otherwise
- Maintain the quality and specificity of the content

Output ONLY the complete updated JSON deck spec. No markdown fences. No explanation.`;
}

// ---- HTTP Server ----
const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

  // CORS headers for local dev
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // ---- Static file serving ----
  if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
    const file = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(file);
    return;
  }

  // Serve deck JSON files
  if (req.method === 'GET' && pathname.startsWith('/deck/')) {
    const name = pathname.slice(6);
    const filePath = path.join(DIR, name.endsWith('.json') ? name : name + '.json');
    if (fs.existsSync(filePath)) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(fs.readFileSync(filePath, 'utf8'));
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Deck not found' }));
    }
    return;
  }

  // List available decks
  if (req.method === 'GET' && pathname === '/decks') {
    const files = fs.readdirSync(DIR)
      .filter(f => f.endsWith('.json') && f !== 'package.json')
      .map(f => {
        try {
          const deck = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
          return { file: f, title: deck.meta?.title || f, nodeCount: Object.keys(deck.nodes || {}).length };
        } catch {
          return { file: f, title: f, nodeCount: 0 };
        }
      });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(files));
    return;
  }

  // Health check
  if (req.method === 'GET' && pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', model: MODEL }));
    return;
  }

  // ---- Generation endpoint ----
  if (req.method === 'POST' && pathname === '/generate') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const ctx = JSON.parse(body);
        console.log(`[generate] source=${ctx.source}, audience=${ctx.audience}, goal=${ctx.goal}, depth=${ctx.depth}`);

        // Fetch source content
        let sourceContent = '';
        if (ctx.source === 'github' && ctx.repoUrl) {
          console.log(`[generate] Fetching GitHub: ${ctx.repoUrl}`);
          sourceContent = await fetchGitHubContent(ctx.repoUrl);
        } else if (ctx.source === 'paste' || ctx.source === 'describe') {
          sourceContent = ctx.pastedContent || '';
        } else if (ctx.sourceContent) {
          sourceContent = ctx.sourceContent;
        }

        if (!sourceContent) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'No source content provided' }));
          return;
        }

        // Generate via claude -p
        const prompt = buildGeneratePrompt(sourceContent, ctx);
        console.log(`[generate] Running claude -p (${MODEL})...`);
        const result = await runClaude(prompt);
        const deck = extractJson(result);

        // Save to file
        const filename = (deck.meta?.title || 'deck').toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.json';
        fs.writeFileSync(path.join(DIR, filename), JSON.stringify(deck, null, 2));
        console.log(`[generate] Saved: ${filename}`);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ deck, filename }));
      } catch (err) {
        console.error(`[generate] Error:`, err.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // ---- Refinement endpoint ----
  if (req.method === 'POST' && pathname === '/refine') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const { deck, instruction, filename } = JSON.parse(body);
        console.log(`[refine] "${instruction}" on ${filename || 'inline deck'}`);

        const prompt = buildRefinePrompt(deck, instruction);
        console.log(`[refine] Running claude -p (${MODEL})...`);
        const result = await runClaude(prompt);
        const refined = extractJson(result);

        // Save if filename provided
        if (filename) {
          const filePath = path.join(DIR, filename);
          // Backup
          if (fs.existsSync(filePath)) {
            fs.copyFileSync(filePath, filePath.replace('.json', '.backup.json'));
          }
          fs.writeFileSync(filePath, JSON.stringify(refined, null, 2));
          console.log(`[refine] Saved: ${filename}`);
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ deck: refined, filename }));
      } catch (err) {
        console.error(`[refine] Error:`, err.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // ---- Session save endpoint ----
  if (req.method === 'POST' && pathname === '/session') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const session = JSON.parse(body);
        console.log(`[session] ${session.sessionId} — "${session.deckTitle}" (${session.path?.length || 0} nodes, ${session.completed ? 'completed' : 'exited at ' + session.lastNode})`);

        const line = JSON.stringify({ ...session, savedAt: new Date().toISOString() });
        fs.appendFileSync(path.join(DIR, 'sessions.jsonl'), line + '\n');

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, sessionId: session.sessionId }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // ---- Feedback endpoint ----
  if (req.method === 'POST' && pathname === '/feedback') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const entry = JSON.parse(body);
        console.log(`[feedback] "${entry.text?.substring(0, 80)}..." on ${entry.deckTitle}`);

        // Append to feedback.jsonl
        const line = JSON.stringify({ ...entry, receivedAt: new Date().toISOString() });
        fs.appendFileSync(path.join(DIR, 'feedback.jsonl'), line + '\n');

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // ---- Feedback deck generator ----
  if (req.method === 'GET' && pathname === '/feedback-deck') {
    try {
      const feedbackFile = path.join(DIR, 'feedback.jsonl');
      const sessionsFile = path.join(DIR, 'sessions.jsonl');

      const feedback = fs.existsSync(feedbackFile)
        ? fs.readFileSync(feedbackFile, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l))
        : [];
      const sessions = fs.existsSync(sessionsFile)
        ? fs.readFileSync(sessionsFile, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l))
        : [];

      // Optional filter by deck title
      const filterDeck = parsed.query.deck;

      // Group feedback by source deck
      const byDeck = {};
      for (const f of feedback) {
        const deck = f.deckTitle || 'Unknown';
        if (filterDeck && deck !== filterDeck) continue;
        if (!byDeck[deck]) byDeck[deck] = [];
        byDeck[deck].push(f);
      }

      // Group sessions by deck title for stats
      const sessionsByDeck = {};
      for (const s of sessions) {
        const deck = s.deckTitle || 'Unknown';
        if (!sessionsByDeck[deck]) sessionsByDeck[deck] = [];
        sessionsByDeck[deck].push(s);
      }

      // Build a feedback review deck
      const nodes = {};
      let deckList = Object.keys(byDeck);

      if (deckList.length === 0) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          meta: { title: 'No Feedback Yet', author: 'Deck Engine', startNode: 'empty' },
          nodes: { empty: { type: 'hero', title: 'No feedback collected yet.', subtitle: 'Navigate some decks and leave feedback to see it here.', next: null } }
        }));
        return;
      }

      // Opening
      nodes['fb-open'] = {
        type: 'hero',
        title: 'Feedback Review',
        subtitle: `${feedback.length} feedback entries across ${deckList.length} deck(s). ${sessions.length} total sessions recorded.`,
        next: deckList.length === 1 ? `fb-deck-${slugify(deckList[0])}` : 'fb-choose-deck'
      };

      // If multiple decks, branch to choose
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

        // Stats node
        const completionRate = deckSessions.length > 0
          ? Math.round((deckSessions.filter(s => s.completed).length / deckSessions.length) * 100)
          : 0;
        const avgDuration = deckSessions.length > 0
          ? Math.round(deckSessions.reduce((a, s) => a + (s.totalDurationMs || 0), 0) / deckSessions.length / 1000)
          : 0;

        // Collect dropout points
        const dropouts = {};
        for (const s of deckSessions) {
          if (!s.completed && s.lastNode) {
            dropouts[s.lastNode] = (dropouts[s.lastNode] || 0) + 1;
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

        // Each feedback item as a branch: accept / ignore
        items.forEach((item, i) => {
          const nodeId = `fb-item-${deckSlug}-${i}`;
          const nextNodeId = i < items.length - 1 ? `fb-item-${deckSlug}-${i + 1}` : `fb-summary-${deckSlug}`;

          const pathStr = item.pathTaken ? item.pathTaken.join(' → ') : 'unknown path';
          const atNode = item.currentNode || 'unknown';

          nodes[nodeId] = {
            type: 'branch',
            title: `"${item.text}"`,
            subtitle: `Left at node: ${atNode} | Path: ${pathStr}`,
            branches: [
              { label: 'Accept this feedback', desc: 'Include in refinement prompt', target: nextNodeId, contextKey: `fb-${i}`, contextValue: 'accept' },
              { label: 'Note but skip', desc: 'Interesting but not actionable now', target: nextNodeId, contextKey: `fb-${i}`, contextValue: 'skip' },
              { label: 'Disagree', desc: 'This doesn\'t match the intent', target: nextNodeId, contextKey: `fb-${i}`, contextValue: 'reject' }
            ]
          };
        });

        // Summary / generate refinement
        nodes[`fb-summary-${deckSlug}`] = {
          type: 'hero',
          title: `Review complete for ${deckTitle}`,
          subtitle: 'Your accept/skip/reject choices have been recorded. Use the analytics export to generate a refinement prompt.',
          next: null
        };
      }

      const feedbackDeck = {
        meta: { title: 'Feedback Review', author: 'Deck Engine', startNode: 'fb-open' },
        nodes
      };

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(feedbackDeck, null, 2));
    } catch (err) {
      console.error('[feedback-deck] Error:', err.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // 404
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, () => {
  console.log(`\n  Deck Engine server running at http://localhost:${PORT}`);
  console.log(`  Model: ${MODEL}`);
  console.log(`  Decks dir: ${DIR}\n`);
  console.log(`  Endpoints:`);
  console.log(`    GET  /              → deck engine UI`);
  console.log(`    GET  /decks         → list available deck JSON files`);
  console.log(`    GET  /deck/:name    → serve a deck JSON`);
  console.log(`    POST /generate      → generate deck via claude -p`);
  console.log(`    POST /refine        → refine deck via claude -p`);
  console.log(`    GET  /health        → server status\n`);
});
