# ultimate-status

A colorful, clickable status bar for Claude Code.

It sits on the line under the chat box. Hover any part to see what it means.

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

## Heads-up

- **Mouse clicks need the fullscreen layout.** It's on by default in Claude Code. Inside tmux, clicks work too if `mouse` is on in tmux and your terminal reports the mouse (in iTerm2: Profiles > Terminal > "Enable mouse reporting").
- **Folder tabs need iTerm2.** They open tabs with `osascript`.
- **Mode label.** After **Shift+Tab**, the mode label's width updates on your next message.
- **Early-access API.** This mod is built on Claude Code's early-access mod API, which may change.

<br>

## License

MIT. See [LICENSE](LICENSE).
