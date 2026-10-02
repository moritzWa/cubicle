/** Accessibility-tree access inside the VM (no pixels, no CDP). */
import type { Vm } from './vm'

export type Focus = { role?: string; name?: string; password?: boolean }
export type FieldNode = { role: string; label: string; box: [number, number, number, number] | null }

const AGENT = '/home/user/accessibility.py'

export async function installAccessibility(vm: Vm) {
  await vm.sbx.files.write(AGENT, await Bun.file('vmagent/accessibility.py').text())
}

const call = async <T>(vm: Vm, cmd: 'url' | 'focus' | 'fields', fallback: T): Promise<T> => {
  const out = await vm.x(`python3 ${AGENT} ${cmd}`, 90_000)
  try {
    return JSON.parse(out) as T
  } catch {
    return fallback
  }
}

/** URL of the focused tab, read from Chrome's address bar node. */
export const currentUrl = (vm: Vm) => call<string>(vm, 'url', '')
export const focusedElement = (vm: Vm) => call<Focus>(vm, 'focus', {})
export const pageFields = (vm: Vm) => call<FieldNode[]>(vm, 'fields', [])

/** Chrome reports the address bar without a scheme; make it a URL again. */
export const normalizeUrl = (u: string) => (u && !/^[a-z]+:\/\//i.test(u) ? `https://${u}` : u)
