# Cubicle: design (v0)

A cute little persistent computer for your coding agent. CLI command: `cubicle` (npm package `cubicle-agent`; binary name is independent of package name).

**Self-hosted only.** Each user deploys the whole stack (backend on Fly + Neon + their own Anthropic/E2B keys). We host nothing and store no one's keys.

Give CLI coding agents (Claude Code, Codex, Cursor) a persistent computer with its own
computer-use sub-agent. Replaces: "write a brief → pbcopy → paste into Grok Bot → paste result back".

## Decisions

| Area | Decision |
|---|---|
| Users | CLI coding agents via MCP. No chat UI. |
| Harness | Our own loop (Vercel AI SDK), running on a **backend** so tasks continue with the laptop closed. Sub-agent has its own context; parent gets a compact text result. |
| Model | BYOK, model-agnostic via AI SDK. Default **Claude Fable 5.1** (tops OSWorld 2.0 at 77.9%, vs GPT-6 Astra 72.6%), using its native computer-use tool. Re-check the leaderboard before locking in. |
| VM | Own image (Xvfb + Chrome + control adapter + VNC) on E2B Desktop. BYO sandbox key (no self-hosted sandboxes). Daytona as backup. |
| Persistence | v0: E2B pause/resume of the whole VM. Later: snapshots, then base image + hydrated profile. |
| Concurrency | One computer per user; tasks queue. Fork snapshots later. |
| Contract | Text in, text out. Guardrails go in the task text. Images backlogged. |
| Events | `needs_input`, `question`, `stuck`, `done`, `failed`, `timeout` |
| Push | `wait_for_event` (blocking, any client). Claude Code Monitor/Channels later. MCP Tasks when clients support it. |
| Approvals | Model self-judges, like Claude Code in bypass mode. |
| Secrets | Local MCP server runs `op` (Touch ID) or a native prompt for OTPs, then sends the value straight to the VM. Never returned to a model. |
| Takeover | E2B's VNC URL, wrapped in a page with a "Needs your attention" banner + **Skip** / **I'm done, continue**. Agent also watches the screen so it doesn't hang. WebRTC (Neko) only if it lags. |
| Durability | Task = DB row (messages + VM id + status). A sweeper re-runs stuck tasks. No Temporal. |
| Auth | Single-tenant: one random `CUBICLE_TOKEN` generated at deploy, set on backend + CLI. Takeover links: short-lived signed URLs. GitHub OAuth only if we ever host. |
| Backend | Bun worker on Fly + Neon Postgres + Drizzle (as in arca). |
| Broker link | The MCP server holds an outbound WS to the backend and registers as this user's secret broker + notifier. No broker connected (Claude Code closed) → `fill_secret` and notifications park until it reconnects. |
| Notify | When a task needs you: local MCP server fires a macOS notification + opens the takeover tab. Agent sets the banner text via `request_human(message)`. No phone/email. |
| Debug | Backend stores screenshot + action per step behind a debug flag. |
| Onboarding | Check `op` works; if not, tell the user to enable 1Password → Settings → Developer → Integrate with 1Password CLI. |
| License | Apache-2.0, everything open. Hosted version is an optional later convenience. |

## Components

```
Claude Code ──stdio MCP──► cubicle MCP server  [user's Mac]
                            ├─ tools: start_task, wait_for_event, reply, cancel
                            └─ secret broker (op CLI / native prompt)
                                     │ https + token
                                     ▼
                            backend (Bun worker on Fly + Neon)
                            ├─ tasks/messages, sweeper, event stream
                            └─ agent loop (AI SDK) ── BYOK ──► model API
                                     │ tools
                                     ▼
                            E2B VM (our image)
                            ├─ control adapter: screenshot click type scroll key shell fs
                            ├─ Xvfb → Chrome
                            └─ VNC ──► takeover URL (browser)
```

## Sub-agent tools

`screenshot`, `click`, `type`, `scroll`, `key`, `shell`, `read_file`/`write_file`,
`web_search`, `fill_secret(service, field)`, `ask_parent(msg)` (emits question), `request_human(message)` (banner + takeover), `done(result)`.

## Milestones

0. **De-risk spike (half a day, before anything else):** boot E2B desktop, sign into Google + GitHub by hand over VNC, pause, resume the next day. Check: still signed in? egress IP changed? `date` correct? If logins don't survive, the persistence plan changes before any code is written.
1. VM image boots on E2B with **cua-driver** (MIT, Linux: AT-SPI tree + XTest/uinput input) as the control adapter; screenshot/click/tree works from a script.
2. Loop + tools: "run a speed test, return up/down" works end to end from a CLI.
3. Wrap as MCP: Claude Code delegates it and gets the result.
4. Pause/resume: log into GitHub once, a later task is still logged in.
5. `needs_input` round trip + takeover URL.
6. `fill_secret` via 1Password.
7. Real test: the SharePoint flow.
8. **Pluggable loops:** the computer is an inner MCP server, so the harness swaps out — AI SDK + BYO key (default, any provider), Claude Agent SDK on a Max plan, or Codex app-server / OpenAI Agents SDK on a ChatGPT plan. Same VM tools for all three, and any client can talk inner MCP directly.
9. **`run_js` mode:** persistent Bun `vm` context in the VM with a `computer.*` global (cua-driver TS SDK) + human mouse paths (ghost-cursor `path()`); model writes one script per turn using the accessibility tree.
10. **Profile hydration:** base image + Chrome profile/keyring restore. Backup if E2B pause proves unreliable, and removes provider lock-in.

## Non-goals (v0)
Chat UI, billing, multi-tenant auth, profile hydration, image returns, parallel VMs per user.

## Risks & things to decide during build

### Will bite in milestones 1-3
- **Coordinate scaling:** set Xvfb to exactly the screenshot size sent to Claude (e.g. 1280x800). Never rescale.
- **Screenshot history:** copy Anthropic's reference harness: keep last 3 images, drop in chunks of 3 (keeps prompt cache hits).
- **Loop caps:** max steps + max tokens per task, then `failed` with a partial result.
- **`wait_for_event` timeout:** the Claude Code MCP tool timeout is unknown. Return `still_running` after ~5 min; the tool description tells the parent to call again.
- **Look at Cua (trycua) before milestone 1** — open-source CU infra with MCP; building block or competitor. Bytebot (Apache-2.0) for adapter API reference.
- **Start from E2B's desktop template** (Xfce + xdotool + VNC already in it) rather than building an image from scratch.

### Will bite at milestone 4+ (real logins)
- **Bot detection:** datacenter IPs + new device → Google "browser may not be secure", Microsoft conditional access, Cloudflare challenges. Drive Chrome only via OS-level input (xdotool), never via CDP or automation flags, so `navigator.webdriver` stays false. May eventually need a stable or residential egress IP.
- **Egress IP changes on resume:** E2B's docs say nothing about egress IP stability (they only document `updateNetwork` egress rules), so milestone 0 has to measure it. Resume also resets the sandbox timeout to the 5-minute default.
- **Clock skew after resume:** VM clock may resume from pause time → TLS/TOTP errors. Test (pause 10 min, resume, `date`); if stale, time-sync via E2B's `onResume` hook. Pause also resets E2B's 24h session cap.
- **Chrome after resume:** memory resume = Chrome never restarts, so no "Restore pages?" bubble. Only relevant for later hydration: set `exited_cleanly: true` in Preferences before launch.
- **Disk:** downloads + Chrome cache fill the disk over months. Cleanup job.

### Concurrency & crashes
- **Parked tasks:** 24h cap then `failed` (orphan cleanup); until then VM pauses after ~5 idle min; new tasks get `busy: waiting for you to <X>` instead of silently queuing.
- **Human and agent on one screen:** the takeover view is view-only until `request_human`; the agent is paused while you have control.
- **Crash mid-action is not idempotent** (e.g. double form submit). Record tool calls as started/finished; on recovery, never replay the last action. Take a fresh screenshot and let the model reassess.
- **Multiple Claude Code sessions** each spawn an MCP server → duplicate notifications and tabs. Only the session that started a task notifies for it.

### Security
- **Prompt injection is the big one.** The sub-agent reads arbitrary pages while logged into your accounts, with a shell. Worse, its result flows into Claude Code, which runs with bypass permissions on your Mac. Mark results as untrusted in the tool description; keep them short and factual.
- **Takeover URL = full control** of a logged-in desktop: signed, short-lived, single-use. Check whether E2B's stream URL is unauthenticated by default; if so, proxy it.
- **Secrets:** never in the messages table, logs, or debug trajectories. `fill_secret` checks the page's registrable domain (eTLD+1) against every URL on the 1Password item; no match (e.g. getgoogle.com, or SSO on microsoftonline.com) → native prompt showing the domain, never silent. Supports OTP via `op item get --otp`, and verifies the focused element is a password/OTP field.
- **1Password lookup ambiguity:** several items for one domain → native picker, never a guess.

### Newly found gaps
- **Real Google Chrome, not Chromium.** Google blocks sign-in on some Chromium builds ("this browser may not be secure"). Install the Chrome .deb in the image.
- **Chrome exposes no accessibility tree to AT-SPI by default** — launch with `--force-renderer-accessibility`, or the tree stops at the window frame and milestone 8 is dead on arrival.
- **Native computer tool vs `run_js` conflict:** Claude's native tool is trained on screenshots + coordinates. `run_js` is a *second* tool alongside it, not a replacement — decide with the eval set, don't assume.
- **Snapshot loss = all logins gone** (E2B garbage-collects or bugs out). `tar` the Chrome profile to your own storage on every pause — this is literally the first half of milestone 9, so do it early and hydration becomes a small extra step.
- **OTP fields are not masked**, so the screenshot right after `fill_secret` shows the code. Skip debug screenshots for a few steps after any secret fill.
- **Fly auto-stops on idle connections, not idle CPU**, so a long loop with no inbound requests can be killed mid-task. Set `min_machines_running = 1` (~$2-3/mo) rather than engineering around it.
- **Steal OpenMuse's SQL-lease pattern** for the durable task worker (MIT, `CopilotKit/openmuse`): worker takes a DB lease on a task, lease expiry = crash = another worker picks it up. Also does PGlite for local mode.
- **Eval determinism:** live sites change under you. Serve a static site inside the VM for regression tests, plus a couple of live tasks.
- **MCP tool description is load-bearing:** if it's vague, Claude Code never delegates. It must also say "don't put secrets in the task text".

### Done since
- **`computer_paste` generalises `fill_secret`**: one primitive, two sources - a 1Password
  field, or a named value the user stashed locally (`cubicle stash ssh_pub --file ...`).
  Values pass **by name**, so neither the parent nor the sub-agent ever holds the value.
  This is also the answer for "generate an SSH key locally, paste it into a web UI".
- **File transfer** both ways: `computer_upload_file` / `computer_download_file`.
- **Provisioning moved out of the request path** (`cubicle setup`): a fresh sandbox takes
  longer than the 60s MCP clients allow per tool call, and the first call timed out.
  Resume + light provision is ~2s; package installs happen once, up front.

### Missing from the contract
- **Files.** The SharePoint flow probably needs to move files (download a cert, upload a manifest). Text-only can't do that. Add `upload_file` / `download_file` MCP tools (backend relays to VM filesystem) before milestone 7.
- **Proof of work:** the sub-agent can claim success it didn't achieve. Store the final screenshot per task (for you, not the model) so you can check.

### Cost
- E2B desktop needs ~2 vCPU / 4 GB for smooth Chrome. Auto-pause after N idle minutes; measure paused-storage cost per month.

### Testing
- A fixed eval set (speed test, read a GitHub setting, download a file) run before changes to the loop or prompts — OpenInstinct's `bench:browser` idea.

## Research notes

- **Codex local computer use ("Sky"):** `~/.codex/computer-use/Codex Computer Use.app` runs `SkyComputerUseService` (from OpenAI's Sky acquisition). Accessibility-tree first (`get_app_state` → AX tree, act on elements), virtual cursor, doesn't steal focus. Exposed to the model through a persistent **Node REPL** (IPC client type `NODE_REPL`): the model writes JS that calls the computer API, so one model turn can run many actions. Matches OpenAI's advice to prefer code execution over the one-action-per-call `computer` tool. Candidate v1 upgrade: `run_js` tool in the VM with a `computer.*` API + AX tree (Linux: AT-SPI) instead of pure screenshot/click.

## Milestone 0 results (2026-09-22, E2B `desktop` template)

- Ubuntu 22.04.5, 8 vCPU / 8 GB, display **1024x768 (XGA — matches Anthropic's recommendation)**.
- **Real `google-chrome` is preinstalled** (plus firefox-esr). No Chromium workaround needed.
- **AT-SPI present** (`at-spi-bus-launcher`, `at-spi2-registryd`) → cua-driver's accessibility path is viable.
- Pause **416 ms**, resume **363 ms** (idle VM). Filesystem survived.
- **Egress IP stable across pause/resume** (136.117.22.78 both sides).
- **Clock correct after resume** (1 s drift over a 2 min pause). Re-test over a multi-day pause.
- **The VNC stream URL is public**: `https://6080-<sandboxId>.e2b.app/vnc.html` returns 200 with no auth. Anyone with the sandbox id gets full control of the logged-in desktop → the takeover page must proxy it, or the stream must be started with `requireAuth`.
- Still open: do Google/GitHub logins survive a multi-day pause?

### Milestone 0, part 2 — pause/resume semantics (verified)

- Two full pause → resume → write → pause → resume cycles: **all state survived.** E2B issue #884 does not reproduce.
- **Hitting the sandbox timeout silently reverts to the last explicit pause.** Verified: wrote `m3.txt`, set a 30s timeout, waited 100s, reconnected — `Sandbox.connect()` succeeded with no error, `m3.txt` was gone, and the file from the previous pause was intact. Also lost an entire Chrome session and its profile this way.
- Operational rule: **pause explicitly on idle; never let a sandbox reach its timeout.** Anything since the last pause is lost, without any error to catch. The idle-pause job is therefore a correctness requirement, not a cost optimization.
- The desktop image autostarts **xfce4-screensaver**, which blanks the screen to black within ~1 min and makes the VNC view look broken. Remove `/etc/xdg/autostart/xfce4-screensaver.desktop` in our image.
- **noVNC cannot read the host clipboard**, so manual login can't paste a password. Built a bridge (`spike/08-clipsync.ts`): Mac clipboard → `files.write` → `xclip` in the VM. The takeover page needs this built in.
- `xclip -i` holds the selection and never exits — run it detached, or the command call hangs until timeout.
- Chrome in this image is outdated ("Can't update Chrome" bubble) and logs harmless dbus errors. Pin a current Chrome in our own image.

### Milestone 0, part 3 — the core thesis holds (2026-09-24)

- Signed into Google by hand over VNC, then **pause → resume → Gmail loads straight into the inbox.** The authenticated-computer premise works.
- **No bot-detection block.** Google did not show "this browser may not be secure" from an E2B datacenter IP with a fresh profile. It did prompt for a passkey (dismissible via "Cancel") and emailed a "new sign-in on Linux" security alert.
- Full session cookie set persisted (`SID`, `__Secure-1PSID`, `__Secure-1PSIDTS`, …) across 7 Google domains.
- **Typing beats the clipboard.** X11 clipboard content lives in the process that owns it, so the sync bridge emptied the clipboard every time it replaced `xclip` — "Paste" stayed greyed out. `xdotool type` into the focused field works first time and is the same path `fill_secret` will use. Don't build a clipboard bridge; build typing.
- Login needed ~4 steps from outside the VM: click field, type email, dismiss passkey dialog, type password. All via cua-driver-style primitives, no model involved.
- Still open: does the session survive a multi-day pause?

## Milestone 6 done early — `fill_secret` works (2026-09-24, overnight)

Built and verified end to end against a local eval site, with no model in the loop.

**What works**
- `op` (1Password CLI 2.39) on the Mac, desktop-app integration already enabled. `op item get --otp` gives live TOTP codes.
- Created a `Cubicle Eval Site` login item (username, password, TOTP) in the Personal vault, pointed at `login.evalsite.com`.
- `evalsite/server.py`: a stdlib login site (username+password → TOTP → `CUBICLE_LOGIN_OK`), served inside the VM on port 80 with a `/etc/hosts` entry, so the domain has a real eTLD+1.
- **Full login filled from 1Password: username, password and a live TOTP code, all accepted.** `spike/24-login-flow.ts`.
- Secrets are written through the file API and typed with `xdotool`, then shredded — never in a command line, process list, log, or model context.

**Accessibility tree works, so the agent doesn't have to trust itself**
- Chrome only joins the AT-SPI tree when launched *after* the accessibility bus with `--force-renderer-accessibility` (plus `python3-pyatspi`, which the template lacks).
- `vmagent/accessibility.py` reads the focused tab's URL from Chrome's address-bar node, the focused element's role, and every form field with screen coordinates.
- So `fill_secret` takes the domain from **Chrome itself**, not from the caller, and refuses to type a password into anything that isn't a password field. Verified: focusing the URL bar returns `refused: focused field "Address and search bar" is not a password field`.

**Refusals verified**
| case | result |
|---|---|
| `getevalsite.com` (lookalike) | `refused: no_match` |
| unknown domain | `refused: no_match` |
| junk URL | `refused: no_match` |
| password into URL bar | `refused: not a password field` |
| 1Password locked / prompt unanswered | `needs_human: unlock the desktop app` |

**Gotchas found**
- `op` blocks forever on an unanswered biometric prompt. Every call is now bounded (20s) and a timeout maps to `needs_human`, so a locked Mac parks the task instead of hanging the agent.
- Chrome's "Save password?" bubble covers the page after each fill. Fixed with a managed-policy file (`PasswordManagerEnabled: false`), now in `src/setup-vm.ts` along with the screensaver removal.
- `localhost` has no registrable domain, so the phishing check can't work against it — eval sites need a real hostname.

**Left for the morning:** unlock 1Password and re-run `bun spike/31-e2e.ts <sandbox>` for the accessibility-hardened pass (the pre-hardening run already passed).

## Milestone 1 (partial) — reproducible provisioning (2026-09-24, overnight)

`src/provision.ts` turns a stock E2B `desktop` sandbox into a Cubicle computer, idempotently.
Verified on a **brand-new sandbox**: created, provisioned, Chrome launched, accessibility tree
read from `example.com`, screensaver gone, Chrome policy in place, paused — **27 seconds total**.

This script is the content of the future custom template. It is not a template yet: `docker`
isn't installed on this Mac, so `e2b template build` can't run. Provisioning at runtime costs
~20s on a cold sandbox (mostly the `python3-pyatspi` apt install) and nothing on resume.

Sandbox ids live in `spike/.sbx` (untracked). **Never commit one**: the VNC URL
`https://6080-<id>.e2b.app/vnc.html` is public with no auth, so the id alone grants
full control of a logged-in desktop.
