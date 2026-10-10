# ultimate-status

A colorful, clickable status bar for Claude Code.

**Inside tmux**, it gets three rows right under the tmux tabs: a divider, the bar, a divider. It stays put while you scroll. The rows show only while a Claude pane is active.

**Outside tmux**, it sits on its own line, directly above the chat box. Hover any part to see what it means.

<br>

## What it shows

**Left side**

- `◆ Model ⚡ Speed`
  - Click it for a menu: **Model…** (opens `/model`) or the speed switch (`/fast`).
- **The full path**, like `~/WorkSpace/MacForce/`
  - Each folder has its own color.
  - Click a folder for a menu: **New tab** or **Tab + Claude**.
  - In tmux these open a tmux tab; outside tmux, an iTerm2 tab.
  - The path uses all the room left. Middle folders shrink to one letter only when needed.

**Right side**

- **Git branch**
- **ctx**: a context bar and a percent.
- **5h** and **7d**: how much usage you have left.
- Each label and value has its own matching color.

<br>

## Arrange the bar (tmux)

The bar is made of blocks: model, path, branch, ctx, usage. Left blocks are pinned to the left edge, right blocks to the right edge.

- `/ultimate-status unlock`: the dividers turn yellow `┃`.
  - Drag a divider to resize the block next to it.
  - Drag a block to move it, even to the other side. It moves when you let go.
- `/ultimate-status lock`: done. Clicks open the menus again.
- `/ultimate-status reset`: back to the first layout.

Your layout is saved between sessions.

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
