# D&D Campaign — Setup & Handoff

Handoff notes from a Claude Code web session. Everything below was researched and
verified; nothing here is guesswork unless explicitly flagged.

Read this first in a **local** Claude Code session (VS Code or terminal). The web
session that produced this file cannot run the game — see "Why local" below.

---

## The skill

[claude-dnd-skill](https://github.com/neuralinitiative/claude-dnd-skill) v2.1.4,
AGPL-3.0, by Neural Initiative. Unofficial, and genuinely well built.

A full 5e campaign engine, not a rules cheat sheet:

- Persistent state as plain markdown — `state.md`, `world.md`, `npcs.md`,
  `session-log.md`, `characters/*.md`
- Real mechanics in Python — `dice.py`, `combat.py`, `character.py`, `xp.py`,
  `tracker.py`, plus a bundled 1.2 MB 5e SRD dataset for spell/monster lookup
- Both rulesets — 2014 (SRD 5.1) and 2024 (SRD 5.2), declared per campaign
- Two campaign modes — **improvised** (generates a world + dynamic three-act arc)
  or **structured** (imports a published module and enforces its chapter beats)
- An optional Flask display companion that streams narration, dice and stats to
  any browser on the LAN

Verified working on stock Python 3.11 with no pip installs:
`dice.py d20+5` and `lookup.py spell fireball` both return correct output.
The display companion is the only part needing `flask flask-cors numpy cryptography`.

### Install

```bash
/plugin marketplace add neuralinitiative/claude-dnd-skill
/plugin install dm@neural-initiative
```

Optional extras:

```bash
pip3 install flask flask-cors numpy cryptography   # display companion
pip3 install pymupdf                               # PDF module import
```

---

## Why local, not web

Claude Code on the web runs in an ephemeral cloud container. Two blockers:

1. **The display companion is unreachable.** It binds `localhost:5001`. In a web
   session that "localhost" is a NAT'd container on a reserved address
   (192.0.2.2) with no inbound exposure and no tunnel tooling installed.
2. **Campaign data would evaporate.** It writes to `~/.claude/dnd/`, and the
   container is reclaimed after inactivity.

Run the game from a local session. Use the web/mobile UI only as a *window* into
it, via Remote Control.

---

## Target setup: one host, play from any room

Single player, several machines in one house (main machine, living room, iPad).
Two independent mechanisms cover this; use both, for different jobs.

### 1. Display companion over LAN — for playing

```bash
bash <skill-dir>/display/start-display.sh --lan
```

Binds `0.0.0.0:5001`. Every device in the house opens
`http://<main-machine-ip>:5001` and gets the cinematic display: streamed
narration, dice roller, live character stats, and a player input panel.

Pair with autorun so you never have to touch the host machine:

```
/dm:dnd autorun on
```

Claude then polls the input panel and processes turns automatically. It will
offer to add Bash to `permissions.allow` — accept, or you'll approve a
permission prompt every single turn.

**No tunnel needed.** Tailscale/ngrok/Cloudflare only matter for players in
*other houses*, which is not this setup. If that ever changes, set
`DND_REQUIRE_APPROVAL=1` first — device approval otherwise defaults to trusting
any device that reaches it.

### 2. Remote Control — for the DM console

On the host, in the campaign directory:

```
/remote-control        # or /rc  — also available in the VS Code extension
```

Gives a session URL and QR code. Open claude.ai/code or the Claude mobile app on
any device and you're in the same conversation, with the same filesystem. Claude
keeps running on the host the whole time.

This also keeps campaign state single-sourced. Installing the plugin on all three
machines would produce three diverging copies of `~/.claude/dnd/`.

#### Requirements that actually bite

- Pro or Max plan. API-key auth is not supported.
- `ANTHROPIC_BASE_URL` must be unset or `api.anthropic.com`. Pointing it at a
  proxy or LLM gateway disables Remote Control.
- `DISABLE_TELEMETRY`, `DO_NOT_TRACK`, `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`
  and `DISABLE_GROWTHBOOK` each silently disable it — check your shell *and* any
  `settings.json` `env` block.
- Run `claude` once in the campaign directory to accept the workspace-trust
  dialog. Trust is never saved for the home directory.

---

## Campaign decisions

### Improvised, not a published module

The goal is emergent, follow-your-nose play where both DM and player are
discovering the story. That is the skill's **improvised** mode with a
`type: dynamic` arc:

- Beats are defined as *consequences* ("the party realizes the threat was
  designed to outlast any single person"), not events — many scenes could deliver
  any given beat
- `/dm:dnd arc revise` bends the arc when player choices redirect the story
- World prep is a web of 3–5 **situations**, not a plot. Skip a node and it moves
  rather than disappears
- Faction moves execute at every session end whether or not the party was watching
- The DM asks leading questions mid-scene; the player's answers become canon

Structured module import is the inverse of this goal — in that mode the DM's job
is enforcing chapter beats.

### Rules stay fixed even though the world is invented

The split is the point: improvised fiction, published mechanics. Danger is only
real if the math is outside the DM's control.

- 5e SRD stat blocks via `lookup.py`; custom creatures built to SRD CR math
- All calculation goes through the Python scripts (the skill has an explicit
  script-first rule), so dice are real RNG, not narrative convenience
- `roll_mode: players` — the DM calls for player d20s and stops; the player
  supplies the number. The DM rolls only NPCs and monsters. (`auto` mode is
  available for faster solo play, with math shown inline.)
- Encounters built against real 5e encounter math for the actual party

### Settings

| Setting | Value | Why |
|---|---|---|
| Mode | Improvised, dynamic arc | Emergent play is the goal |
| Ruleset | **2024** | Weapon mastery from L1 makes martial turns a real decision |
| Party size | ~3 PCs, all player-run | Published encounter math assumes ~4; 3 keeps distinct voices manageable |
| Roll mode | `players` | Player rolls their own dice; DM cannot fudge them |

---

## Modules considered and ruled out

Kept so this isn't re-litigated later. All were rejected for the *improvised*
goal, not for quality.

| Bundle | Verdict |
|---|---|
| **TAGDQ** (T1-4, A1-4, GDQ1-7) | 1st Edition AD&D. THAC0, descending AC, 1e save matrices — heavy conversion. Assumes large parties (Against the Giants expects ~9 PCs at L8–12). Scans of 1980 books, so text extraction for import is doubtful. |
| **A New Era of Greyhawk** | The best option *if* a published campaign were wanted. 3.0/3.5 converts to 5e easily; the two Gazetteers are edition-agnostic setting canon; Sunless Citadel (L1–3) → Return to ToEE (L4–14) → the Expeditions is a real 1–20 arc. |
| **FlexTale / Aquilae** | Natively 5E with genuine solo-scaling tooling, but mostly *content generators* — a problem an LLM DM already solves. 18 of ~90 items are VTT tile packs (unusable in a text game) and most products ship in 4–5 system variants. |

If setting canon is ever wanted, buy a **gazetteer**, not an adventure — it gives
improvisation a consistent substrate without dictating a plot.

---

## Start sequence

```bash
cd <campaign-dir>
claude                      # once, to accept workspace trust
```

```
/plugin marketplace add neuralinitiative/claude-dnd-skill
/plugin install dm@neural-initiative
/dm:dnd new <campaign-name>     # pick: improvised, 2024 ruleset
/dm:dnd character new           # x3
/rc                             # optional: drive from other rooms
```

Then, on the host, for the display:

```bash
bash <skill-dir>/display/start-display.sh --lan
```

`/dm:dnd end` at the end of every session — it saves state, updates character
files, records faction moves, and archives the display replay buffer.
