/**
 * Secret broker: resolves secrets from 1Password on the user's Mac.
 * Values are returned to the caller in-process only. They must never be logged,
 * stored in the task transcript, or returned to a model.
 */
import { getDomain } from 'tldts'

export type ItemRef = { id: string; title: string; urls: string[] }

/** Runs `op`, bounded: a biometric prompt nobody answers must not hang the agent. */
const op = async (args: string[], timeoutMs = 20_000): Promise<string> => {
  const proc = Bun.spawn(['op', ...args], { stdout: 'pipe', stderr: 'pipe' })
  const timer = setTimeout(() => proc.kill(), timeoutMs)
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  clearTimeout(timer)
  const r = { exitCode: code, stdout: { toString: () => out }, stderr: { toString: () => err } }
  if (r.exitCode !== 0) {
    if (code === null || (code as number) > 128 || /killed/i.test(err))
      throw new SecretError('locked', '1Password did not respond — unlock the desktop app')
    const errText = err
    if (/promptError|not signed in|authorization prompt/i.test(errText))
      throw new SecretError('locked', '1Password is locked — unlock the desktop app')
    if (/isn't an item|no item matches/i.test(errText)) throw new SecretError('not_found', errText.trim())
    throw new Error(`op failed: ${errText.trim().slice(0, 200)}`)
  }
  return r.stdout.toString().trim()
}

/** Registrable domain (eTLD+1), e.g. https://login.acme.co.uk/x -> acme.co.uk */
export const rootDomain = (url: string): string | null => getDomain(url)

/** True when the page's registrable domain matches any URL saved on the item. */
export function domainMatches(pageUrl: string, itemUrls: string[]): boolean {
  const page = rootDomain(pageUrl)
  if (!page) return false
  return itemUrls.some((u) => rootDomain(u) === page)
}

export async function listItems(): Promise<ItemRef[]> {
  const raw = JSON.parse(await op(['item', 'list', '--format', 'json']))
  return raw.map((i: any) => ({
    id: i.id,
    title: i.title,
    urls: (i.urls ?? []).map((u: any) => u.href).filter(Boolean),
  }))
}

/** Items whose saved URLs share a registrable domain with the page. */
export async function itemsForUrl(pageUrl: string): Promise<ItemRef[]> {
  return (await listItems()).filter((i) => domainMatches(pageUrl, i.urls))
}

export class SecretError extends Error {
  constructor(public code: 'no_match' | 'ambiguous' | 'not_found' | 'locked', message: string) {
    super(message)
  }
}

/**
 * Resolve one item for a page URL. Refuses to guess:
 * - no item for that domain  -> no_match  (caller prompts the user; blocks phishing)
 * - several items            -> ambiguous (caller shows a picker)
 */
export async function resolveItem(pageUrl: string): Promise<ItemRef> {
  const matches = await itemsForUrl(pageUrl)
  if (matches.length === 0)
    throw new SecretError('no_match', `no 1Password item for ${rootDomain(pageUrl)}`)
  if (matches.length > 1)
    throw new SecretError('ambiguous', `${matches.length} items for ${rootDomain(pageUrl)}: ${matches.map((m) => m.title).join(', ')}`)
  return matches[0]!
}

export type Field = 'username' | 'password' | 'otp'

/** Fetch one field. The return value is a secret: never log it. */
export async function getField(itemId: string, field: Field): Promise<string> {
  if (field === 'otp') return op(['item', 'get', itemId, '--otp'])
  return op(['item', 'get', itemId, '--fields', `label=${field}`, '--reveal'])
}
