# ultimate-status

A colorful, clickable status bar for Claude Code.

**Inside tmux**, it gets three rows right under the tmux tabs: a divider, the bar, a divider. It stays put while you scroll. The rows show only while a Claude pane is active.

**Outside tmux** (and on Windows, which has no tmux), it sits on its own line, directly above the chat box. Claude Code has no spot at the top of the screen, so the top bar needs tmux. Hover any part to see what it means.

<br>

## What it shows

Each piece of data is an **item**: Model, Speed, Path, Git branch, Context, 5h usage, 7d usage.

- **Model** and **Speed**: click for a menu, **Model…** (opens `/model`) or the speed switch (`/fast`).
- **Path**, like `~/WorkSpace/MacForce/` (or `E:\Code\app\` on Windows)
  - Each folder has its own color.
  - Click a folder for **New tab** or **Tab + Claude**: a tmux tab inside tmux, a Warp tab in Warp, an iTerm2 tab in iTerm2.
  - Middle folders shrink to one letter only when there is no room.
- **Context**: a bar and a percent. Pick its style: Line `━━━━` (the default, looks right in any font), Blocks, Shade or Dots.
- **5h** and **7d**: how much usage you have left.

<br>

## Settings panel

Type `/ultimate-status config`. It opens inside Claude Code, so it works in any terminal (iTerm2, Warp, Windows Terminal, ...).

- **Blocks** tab: blocks pin to the left or right edge. Per block: its divider (`│ ┃ ║ ┆ | · • /` or none), what goes between its items, whether its divider resizes it, and its width.
- **Items** tab: which block each item goes in, or hidden. Items in one block share it with no divider between. Also the context bar style.
- **Colors** tab: pick from your terminal theme's 16 colors (they follow your theme), a Catppuccin flavor, or any `#hex`.

Keyboard only works too: Tab or ↑↓ moves, Enter acts. An open dropdown keeps the keys until you pick or cancel. Everything saves right away.

<br>

## Arrange the bar by dragging (tmux)

- `/ultimate-status unlock`: resizable dividers turn yellow `┃`.
  - Drag a divider to resize its block.
  - Drag a block to move it, even to the other side. It moves when you let go.
- `/ultimate-status lock`: done. Clicks open the menus again.
- `/ultimate-status reset`: back to the first layout.
- `/ultimate-status version`: shows the installed version.

Colors start as [Catppuccin Macchiato](https://catppuccin.com).

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

## Settings file

The panel saves to `ultimate-status.json` in your Claude config folder (`~/.claude/`, or `$CLAUDE_CONFIG_DIR`). You can edit it by hand too; changes show on the next redraw.

- `bar`: the blocks, in order. Each has `side`, `items`, `divider`, `joiner`, `resizable` and an optional `width`.
- `colors`: any of `dim`, `info`, `model`, `speed`, `path` (a list), `branch`, `ctxLabel`, `ctxValue`, `fiveLabel`, `fiveValue`, `weekLabel`, `weekValue`, as `#rrggbb` or `ansi:0` to `ansi:15` (your terminal theme's colors).
- `ctxBar`: `line`, `blocks`, `shade` or `dots`.
- `pathMax`: outside tmux, the path shrinks past this many characters.
- An older `layout` key is still read, and becomes blocks.

<br>

## Heads-up

- **Mouse clicks need the fullscreen layout.** It's on by default in Claude Code. Inside tmux, clicks work too if `mouse` is on in tmux and your terminal reports the mouse (in iTerm2: Profiles > Terminal > "Enable mouse reporting").
- **Mouse in Warp:** turn on Settings > Features > Terminal > Enable Mouse Reporting.
- **Folder tabs** need tmux, Warp, or iTerm2 on macOS. In Warp, **Tab + Claude** writes a Tab Config named `ultimate_status_claude` to run `claude`.
- **Early-access API.** This mod is built on Claude Code's early-access mod API, which may change.

<br>

## License

MIT. See [LICENSE](LICENSE).
