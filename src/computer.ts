/** One persistent computer per user: create, resume, idle-pause. */
import { Sandbox } from '@e2b/desktop'
import { Vm } from './vm'
import { provision, launchChrome, streamUrl } from './provision'
import { chromeOnBus } from './accessibility'

const STATE = `${process.env.HOME}/.cubicle/computer.json`

/**
 * How long a sandbox may sit idle before we pause it.
 * This is not a cost optimisation: if a sandbox reaches its own timeout instead,
 * E2B silently reverts to the last explicit pause and everything since is lost.
 */
const IDLE_PAUSE_MS = 90_000

type State = { sandboxId: string }

const readState = async (): Promise<State | null> => {
  try {
    return JSON.parse(await Bun.file(STATE).text())
  } catch {
    return null
  }
}

/**
 * Returns the user's computer, resuming or creating as needed.
 * Never let a sandbox hit its timeout: on timeout E2B silently reverts to the
 * last explicit pause, so anything since then is lost without an error.
 */
export async function getComputer(timeoutMs = 10 * 60_000): Promise<Vm> {
  const state = await readState()
  if (state) {
    try {
      const vm = await Vm.connect(state.sandboxId, timeoutMs)
      await provision(vm, () => {}, false)
      await ensureChrome(vm)
      return vm
    } catch {
      // fall through and create a new one
    }
  }
  const sbx = await Sandbox.create({ timeoutMs })
  const vm = await Vm.connect(sbx.sandboxId, timeoutMs)
  await provision(vm, () => {}, true)
  await ensureChrome(vm)
  await Bun.write(STATE, JSON.stringify({ sandboxId: sbx.sandboxId }))
  return vm
}

/**
 * Chrome must be running AND visible in the accessibility tree. A Chrome started
 * before the accessibility bus exists never joins it, so restart it in that case.
 */
async function ensureChrome(vm: Vm) {
  await launchChrome(vm, 'about:blank')
  // Only restart when Chrome is genuinely missing from the accessibility bus.
  // Checking the URL instead would restart on about:blank or a mid-load page,
  // which throws away whatever another client was doing.
  for (let attempt = 0; attempt < 3; attempt++) {
    if (await chromeOnBus(vm)) return
    await Bun.sleep(1500)
  }
  await vm.sh('pkill -x chrome; sleep 2; true')
  await launchChrome(vm, 'about:blank')
}

/** Create and fully provision a computer up front, so no tool call pays for it. */
export async function setupComputer(log = console.log): Promise<Vm> {
  const sbx = await Sandbox.create({ timeoutMs: 10 * 60_000 })
  log(`created ${sbx.sandboxId}`)
  const vm = await Vm.connect(sbx.sandboxId)
  await provision(vm, log, true)
  await ensureChrome(vm)
  await Bun.write(STATE, JSON.stringify({ sandboxId: sbx.sandboxId }))
  await vm.pause()
  log('provisioned and paused - tool calls will resume it in ~1s')
  return vm
}

export const takeoverUrl = (vm: Vm) => streamUrl(vm.id)

/**
 * Pauses the computer after a period with no tool calls, so a forgotten session
 * never loses state to the sandbox timeout. Call `touch()` on every tool call.
 */
export class IdlePauser {
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private getVm: () => Vm | null,
    private onPaused: () => void,
    private idleMs = IDLE_PAUSE_MS,
  ) {}

  touch() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.pauseNow(), this.idleMs)
    // Don't hold the process open just for the idle timer.
    ;(this.timer as any).unref?.()
  }

  async pauseNow() {
    const vm = this.getVm()
    if (!vm) return
    try {
      await vm.pause()
      this.onPaused()
    } catch {
      // A pause that fails (already paused, network blip) is not worth surfacing:
      // the next tool call resumes from whatever state exists.
    }
  }

  stop() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }
}
