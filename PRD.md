# Deck Engine — Product Requirements Document

## One-liner

A generative, branching presentation engine where the tool for creating decks is itself a deck.

## Core Insight

Presentations fail because they're static artifacts aimed at a single imagined audience. Real conversations branch. Real understanding is nonlinear. The deck should be a directed graph, not a list.

The deeper insight: **the control plane for generating decks should also be a deck.** This creates a recursive, forkable medium — the artifact and the tool that creates it share the same format, the same runtime, and the same interaction model.

## The Recursive Constraint

Every deck is a JSON graph (nodes + edges). The **generator** — the wizard that creates new decks — is also a JSON graph. This means:

1. **Generator decks are forkable.** Anyone can take the default generator, modify its branch structure, change its questions, tune its prompt templates, and share it.
2. **Domain-specific generators emerge.** A YC-optimized generator asks different questions than an enterprise sales generator. The expertise lives in the graph topology and the prompts, not in code.
3. **The crowd-building loop:** Fork repo → customize generator deck → generate decks → share generator back. The thing you make and the thing that makes it are the same format.
4. **Generators can generate generators.** A meta-generator deck could walk you through building a new generator deck. Turtles all the way down, but each layer is useful on its own.

## Architecture

```
┌─────────────────────────────────────────────┐
│  index.html — Runtime Engine                │
│  Renders any deck spec (JSON graph)         │
│  Handles navigation, branching, analytics   │
├─────────────────────────────────────────────┤
│  Deck Specs (.json)                         │
│  ├── sample-deck.json     (meta-pitch)      │
│  ├── generator-deck.json  (creation wizard) │
│  ├── my-pitch.json        (generated)       │
│  └── *.json               (user decks)      │
├─────────────────────────────────────────────┤
│  ./deck CLI                                 │
│  generate / refine / validate / serve       │
│  Wraps claude -p (Sonnet) for fast edits    │
├─────────────────────────────────────────────┤
│  Generator Deck Node Types                  │
│  input    — collects text/URLs/keys         │
│  generate — triggers LLM pipeline           │
│  branch   — accumulates context choices     │
└─────────────────────────────────────────────┘
```

### Node Types

| Type | Purpose | Key Fields |
|------|---------|------------|
| `hero` | Big statement slide | title, subtitle, next |
| `content` | Information slide | title, body, bullets, code, next |
| `branch` | Audience choice point | title, branches[{label, desc, target, contextKey?, contextValue?}] |
| `input` | Collects user text (generator decks) | title, inputType, placeholder, contextKey, next |
| `generate` | Triggers LLM pipeline (generator decks) | title, subtitle |
| `demo` | Embedded interactive content | title, subtitle, embedUrl? |

### Generator Context Accumulation

Branch nodes in generator decks carry `contextKey`/`contextValue` on their options. As the user navigates, choices accumulate into a `generatorContext` object:

```json
{
  "source": "github",
  "repoUrl": "https://github.com/Threshold-Labs/flowdj",
  "audience": "technical",
  "goal": "pitch",
  "depth": "standard"
}
```

This context feeds the generation prompt. Different generator decks ask different questions → build different contexts → produce different kinds of decks.

### Prompt Templates

The `generate` node (or a future `promptTemplate` field) determines how context maps to an LLM prompt. This is where the real IP in a forked generator lives. A generator optimized for investor pitches will have a fundamentally different prompt structure than one for developer onboarding.

```
Generator Deck Topology  →  Questions Asked  →  Context Shape  →  Prompt Template  →  Output Deck
```

Each layer is customizable by forking the generator JSON.

---

## Forking Model

### Level 1: Fork a generated deck
User generates a deck, exports JSON, edits it manually or via `./deck refine`. This is just editing output.

### Level 2: Fork the generator
User modifies the generator deck itself — changes branch questions, adds/removes paths, adjusts prompt templates. Now they've customized the creation experience.

### Level 3: Fork the runtime
User modifies index.html — adds new node types, custom themes, new analytics. This is contributing to the engine itself.

### Sharing

Each level produces a different kind of artifact:
- L1: A `.json` deck spec. Shareable, loadable in any deck engine instance.
- L2: A generator `.json` spec. Shareable as a "deck template" — anyone can load it and use your generator flow.
- L3: A modified `index.html`. Fork the repo.

The L2 artifact is the most interesting for crowd-building. It's lightweight (just JSON), opinionated (encodes domain expertise), and instantly usable.

---

## Persona Simulations

Using real Threshold-Labs projects to simulate different users discovering and using deck engine.

### Persona 1: "Alex" — OSS Developer Evaluating FlowDJ

**Who:** Senior developer, focus/productivity tool enthusiast, found FlowDJ via Hacker News.
**Source:** `https://github.com/Threshold-Labs/flowdj`
**Generator flow:**
- Source: GitHub repo
- Audience: Technical
- Goal: Explain
- Depth: Standard

**What the deck should produce:**
- Hero: "Music that feels your focus" — hook on the zero-dependency, Web Audio angle
- Branch 1: "What draws you in?" → "The audio synthesis" / "The flow tracking" / "The Spotify integration"
- Each path deep-dives that system with code snippets from index.html
- Convergence: How the systems compose (flow → music adaptation → Spotify anchoring)
- Branch 2: "Want to contribute?" → "Show me the architecture" / "What's on the roadmap?"
- Close: CTA to try flowdj.pages.dev

**Key test:** Does the generator produce code blocks from the actual repo? Does it identify FM synthesis, flow scoring, and the companion bridge as the key systems?

### Persona 2: "Maya" — VC Associate Doing Due Diligence on Threshold

**Who:** Series A associate at a generalist fund. Got an intro, needs to understand what Threshold is.
**Source:** Paste text — a brief describing the Threshold thesis + SDK + initial products
**Generator flow:**
- Source: Paste text
- Audience: Business
- Goal: Pitch
- Depth: Standard

**What the deck should produce:**
- Hero: The core thesis ("helping people articulate values through how they filter information")
- Problem: Attention is fragmented, tools don't talk to each other, no shared identity layer
- Branch 1: "What's your mental model?" → "Platform play" / "Developer tools" / "Consumer product"
  - Platform: Threshold as the auth/routing layer everything connects through
  - Dev tools: SDK, trust primitives, signal protocol
  - Consumer: FlowDJ as the wedge, Spotify integration, zero-friction entry
- Convergence: All three are the same thing at different zoom levels
- Branch 2: "What do you need to see?" → "Traction" / "Technical moat" / "Team"
- Close: CTA to schedule a deeper conversation

**Key test:** Does the branching let Maya self-select into her fund's investment thesis frame? Does it converge back to a coherent story regardless of path?

### Persona 3: "Jordan" — Community Member Discovering BoulderNewTech

**Who:** New-to-Boulder developer, found bouldernewtech.com, wants to understand what it is.
**Source:** `https://github.com/ryanstpierre/bouldernewtech`
**Generator flow:**
- Source: GitHub repo
- Audience: Mixed
- Goal: Explain
- Depth: Quick

**What the deck should produce:**
- Hero: "Boulder's tech community, organized"
- What BNT is: monthly events, community hub, ~2000 members
- Branch: "What are you looking for?" → "Attend an event" / "Get involved" / "Learn about the Boulder scene"
- Close: CTA to next event

**Key test:** Quick deck (5-8 slides) — does the generator know when to be brief? Does it pull event info from the repo?

### Persona 4: "Sam" — Developer Building a Custom Generator

**Who:** DevRel at a SaaS company. Wants to build a generator that creates onboarding decks for their API.
**What they do:**
1. Fork the deck engine repo
2. Modify the `GENERATOR_DECK` spec — replace generic source/audience/goal branches with:
   - "Which SDK?" → Python / Node / Go
   - "What's their use case?" → Real-time / Batch / Analytics
   - "Experience level?" → First API / Experienced developer
3. Customize the prompt template to include their API docs and code samples
4. Share the forked generator — anyone at the company can generate tailored onboarding decks

**Key test:** Can Sam do this by only editing JSON? Does the generator deck spec format support domain-specific branches that feed into domain-specific prompts?

### Persona 5: "River" — Threshold SDK Consumer (Internal)

**Who:** Developer building on threshold-sdk, needs to present the SDK to their team.
**Source:** `https://github.com/Threshold-Labs/threshold-sdk`
**Generator flow:**
- Source: GitHub repo
- Audience: Technical
- Goal: Demo
- Depth: Deep

**What the deck should produce:**
- Hero: "One identity layer across everything"
- Architecture overview: OAuth adapters, token management, signal protocol
- Branch 1: "Which integration?" → "Spotify" / "Calendar" / "Custom source"
- Each path shows integration code, auth flow diagrams (as code blocks)
- Branch 2: "Ready to build?" → "Quick start" / "Deep architecture"
- Demo slide: embed threshold SDK playground (future)
- Close: Link to docs, npm package

**Key test:** Does the deep dive (18-25 slides) actually go deep? Does it generate useful code examples from the repo?

---

## Analytics as Product Signal

Every branch choice in every deck is a signal. At scale, this data answers:

- **Which paths do audiences take most?** → Tells you what people actually care about
- **Where do people go idle?** → Content that loses attention
- **Which branch framings resonate?** → A/B test narrative structures
- **How do different personas navigate the same deck?** → Audience segmentation from behavior

For the persona simulations: generating decks for your projects and then sending them to real people in those roles would produce actual analytics on how different audiences engage with your projects. The deck becomes a research tool, not just a presentation.

---

## Technical Roadmap

### Phase 1: Core (Done)
- [x] Runtime engine (index.html)
- [x] Branching navigation with graph traversal
- [x] Analytics: dwell time, idle/engaged, path tracking, export
- [x] Generator deck (in-browser creation wizard)
- [x] `./deck` CLI wrapping `claude -p`
- [x] JSON file loading (file picker, drag & drop, URL param)

### Phase 2: Forkable Generators
- [ ] Extract `GENERATOR_DECK` and `SAMPLE_DECK` to standalone JSON files
- [ ] `promptTemplate` field on `generate` nodes — customizable per generator
- [ ] Generator deck library: landing page lists available generators
- [ ] `./deck fork-generator <base> --name "my-generator"` CLI command
- [ ] Generator deck validation (all contextKeys used in prompt, all branches reachable)

### Phase 3: Demo Embedding
- [ ] `demo` node type renders iframes at configurable URLs
- [ ] Progressive interactivity: slides transition seamlessly into embedded product UIs
- [ ] Offline fallback: screenshot mode when embed URL is unreachable
- [ ] `embedUrl` field on demo nodes, with optional `fallbackImage`

### Phase 4: Distribution & Analytics
- [ ] Shareable deck URLs (Cloudflare Pages deploy per deck)
- [ ] Aggregate analytics across sessions (who took which path)
- [ ] A/B testing: serve different generator decks, compare path distributions
- [ ] Audience fingerprinting: infer persona from branch choices (without PII)

### Phase 5: Crowd-Building
- [ ] Public generator library — browse and fork community generators
- [ ] Generator ratings/usage stats
- [ ] "Remix" button: fork a generator deck inline, save as new
- [ ] Meta-generator: a deck that walks you through building a generator deck

---

## Open Questions

1. **Prompt template format:** Should it be embedded in the `generate` node JSON, or a separate referenced file? Embedded is simpler, but large prompts bloat the spec.

2. **Generator deck validation:** How strict? Must every `contextKey` appear in the prompt template? Or is it OK to collect context that's only sometimes used?

3. **Deck versioning:** When you refine a deck, should it keep a version history? The backup approach works for CLI but doesn't help in-browser.

4. **Authentication for private repos:** The GitHub fetcher only works for public repos. Add GitHub token support? Or keep it simple and tell people to paste their README?

5. **Multi-model routing:** Should the CLI support `--model` for different generation tasks? Quick structural edits → Haiku, deep narrative generation → Sonnet, complex multi-path decks → Opus?

6. **The "deck as onboarding" angle:** If a generated deck IS product onboarding, it needs to capture user intent (branch choices) and feed that back into the product. This implies a webhook/callback system on the `generate` or terminal nodes. How far do we take this?
