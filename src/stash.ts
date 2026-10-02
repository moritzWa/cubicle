/**
 * Local value stash: named values the agent can paste without ever seeing them.
 * Lives on the user's machine only, 0600, never uploaded anywhere.
 */
import { chmod, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

const FILE = `${process.env.HOME}/.cubicle/stash.json`

type Stash = Record<string, { value: string; addedAt: string; note?: string }>

async function read(): Promise<Stash> {
  try {
    return JSON.parse(await Bun.file(FILE).text())
  } catch {
    return {}
  }
}

async function write(s: Stash) {
  await mkdir(dirname(FILE), { recursive: true })
  await Bun.write(FILE, JSON.stringify(s, null, 2))
  await chmod(FILE, 0o600)
}

export async function setValue(name: string, value: string, note?: string) {
  const s = await read()
  s[name] = { value, addedAt: new Date().toISOString(), note }
  await write(s)
}

/** The value itself. Callers must not log it or return it to a model. */
export async function getValue(name: string): Promise<string | null> {
  return (await read())[name]?.value ?? null
}

export async function removeValue(name: string) {
  const s = await read()
  delete s[name]
  await write(s)
}

/** Names and sizes only - safe to show a model. */
export async function listValues() {
  return Object.entries(await read()).map(([name, v]) => ({
    name,
    chars: v.value.length,
    addedAt: v.addedAt,
    note: v.note,
  }))
}
