# 👀 Screen Buddy

An AI buddy that floats on top of whatever you're doing, looks at your screen
now and then, and chats with you about it.

- **Always on top.** A small chat panel that stays above every app, including
  full-screen ones. You can drag it, collapse it to a bar, or hide it with
  **Ctrl/Cmd + Shift + Space**.
- **Message it any time.** Type a question and press Enter. It takes a
  screenshot, saves it, and your buddy answers with the screen in view
  ("why is this test failing?", "does this layout look off?").
- **Auto check-ins.** Every N minutes (1–30, or never) it takes a screenshot on
  its own. The buddy only speaks up when something is worth it, like an error
  on screen or a likely mistake. Then you get a desktop notification and the
  window flashes. The rest of the time it stays quiet.
- **Adjustable panel.** A−/A+ (or Ctrl −/+, Ctrl 0 to reset) changes only
  the chat text size. The window − ▢ + buttons (or Ctrl+Shift −/+) resize the
  window. The ◐ slider makes the panel see-through. All of these are remembered.
- **Detail level.** Screenshots are captured at the size you pick in the
  panel, not full 4K: Low (1024 wide, ≈800 tokens each), 720p (1280, ≈1.2k,
  the default), High (1568, ≈1.8k) or 1080p (1920, ≈2.8k). Smaller uses up
  less of your buddy's context; larger keeps small text readable.
- **Everything goes to a file.** Each screenshot is saved as a PNG in
  `~/ScreenBuddy/`. `log.jsonl` there records every message, reply, and
  screenshot path.

## Run it

```bash
cd screen-buddy
npm install
cp .env.example .env     # then paste your ANTHROPIC_API_KEY
npm start
```

Without a key it runs in **sample mode**. Screenshots and the log still work,
but the replies are canned.

**macOS:** on first capture, grant Screen Recording permission (System Settings
→ Privacy & Security → Screen Recording) to Electron / your terminal, then
restart the app.

## Talk to a specific Claude (Claude Code session)

Screen Buddy can use one Claude Code session you already have as your buddy,
instead of starting its own chat. That Claude keeps everything it already knows
about your project and your conversation. That session can even be one you
started on claude.ai/code and pulled onto your computer with `claude --teleport`.

1. Install Claude Code. Windows (PowerShell): `irm https://claude.ai/install.ps1 | iex`
   (use this native installer, which gives you `claude.exe`, not the npm package).
   Mac/Linux: `curl -fsSL https://claude.ai/install.sh | bash`
2. Open the session in your project folder: `claude --teleport <web session id>`
   for a web session, or `claude --resume` to pick a local one.
3. **Send it one message** (e.g. "hi") so the session is saved, then exit.
4. In `screen-buddy/.env`:
   ```
   SCREEN_BUDDY_BACKEND=claude-code
   SCREEN_BUDDY_SESSION=latest   # or a specific ID from /status
   SCREEN_BUDDY_PROJECT_DIR=/path/to/your/project
   ```
5. `npm start`. The footer should read "Claude Code session …".

How it talks to the session:

- **One running `claude`.** It starts when Screen Buddy opens (`claude -p
  --resume <id> --input-format stream-json --output-format stream-json`) and
  every message goes into that same process. There's no startup wait per
  message, and follow-ups come back in a few seconds.
- **The screenshot goes in with the message** as an image, so Claude doesn't
  need a Read-tool round trip to see it. Only the Read tool is allowed, for
  looking back at older screenshots.
- **Replies stream** into the panel as they're written.
- **The session is released cleanly.** When you quit (✕ then Ctrl+C in the
  terminal, or closing the app), Screen Buddy closes `claude`'s input so it
  saves and exits on its own; it's force-stopped only if it hangs for 5 seconds.
  After 10 idle minutes it's also shut down, freeing the session for VS Code;
  the next message starts it again.
- The first message after starting is the slowest, because Claude has to load
  the whole session. A long session is slower to load.

Tip: set the check-in interval to "never" or 15+ minutes, because every
check-in is added to that session's history.

## How it works

```
timer (every N min) ─┐
                     ├─► capture screen ─► save PNG + log.jsonl ─► Claude (image + text)
you hit Enter ───────┘                                                │
                                   reply ◄───────────────────────────┘
                    auto + "[quiet]" → nothing shown
                    auto + comment   → notification + flash + chat bubble
                    your message     → chat bubble
```

| File | What it does |
|---|---|
| `src/main.js` | Electron main process: floating window, capture, timer, notifications, file log |
| `src/buddy.js` | Prompt + Claude call + rolling text memory (no Electron, unit-tested) |
| `src/frames.js` | Tiny frame-diff so an unchanged screen skips the API call |
| `src/renderer/` | The chat panel UI |

### Keeping costs sane

- **No change, no call.** Auto check-ins compare a 64×36 thumbnail with the
  last one. If the screen hasn't changed, no API call is made.
- **Only the current screenshot is sent.** Older turns are kept as text memory
  (last 20 exchanges), so the context doesn't fill up with images.
- Screenshots are captured at the Detail size you choose (720p by default) and sent as JPEG. Auto check-ins
  use `low` effort and your messages use `medium`.

### Privacy

- The buddy's own window is left out of screenshots. That uses content
  protection on macOS and Windows; on Linux the window hides for a moment
  instead.
- ⏸ pauses auto check-ins. When paused, a screenshot is only taken when you
  send a message.
- Screenshots stay on your machine. The only thing sent anywhere is the
  current screenshot, to the Anthropic API, when a check-in happens.
- It's told never to repeat passwords or keys it sees. Still, pause it before
  you open anything sensitive.

## Config (`.env`)

| Variable | Default | |
|---|---|---|
| `ANTHROPIC_API_KEY` | – | Required for real replies |
| `SCREEN_BUDDY_MODEL` | `claude-opus-5` | Any vision-capable Claude model |
| `SCREEN_BUDDY_DIR` | `~/ScreenBuddy` | Where screenshots + `log.jsonl` go |
| `SCREEN_BUDDY_BACKEND` | `api` | `claude-code` to talk to a Claude Code session |
| `SCREEN_BUDDY_SESSION` | `latest` | Session ID for the `claude-code` backend, or `latest` |
| `SCREEN_BUDDY_PROJECT_DIR` | cwd | Folder that session lives in |
| `SCREEN_BUDDY_CLAUDE_MODEL` | session's model | e.g. `sonnet` for faster replies |
| `SCREEN_BUDDY_IDLE_MIN` | `10` | Minutes idle before `claude` is shut down (0 = never) |

The check-in interval and pause state are saved between runs.

## Tests

```bash
npm test
```
