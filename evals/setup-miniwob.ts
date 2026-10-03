/**
 * Puts MiniWoB++ (130 web tasks) inside the computer and serves it on :8080.
 *
 *   bun evals/setup-miniwob.ts
 *
 * Two patches to the upstream html, both for LLM agents rather than RL policies:
 * the episode timer goes from 10s to 10min, and the reward is also written to
 * document.title so a harness can read it without a debugger attached.
 */
import { getComputer } from '../src/computer'
import { mkdtemp, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { $ } from 'bun'

const REPO = 'https://github.com/Farama-Foundation/miniwob-plusplus'
const DEST = '/home/user/miniwob'

const dir = await mkdtemp(join(tmpdir(), 'miniwob-'))
console.log('cloning MiniWoB++...')
await $`git clone -q --depth 1 ${REPO} ${dir}/src`.quiet()
const html = `${dir}/src/miniwob/html`

const core = `${html}/core/core.js`
let js = await Bun.file(core).text()
js = js.replace(/core\.EPISODE_MAX_TIME = \d+;.*/, 'core.EPISODE_MAX_TIME = 600000; // patched: LLM agents need minutes, not 10s')
js = js.replace(
  'WOB_REWARD_GLOBAL = reward;',
  "WOB_REWARD_GLOBAL = reward;\n  try { document.title = 'WOBDONE ' + reward.toFixed(3); } catch (e) {}",
)
await Bun.write(core, js)

async function* walk(d: string): AsyncGenerator<string> {
  for (const e of await readdir(d, { withFileTypes: true })) {
    const p = join(d, e.name)
    if (e.isDirectory()) yield* walk(p)
    else yield p
  }
}

const vm = await getComputer()
let n = 0
for await (const file of walk(html)) {
  await vm.sbx.files.write(`${DEST}/${relative(html, file)}`, await Bun.file(file).arrayBuffer())
  n++
}
console.log('copied', n, 'files')

await vm.sh('sudo fuser -k 8080/tcp 2>/dev/null; sleep 1; true')
await vm.sh(`cd ${DEST} && setsid python3 -m http.server 8080 </dev/null >/dev/null 2>&1 & sleep 2; true`)
console.log('serving :', await vm.sh(`curl -s -o /dev/null -w '%{http_code}' http://localhost:8080/miniwob/click-button.html`))
console.log('tasks   :', await vm.sh(`ls ${DEST}/miniwob | wc -l`))
await vm.pause()
