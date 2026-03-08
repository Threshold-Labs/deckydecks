# Deck Engine

Interactive branching presentation engine. Single HTML file, zero dependencies.

## Architecture

Everything lives in `index.html` — CSS in `<style>`, JS in `<script>`, sample deck as inline JSON.

### Deck Spec Format

A deck is a JSON graph with `meta` (title, author, startNode) and `nodes` (keyed by ID). Each node has a `type`:

- **hero** — Big centered statement (title + subtitle)
- **content** — Title + body/bullets/code
- **branch** — Choice point with 2-3 options, each targeting a different node
- **demo** — Placeholder for embedded interactive content

Navigation edges: `next` (linear) or `branches[]` (choice point with targets).

### Key Systems

| System | What it does |
|--------|-------------|
| Slide renderer | Builds DOM from JSON nodes, manages active/exit CSS classes |
| Navigation | Graph traversal with history stack; supports linear, branch, and back |
| Path indicator | Visual dot trail showing visited nodes and current position |
| Analytics | Tracks path choices, timestamps, branch counts; console logging + overlay |
| Input mode | Landing page with repo URL input (mock generation) or sample deck launch |

### Controls

- Arrow keys / click / swipe: linear navigation
- Number keys (1-3): branch selection
- `A`: toggle analytics overlay
- `Esc`: return to landing

### Theming

All visual properties use CSS custom properties on `:root`. Override them to retheme.

### CLI Tool (`./deck`)

Bash script that wraps `claude -p` (Sonnet) for generating and refining deck specs from the terminal.

| Command | What it does |
|---------|-------------|
| `deck generate <source>` | Generate a deck from a GitHub URL, file, or stdin. Options: `--audience`, `--goal`, `--depth`, `--output`, `--title` |
| `deck refine <file> "instruction"` | Refine an existing deck spec with a natural language instruction. Auto-backs up to `.backup.json` |
| `deck validate <file>` | Validate deck JSON structure (uses jq if available, falls back to python3) |
| `deck serve [file]` | Open deck in browser; copies JSON to script dir if needed |

### JSON File Workflow

1. **Generate**: `./deck generate README.md --audience technical --goal pitch`
2. **Refine**: `./deck refine deck.json "add a branch for enterprise vs startup"`
3. **Serve**: `./deck serve deck.json` or open `index.html?deck=deck.json` via local server

### External JSON Loading (in index.html)

Three ways to load a deck JSON into the browser engine:

- **File picker** — "Load deck from JSON file" button on the landing page
- **Drag and drop** — Drag a `.json` file anywhere onto the landing page
- **URL parameter** — `index.html?deck=my-deck.json` (requires serving via HTTP, e.g. `python3 -m http.server`)

The analytics overlay includes an "Export Deck JSON" button to download the current deck spec, and a CLI hint showing the refine command.

### Future

- Presenter mode with notes
- Pattern 2 integration for audience analytics aggregation
