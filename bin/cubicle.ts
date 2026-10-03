#!/usr/bin/env bun
/** cubicle CLI: manage the local value stash. */
import { loadEnv } from '../src/env'
import { listValues, removeValue, setValue } from '../src/stash'
import { setupComputer } from '../src/computer'
import { checkEnv, formatChecks } from '../src/preflight'

await loadEnv()

const [cmd, ...rest] = Bun.argv.slice(2)

const LOGO = String.raw`
     .-------------------------------.
     |  > computer_page              |
     |  > computer_paste             |
     |  > ok, key is evs_live_7Q2... |
     '--------------. .--------------'
    ________________|_|________________

                _       _          _
  ___   _   _  | |__   (_)   ___  | |   ___
 / __| | | | | | '_ \  | |  / __| | |  / _ \
| (__  | |_| | | |_) | | | | (__  | | |  __/
 \___|  \__,_| |_.__/  |_|  \___| |_|  \___|
`

const usage = `${LOGO}
cubicle doctor                         check the setup
cubicle setup                          create + provision a computer, then pause it
cubicle stash <name> --file <path>     stash a file's contents
cubicle stash <name> --stdin           stash piped input
cubicle stash <name> --value <string>  stash a literal (careful: shell history)
cubicle stash --list                   names and sizes only
cubicle stash --rm <name>              forget one

Stashed values can be typed into the computer with the computer_paste tool
without ever entering a model's context.`

if (cmd === 'doctor') {
  const checks = await checkEnv()
  console.log(formatChecks(checks))
  process.exit(checks.some((c) => !c.ok && c.name !== '1Password CLI') ? 1 : 0)
}

if (cmd === 'setup') {
  if (!process.env.E2B_API_KEY) {
    console.error('E2B_API_KEY is not set. Get a key at https://e2b.dev, then:\n  echo "E2B_API_KEY=e2b_..." > .env')
    process.exit(1)
  }
  await setupComputer()
  process.exit(0)
}

if (cmd !== 'stash') {
  console.log(usage)
  process.exit(rest.length ? 1 : 0)
}

const flag = (f: string) => {
  const i = rest.indexOf(f)
  return i === -1 ? null : (rest[i + 1] ?? '')
}

if (rest.includes('--list')) {
  const items = await listValues()
  console.log(items.length ? items.map((i) => `${i.name}  ${i.chars} chars  ${i.addedAt}`).join('\n') : 'stash is empty')
  process.exit(0)
}

const rm = flag('--rm')
if (rm) {
  await removeValue(rm)
  console.log(`removed ${rm}`)
  process.exit(0)
}

const name = rest[0]
if (!name || name.startsWith('--')) {
  console.log(usage)
  process.exit(1)
}

const file = flag('--file')
const literal = flag('--value')
const value = file
  ? await Bun.file(file).text()
  : rest.includes('--stdin')
    ? await new Response(Bun.stdin.stream()).text()
    : literal

if (!value) {
  console.error('nothing to stash: pass --file, --stdin or --value')
  process.exit(1)
}

await setValue(name, value.replace(/\n$/, ''), flag('--note') ?? undefined)
console.log(`stashed ${name} (${value.trim().length} chars)`)
