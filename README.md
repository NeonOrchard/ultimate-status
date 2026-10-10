# ultimate-status

A colorful, clickable status bar for Claude Code.

Inside tmux, it sits on a fixed line at the top of Claude's pane, right under the tmux tabs, so it stays put while you scroll. Outside tmux, it sits on its own line, directly above the chat box. Hover any part to see what it means.

<br>

## What it shows

**Left side**

- `◆ Model ⚡ Speed`
  - Click it for a small menu.
  - **Model…** opens `/model`.
  - **Speed** turns `/fast` on or off.
- **The full path**, like `~/WorkSpace/MacForce/`
  - Each folder has its own color.
  - Click a folder for a menu: **New tab** or **Tab + Claude**.
  - Both open an iTerm2 tab in that folder.
  - Long paths shrink the middle folders to one letter.
- **Git branch**

**Right side**

- **ctx** — a context bar and a percent.
- **5h** and **7d** — how much usage you have left.
- Each label and value has its own matching color.

Colors are [Catppuccin Macchiato](https://catppuccin.com).

<br>

## Install

At the prompt of a Claude Code terminal session, type:

```
/plugin install ultimate-status --marketplace NeonOrchard/ultimate-status
```

Then:

- Press `y` to add the marketplace.
- Pick a scope (user scope is first; press **Enter**).

That's it. It works right away, no restart.

<br>

## Settings (optional)

Make a file named `ultimate-status.json` in your Claude config folder (`~/.claude/`, or `$CLAUDE_CONFIG_DIR` if you set it). Every key is optional:

```json
{
  "layout": {
    "left": ["model", "path"],
    "right": ["branch", "ctx", "usage"],
    "widths": { "branch": 20 }
  },
  "colors": { "model": "#c6a0f6", "path": ["#8aadf4", "#7dc4e4"] },
  "pathMax": 28
}
```

- `layout`: which blocks sit on each side, in order, and fixed widths in columns. Blocks are `model`, `path`, `branch`, `ctx` and `usage`. Used inside tmux.
- `colors`: any of `dim`, `info`, `model`, `speed`, `path` (a list), `branch`, `ctxLabel`, `ctxValue`, `fiveLabel`, `fiveValue`, `weekLabel`, `weekValue`, as `#rrggbb`.
- `pathMax`: outside tmux, the path shrinks its middle folders past this many characters.
- Dragging the bar (`/ultimate-status unlock`) saves its layout into this file. `/ultimate-status reset` takes it out again.

Changes show on the next redraw. No restart needed.

<br>

## Heads-up

- **Mouse clicks need the fullscreen layout.** It's on by default in Claude Code. Inside tmux, clicks work too if `mouse` is on in tmux and your terminal reports the mouse (in iTerm2: Profiles > Terminal > "Enable mouse reporting").
- **Folder tabs need iTerm2.** They open tabs with `osascript`.
- **Early-access API.** This mod is built on Claude Code's early-access mod API, which may change.

<br>

## License

MIT. See [LICENSE](LICENSE).
