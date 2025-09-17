# variant-ui (Active Development)

**Can't decide between UI approaches? Build them all in parallel.**

MCP server for rapid UI prototyping. Spin up multiple prototypes simultaneously, see them running side-by-side, ship what actually works.

## Why this exists

The Prototype Valley of Death:
- **Figma prototype:** Looks perfect, doesn't run
- **Code prototype:** Takes too long, so you only build one
- **Result:** You commit to the first idea that seems OK

What AI enables:
- Build 5 prototypes in the time it used to take for one
- Each variant runs independently on its own port
- Compare them in real-time, merge the winner

![Review UI](docs/images/review-ui.png)

## Prerequisites

- Node.js 18+
- Git
- npm (currently only npm is supported)
- MCP-compatible client (tested with Claude Code)

## Setup

1. Clone and build:
```bash
git clone git@github.com:btree1970/variant-ui.git
cd variant-ui
npm install
npm run build
```

2. Add to your MCP client:

### Claude Code
```bash
# Add with default port 5400
claude mcp add variant-ui node <path-to-variant-ui>/dist/index.js

# Or specify a custom port
claude mcp add variant-ui node <path-to-variant-ui>/dist/index.js --env VARIANT_UI_PORT=8080
```

### Codex CLI
```bash
codex mcp add variant-ui <path-to-variant-ui>/dist/index.js
```

**Important:** Add variant-ui to your project settings, not global settings. This tool is designed to run only when you're working on a specific project.

## Usage

**Pro tip:** For the best experience, enable auto-approval for file edits in the variant directories. This lets your AI agent work seamlessly without constant permission prompts.

**Pro tip for Claude Code users:** Use Claude sub-agents to run every code change in each variant in parallel. This dramatically speeds up iteration when testing multiple approaches simultaneously.

Once added to your MCP client, you can use these commands in any conversation:

### Example prompts

Explore different vibes:
```
I want to try 3 different feels for this landing page - one that feels premium,
one that's playful, and one that's super minimal
```

```
Build 5 variants with completely different vibes: brutalist concrete,
y2k web aesthetic, terminal hacker mode, corporate Memphis, and one
that looks like it's from the year 3000
```

Quick decisions:
```
Should we use a modal or drawer for settings? Create both and let's see
```

```
This form works but it's boring. Show me 3 versions with
different micro-interactions and transitions
```

Check what's running:
```
What variants do I have running?
```

Then open http://localhost:5400 (or your custom port) to see all your variants side-by-side in the review UI.

## Features

- **Isolated variants** - Each variant runs in its own git worktree
- **Auto port assignment** - No port conflicts between variants and projects
- **Live preview** - Start/stop dev servers for each variant
- **Review UI** - See all variants at a glance
- **Real-time updates** - SSE-powered activity log
- **Framework detection** - Works with Next.js (more coming)
- **Package manager** - Currently supports npm (yarn/pnpm coming soon)

## How it works

Variants are created as git worktrees in your temp directory. Each variant:
- Gets a unique branch (`ui-var/001-description`)
- Runs its own dev server (when previewing)
- Can be merged back to main when ready

## Feedback

This project is in active development. Found a bug? Have a feature request?
- Open an issue on GitHub
- Share what frameworks you'd like supported

## License

MIT
