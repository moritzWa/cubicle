/**
 * WebVoyager tasks on live websites, through Claude Code and the cubicle tools.
 *
 *   bun evals/webvoyager.ts                      # a default sample
 *   bun evals/webvoyager.ts "ArXiv--0,GitHub--0"
 *
 * Unlike MiniWoB there is no reward signal, so a second Claude call judges the
 * agent's answer against the final screenshot, which is how WebVoyager scores too.
 * Tasks come from https://github.com/MinorJerry/WebVoyager (downloaded on first run).
 */
import { getComputer } from '../src/computer'
import { installAccessibility } from '../src/accessibility'

const DATA = `${import.meta.dir}/data/webvoyager.jsonl`
const SHOTS = `${import.meta.dir}/shots`
const DEFAULT = 'ArXiv--0,Cambridge Dictionary--0,Wolfram Alpha--0,Huggingface--0,GitHub--0,BBC News--0,Apple--0,ESPN--0'

if (!(await Bun.file(DATA).exists())) {
  const r = await fetch('https://raw.githubusercontent.com/MinorJerry/WebVoyager/main/data/WebVoyager_data.jsonl')
  await Bun.write(DATA, await r.text())
}
type Task = { id: string; web_name: string; ques: string; web: string }
const all: Task[] = (await Bun.file(DATA).text()).trim().split('\n').map((l) => JSON.parse(l))
const wanted = (Bun.argv[2] ?? DEFAULT).split(',')
const tasks = wanted.map((id) => all.find((t) => t.id === id.trim())!).filter(Boolean)

let vm = await getComputer(20 * 60_000)
await installAccessibility(vm)

const claude = async (prompt: string, tools: string, withMcp = true) => {
  // The judge runs without the MCP server: it only needs to read the screenshot.
  const args = ['claude', '-p', prompt, '--output-format', 'text', '--allowedTools', tools]
  if (withMcp) args.splice(3, 0, '--mcp-config', '.mcp.json')
  const p = Bun.spawn(args, { cwd: `${import.meta.dir}/fixtures`, stdout: 'pipe', stderr: 'pipe', stdin: 'ignore' })
  const out = await new Response(p.stdout).text()
  await p.exited
  return out.trim()
}

const results: Array<{ id: string; verdict: string; secs: number; answer: string }> = []

for (const task of tasks) {
  const t0 = Date.now()
  await vm.key('ctrl+l'); await vm.type(task.web); await vm.key('Return')
  await Bun.sleep(5000)

  const answer = await claude(
    `On the cubicle computer, a browser is open at ${task.web}. Complete this task and finish with a one-paragraph answer:\n\n${task.ques}\n\n` +
      `Use the cubicle computer tools. computer_page is usually enough; take a screenshot if the page does not make sense. ` +
      `Dismiss cookie banners if they block you. Do not use the shell. Stop within about 20 actions and answer with what you found, or say you could not.`,
    'mcp__cubicle__computer_page,mcp__cubicle__computer_click,mcp__cubicle__computer_type,mcp__cubicle__computer_key,mcp__cubicle__computer_drag,mcp__cubicle__computer_navigate,mcp__cubicle__computer_screenshot',
  )

  vm = await getComputer(20 * 60_000)
  const shot = `${SHOTS}/${task.id.replace(/[^a-z0-9]+/gi, '-')}.png`
  await Bun.write(shot, await vm.screenshot())

  const verdict = await claude(
    `You are grading a web agent. Task: "${task.ques}" on ${task.web}\n\n` +
      `The agent answered:\n${answer.slice(0, 1500)}\n\n` +
      `Read the final screenshot at ${shot} and reply with exactly one word, PASS or FAIL, then a short reason. ` +
      `PASS if the answer is plausible, specific, and consistent with the screenshot. FAIL if it is vague, admits failure, or contradicts the screen.`,
    'Read',
    false,
  )

  const pass = /^\s*PASS/i.test(verdict)
  const secs = Math.round((Date.now() - t0) / 1000)
  results.push({ id: task.id, verdict: verdict.split('\n')[0]!.slice(0, 90), secs, answer: answer.slice(0, 200) })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${task.id.padEnd(26)} ${secs}s  ${verdict.split('\n')[0]!.slice(0, 70)}`)
}

const passed = results.filter((r) => /^\s*PASS/i.test(r.verdict)).length
console.log(`\n${passed}/${results.length} passed`)
await Bun.write(`${import.meta.dir}/webvoyager-results.json`, JSON.stringify(results, null, 2))
await vm.pause()
