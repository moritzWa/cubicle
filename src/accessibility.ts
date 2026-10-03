/** Accessibility-tree access inside the VM (no pixels, no CDP). */
import type { Vm } from './vm'

export type Focus = { role?: string; name?: string; password?: boolean }
export type FieldNode = { role: string; label: string; box: [number, number, number, number] | null }

const AGENT = '/home/user/accessibility.py'

export async function installAccessibility(vm: Vm) {
  await vm.sbx.files.write(AGENT, await Bun.file(`${import.meta.dir}/../vmagent/accessibility.py`).text())
}

const call = async <T>(vm: Vm, cmd: 'url' | 'focus' | 'fields' | 'present', fallback: T): Promise<T> => {
  const out = await vm.x(`python3 ${AGENT} ${cmd}`, 90_000)
  try {
    return JSON.parse(out) as T
  } catch {
    return fallback
  }
}

/** URL of the focused tab, read from Chrome's address bar node. */
export const currentUrl = (vm: Vm) => call<string>(vm, 'url', '')
/** Is Chrome published on the accessibility bus? Empty URL is not the same thing:
 *  about:blank and a mid-load page both report no URL. */
export const chromeOnBus = async (vm: Vm) =>
  (await call<{ chrome: boolean }>(vm, 'present', { chrome: false })).chrome
export const focusedElement = (vm: Vm) => call<Focus>(vm, 'focus', {})
export const pageFields = (vm: Vm) => call<FieldNode[]>(vm, 'fields', [])

/**
 * Wait for a page to stop changing. A fixed sleep is the wrong tool: slow sites
 * get read half-loaded and the agent concludes the page never came up.
 */
export async function waitForPage(vm: Vm, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs
  let last = -1
  let stable = 0
  while (Date.now() < deadline) {
    const n = (await pageFields(vm)).length
    stable = n > 2 && n === last ? stable + 1 : 0
    if (stable >= 1) break
    last = n
    await Bun.sleep(1000)
  }
  return { url: await currentUrl(vm), nodes: last }
}

/** Chrome reports the address bar without a scheme; make it a URL again. */
export const normalizeUrl = (u: string) => (u && !/^[a-z]+:\/\//i.test(u) ? `https://${u}` : u)
