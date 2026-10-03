/**
 * Desktop GUI tasks: the file manager, text editor, archive manager, terminal app
 * and LibreOffice. Nothing here is a browser.
 *
 *   bun evals/desktop.ts
 *   bun evals/desktop.ts files-create-folder,editor-save
 *
 * The agent is given every cubicle tool EXCEPT computer_shell, so it has to use the
 * GUI. Setup and checking run over the shell from here, so each task is pass/fail
 * with no judge involved.
 */
import { getComputer } from '../src/computer'
import { installAccessibility } from '../src/accessibility'

type Task = { id: string; instruction: string; setup: string; check: string }

const TASKS: Task[] = [
  {
    id: 'files-create-folder',
    instruction:
      'Using the Files application (Thunar) on the desktop, create a new folder called "reports" inside the Documents folder. Do not use a terminal.',
    setup: 'rm -rf ~/Documents/reports',
    check: 'test -d ~/Documents/reports',
  },
  {
    id: 'files-rename',
    instruction:
      'In the Files application (Thunar), open the Documents folder and rename the file "draft.txt" to "final.txt". Do not use a terminal.',
    setup: 'rm -f ~/Documents/final.txt; echo hi > ~/Documents/draft.txt',
    check: 'test -f ~/Documents/final.txt && ! test -f ~/Documents/draft.txt',
  },
  {
    id: 'editor-save',
    instruction:
      'Open the Mousepad text editor, type exactly: cubicle works   then save the file as notes.txt in the home folder. Do not use a terminal.',
    setup: 'rm -f ~/notes.txt',
    check: "grep -qx 'cubicle works' ~/notes.txt",
  },
  {
    id: 'terminal-app',
    instruction:
      'Open the Terminal application from the desktop and use it to create an empty file called from-terminal.txt in the home folder.',
    setup: 'rm -f ~/from-terminal.txt',
    check: 'test -f ~/from-terminal.txt',
  },
  {
    id: 'archive-extract',
    instruction:
      'In the home folder there is bundle.zip. Extract it into the home folder using the graphical archive manager, then tell me what the extracted file contains. Do not use a terminal.',
    // the image has unzip but not zip, so build the archive with python
    setup: `rm -f ~/bundle.zip ~/payload.txt; python3 -c "import zipfile; z=zipfile.ZipFile('/home/user/bundle.zip','w'); z.writestr('payload.txt','orange-tiger-42\\n'); z.close()"`,
    check: "grep -q orange-tiger-42 ~/payload.txt",
  },
  {
    id: 'calc-sum',
    instruction:
      'Open LibreOffice Calc, put 5 in cell A1, 7 in cell A2 and a formula in A3 that adds them, then save the spreadsheet as sum.csv in the home folder (keep the CSV format when asked). Do not use a terminal.',
    setup: 'rm -f ~/sum.csv',
    check: "grep -q '^12' ~/sum.csv",
  },
  {
    id: 'file-permissions',
    instruction:
      'Using the Files application (Thunar), make the file script.sh in the home folder executable, via its Properties dialog. Do not use a terminal.',
    setup: 'printf "#!/bin/sh\\necho hi\\n" > ~/script.sh; chmod 644 ~/script.sh',
    check: 'test -x ~/script.sh',
  },
]

const wanted = Bun.argv[2]?.split(',')
const tasks = wanted ? TASKS.filter((t) => wanted.includes(t.id)) : TASKS

let vm = await getComputer(20 * 60_000)
await installAccessibility(vm)

const results: Array<{ id: string; pass: boolean; secs: number; note: string }> = []

for (const task of tasks) {
  const t0 = Date.now()
  // close whatever the last task left open, then put the machine in the start state
  await vm.sh('pkill -x thunar mousepad xfce4-terminal xarchiver soffice.bin 2>/dev/null; sleep 1; true')
  await vm.sh(task.setup, 60_000)

  const p = Bun.spawn(
    ['claude', '-p',
     `On the cubicle computer there is a Linux desktop (Xfce). ${task.instruction}\n\n` +
       `Use the cubicle computer tools. Applications are under the Applications menu at the top left, ` +
       `and computer_page lists what is on screen with coordinates. Take a screenshot if the page does not make sense. ` +
       `Stop when the task is done.`,
     '--mcp-config', '.mcp.json', '--output-format', 'text',
     '--allowedTools', 'mcp__cubicle__computer_page,mcp__cubicle__computer_click,mcp__cubicle__computer_type,mcp__cubicle__computer_key,mcp__cubicle__computer_drag,mcp__cubicle__computer_screenshot'],
    { cwd: `${import.meta.dir}/fixtures`, stdout: 'pipe', stderr: 'pipe', stdin: 'ignore' },
  )
  const out = (await new Response(p.stdout).text()).trim()
  await p.exited

  vm = await getComputer(20 * 60_000)           // the agent's server pauses on exit
  const ok = (await vm.sh(`${task.check} && echo PASS || echo FAIL`, 60_000)).includes('PASS')
  const secs = Math.round((Date.now() - t0) / 1000)
  results.push({ id: task.id, pass: ok, secs, note: ok ? '' : out.split('\n').pop()?.slice(0, 100) ?? '' })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${task.id.padEnd(20)} ${secs}s  ${ok ? '' : results.at(-1)!.note}`)
}

console.log(`\n${results.filter((r) => r.pass).length}/${results.length} passed`)
await Bun.write(`${import.meta.dir}/desktop-results.json`, JSON.stringify(results, null, 2))
await vm.pause()
