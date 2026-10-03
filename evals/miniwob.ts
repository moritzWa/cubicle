/**
 * MiniWoB++ through Claude Code and the cubicle MCP server.
 *
 *   bun evals/setup-miniwob.ts            # once: copy the tasks into the computer
 *   bun evals/miniwob.ts                  # the default set
 *   bun evals/miniwob.ts click-pie,terminal
 *
 * The agent only gets the cubicle tools, so a pass means the computer was good
 * enough to solve the task. Scoring reads the reward MiniWoB prints on the page.
 */
import { getComputer } from '../src/computer'
import { installAccessibility, pageFields } from '../src/accessibility'

const DEFAULT_TASKS = [
  'click-button', 'enter-text', 'click-checkboxes', 'click-tab-2', 'login-user',
  'use-autocomplete', 'choose-date-easy', 'click-collapsible-2', 'search-engine',
  'enter-date', 'click-dialog-2', 'email-inbox-forward-nl',
  'drag-items', 'use-slider', 'click-pie', 'count-shape', 'tic-tac-toe', 'terminal',
  'guess-number', 'simple-algebra', 'click-shades', 'scroll-text', 'copy-paste',
  'book-flight',
]
const TASKS = (Bun.argv[2] ?? DEFAULT_TASKS.join(',')).split(',')
let vm = await getComputer(20 * 60_000)
await installAccessibility(vm)

/** MiniWoB prints the finished episode's reward on the page; the window title is
 *  wiped when it auto-starts the next episode, so read the page instead. */
async function lastReward(debug = false): Promise<number | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const f: any[] = await pageFields(vm)
    const i = f.findIndex((x) => String(x.label).startsWith('Last reward'))
    if (debug) console.log(`   [score] nodes=${f.length} idx=${i} next=${JSON.stringify(f[i + 1]?.label)}`)
    if (i !== -1) {
      const v = String(f[i + 1]?.label ?? '-')
      if (v !== '-' && v !== '') return Number(v)
    }
    await Bun.sleep(1500)
  }
  return null
}
const results: Array<{ task: string; reward: number | null; secs: number; note: string }> = []

for (const task of TASKS) {
  const t0 = Date.now()
  await vm.x(`xdotool search --onlyvisible --class google-chrome windowactivate --sync %1 || true`)
  await vm.key('ctrl+l')
  await vm.type(`http://localhost:8080/miniwob/${task}.html`)
  await vm.key('Return')
  await Bun.sleep(3000)

  // MiniWoB hides each episode behind a START overlay; click it to begin.
  const cover = (await pageFields(vm)).find((f: any) => f.label === 'START' && f.box)
  if (cover) {
    await vm.click(cover.box![0] + cover.box![2] / 2, cover.box![1] + cover.box![3] / 2)
    await Bun.sleep(800)
  }

  const prompt =
    `A MiniWoB task is open in the browser on the cubicle computer. ` +
    `Read the instruction shown at the top of the page (computer_page shows the text and the elements with coordinates), ` +
    `then complete the task by clicking and typing with the cubicle computer tools. ` +
    `Do not navigate away, do not use the shell, and stop as soon as the task is done.`

  const proc = Bun.spawn(
    ['claude', '-p', prompt, '--mcp-config', '.mcp.json', '--output-format', 'text',
     '--allowedTools', 'mcp__cubicle__computer_page,mcp__cubicle__computer_click,mcp__cubicle__computer_drag,mcp__cubicle__computer_type,mcp__cubicle__computer_key,mcp__cubicle__computer_screenshot'],
    { cwd: `${import.meta.dir}/fixtures`, stdout: 'pipe', stderr: 'pipe', stdin: 'ignore' },
  )
  const out = await new Response(proc.stdout).text()
  await proc.exited

  // The agent's MCP server pauses the computer when it exits, so resume before scoring.
  vm = await getComputer(20 * 60_000)
  const reward = await lastReward(false)
  const secs = Math.round((Date.now() - t0) / 1000)
  results.push({ task, reward, secs, note: reward === null ? (out.trim().split('\n').pop()?.slice(0, 90) ?? '') : '' })
  const verdict = reward === null ? 'NONE' : reward > 0 ? 'PASS' : 'FAIL'
  console.log(`${verdict.padEnd(5)} ${task.padEnd(24)} reward=${reward ?? '-'}  ${secs}s`)
}

const scored = results.filter((r) => r.reward !== null)
const passed = scored.filter((r) => (r.reward ?? 0) > 0)
console.log(`\n${passed.length}/${results.length} passed (${scored.length} scored), median ${
  [...results].sort((a, b) => a.secs - b.secs)[Math.floor(results.length / 2)]!.secs}s per task`)
await Bun.write(`${import.meta.dir}/results.json`, JSON.stringify(results, null, 2))
await vm.pause()
