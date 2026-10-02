/** Human-readable checks for the things that actually go wrong on first run. */
import { Vm } from './vm'

export type Check = { ok: boolean; name: string; detail: string }

export async function checkEnv(): Promise<Check[]> {
  const checks: Check[] = []

  checks.push(
    process.env.E2B_API_KEY
      ? { ok: true, name: 'E2B key', detail: 'E2B_API_KEY is set' }
      : {
          ok: false,
          name: 'E2B key',
          detail: 'E2B_API_KEY is not set. Get one at https://e2b.dev, then put it in .env:\n  echo "E2B_API_KEY=e2b_..." > .env',
        },
  )

  const op = Bun.spawnSync(['op', '--version'])
  checks.push(
    op.success
      ? { ok: true, name: '1Password CLI', detail: `op ${op.stdout.toString().trim()}` }
      : {
          ok: false,
          name: '1Password CLI',
          detail: 'op not found (optional). Needed only for computer_paste from 1Password:\n  brew install 1password-cli\n  then 1Password > Settings > Developer > "Integrate with 1Password CLI"',
        },
  )

  const state = Bun.file(`${process.env.HOME}/.cubicle/computer.json`)
  checks.push(
    (await state.exists())
      ? { ok: true, name: 'computer', detail: 'a computer is registered' }
      : { ok: false, name: 'computer', detail: 'no computer yet. Run: cubicle setup' },
  )

  return checks
}

export const formatChecks = (checks: Check[]) =>
  checks.map((c) => `${c.ok ? '✓' : '✗'} ${c.name.padEnd(15)} ${c.detail}`).join('\n')

/** Everything a tool call needs. Throws with an actionable message if not. */
export async function requireReady() {
  if (!process.env.E2B_API_KEY)
    throw new Error(
      'E2B_API_KEY is not set, so there is no computer to drive. Put it in .env next to the cubicle checkout (echo "E2B_API_KEY=e2b_..." > .env) and restart. Keys: https://e2b.dev',
    )
}

export async function checkVm(vm: Vm): Promise<Check[]> {
  const [chrome, access, bun] = await Promise.all([
    vm.sh('pgrep -c chrome || echo 0'),
    vm.sh('python3 -c "import pyatspi; print(\'ok\')" 2>&1 | tail -1'),
    vm.sh('bun --version 2>&1 | tail -1'),
  ])
  return [
    { ok: chrome !== '0', name: 'chrome', detail: `${chrome} processes` },
    { ok: access === 'ok', name: 'accessibility', detail: access },
    { ok: /^\d/.test(bun), name: 'bun', detail: bun },
  ]
}
