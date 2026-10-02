# Cubicle

**A persistent, authenticated computer for your coding agent — over MCP.**

Your agent hits a step it can't do: sign into SharePoint, click through a dashboard,
copy a value out of a web UI. Today you paste a brief into some other computer-use
product, wait, then paste the answer back. You are the transport layer.

Cubicle gives the agent a computer of its own — a Linux desktop that stays signed in
between tasks, that you can take over at any time, and that any MCP client can drive.

```
you ──▶ Claude Code ──MCP──▶ cubicle ──▶ a desktop that is already you
```

![Cubicle signing into a site with a password and a TOTP code from 1Password](docs/demo.gif)

*Driven through MCP: the form fields come from the accessibility tree, and the
username, password and live TOTP code are typed straight from 1Password — the model
never sees any of them.*

```text
┌──────────────────────────────┐
│ Claude Code / Codex / Cursor │
└───────────────┬──────────────┘
                │ MCP (stdio)
                ▼
┌──────────────────────────────┐        ┌─────────────────────────┐
│ cubicle   (your Mac)         │───────▶│ 1Password / value stash │
│  13 tools, idle auto-pause   │        └─────────────────────────┘
└───────────────┬──────────────┘
                │ E2B SDK
                ▼
┌───────────────────────────────────────────────────────────┐
│ your computer: Ubuntu + Chrome, signed in, paused when     │
│ idle, resumed in ~1s, state intact                         │
└───────────────────────────────────────────────────────────┘
```

## Why it's different

Browser-infrastructure projects give an agent a *fresh* browser. Cubicle gives it
*your* computer: the same Chrome profile, the same logins, every time. It also hands
the agent the **accessibility tree** instead of only pixels, so it clicks real elements
rather than guessing coordinates — and so a password can be refused when the focused
field isn't a password field.

## Quickstart

```bash
git clone https://github.com/moritzWa/cubicle && cd cubicle
bun install
echo 'E2B_API_KEY=e2b_...' > .env        # free key at https://e2b.dev
bun bin/cubicle.ts setup                 # builds your computer (~1 min, once)
bun bin/cubicle.ts doctor                # check everything is in place

claude mcp add cubicle -- bun $PWD/bin/mcp.ts
```

Then, in Claude Code:

> check my Gmail and tell me the subject of the newest email

The first time it will need you to sign in: ask for `computer_takeover`, open the URL,
log in by hand, and every later task starts already authenticated.

`setup` is separate on purpose — provisioning a fresh sandbox takes longer than the 60s
that MCP clients allow for a single tool call.

## Does it work?

`bun test` covers the phishing/domain logic. The real proof is the end-to-end login:

```bash
bun test/e2e-login.ts     # deploys the eval site, signs in via MCP, exits 0 on success
```

That run is what the GIF above shows.

## Tools

| tool | what it does |
|---|---|
| `computer_page` | URL + every interactive element with screen coordinates, from the accessibility tree. Cheaper and more accurate than a screenshot. |
| `computer_screenshot` | 1024×768 PNG |
| `computer_click` / `computer_type` / `computer_key` | OS-level input, so pages see a real user |
| `computer_navigate` | open a URL |
| `computer_shell` | run a command in the computer |
| `computer_paste` | type a secret into the focused field without the model seeing it |
| `computer_stash_list` | names of locally stashed values (never the values) |
| `computer_upload_file` / `computer_download_file` | move files between your Mac and the computer |
| `computer_takeover` | a URL where you drive the same desktop yourself |
| `computer_pause` | save all state, including logins |

## Secrets the model never sees

```bash
# from 1Password, matched to the page's domain
computer_paste({ from: "1password", field: "password" })

# from anything you stash locally
cubicle stash ssh_pub --file ~/.ssh/id_ed25519.pub
cubicle stash deploy_token --stdin < token.txt
computer_paste({ from: "stash", name: "ssh_pub" })
```

The value goes from your Mac into the computer over the file API, is typed with
`xdotool`, then shredded. It never appears in a command line, a log, or a model's
context — the agent only ever handles the *name*.

It refuses when:

- no 1Password item matches the page's registrable domain (so `getgoogle.com` gets nothing)
- the focused element is not a text field
- a password would land somewhere that is not a password field
- 1Password is locked — that comes back as `needs_human`, not a hang

## How it works

- **Runtime**: an [E2B](https://e2b.dev) desktop sandbox — Ubuntu + Xfce + real Google Chrome.
- **Persistence**: the whole machine is paused between tasks (RAM and disk), so logins
  survive and idle costs nothing. Resume is ~1s.
- **Auto-pause** after 90s of no tool calls. This is correctness, not thrift: if a sandbox
  reaches its own timeout instead, E2B silently reverts to the last explicit pause and
  everything since is lost, with no error.
- **Accessibility**: Chrome publishes its UI tree over AT-SPI; `vmagent/accessibility.py`
  reads the focused tab's URL, the focused element, and every field with its coordinates.
- **Input**: `xdotool` against the X display, never CDP or automation flags, so
  `navigator.webdriver` stays false and sign-in pages behave normally.

## What this is not

No agent loop. Cubicle is the computer, not the brain — your MCP client does the
reasoning. There's no hosted service and no account: you run it, with your own keys.

Ideas that are designed but unbuilt, in `DESIGN.md`: a backend loop so tasks survive a
closed laptop, a takeover page with a "I'm done, continue" button, swapping the Python
accessibility agent for [cua-driver](https://github.com/trycua/cua), a `run_js` tool so
one model turn can batch many actions, and Chrome-profile hydration to drop E2B lock-in.

## Notes from building it

Things that cost a day each, written down so they don't cost you one:

- **A sandbox id is a credential.** `https://6080-<id>.e2b.app/vnc.html` serves the live
  desktop with no auth.
- **The sandbox timeout is a data-loss bug, not a limit.** It reverts to the last pause
  and `connect()` still succeeds.
- **Chrome only joins the accessibility tree if it starts *after* the a11y bus**, with
  `--force-renderer-accessibility`. Otherwise the tree is silently empty.
- **noVNC can't read your Mac's clipboard**, and syncing it with `xclip` fails too: the
  X clipboard lives in the process that owns it, so replacing `xclip` empties it. Type
  values in instead.
- **Google did not flag a datacenter IP.** No "this browser may not be secure" with a
  fresh profile over VNC, only the usual passkey prompt and a new-sign-in alert.
- The desktop image autostarts a **screensaver** that blanks the screen to black and
  looks exactly like a broken stream.

## Layout

- `bin/mcp.ts` — the MCP server
- `bin/cubicle.ts` — the CLI: `setup`, `doctor`, `stash`
- `src/` — computer lifecycle, VM control, accessibility, 1Password broker, value stash
- `vmagent/accessibility.py` — runs inside the computer, reads the AT-SPI tree. The only
  Python here; `pyatspi` is the one sane binding. It goes when cua-driver replaces it.
- `evalsite/` — a local login site with TOTP, for deterministic tests
- `test/e2e-login.ts` — the full login above, run with `bun test/e2e-login.ts`
- `DESIGN.md` — decisions, risks, and what the experiments actually showed

Apache-2.0.
