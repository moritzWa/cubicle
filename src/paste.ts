/**
 * computer_paste: type a value into the focused field without the model seeing it.
 * Sources: a 1Password item field, or a locally stashed value.
 */
import { Vm } from './vm'
import { currentUrl, focusedElement, normalizeUrl } from './accessibility'
import { domainMatches, getField, resolveItem, SecretError, type Field } from './broker'
import { getValue, listValues } from './stash'

export type PasteSource =
  | { from: '1password'; field: Field }
  | { from: 'stash'; name: string }

export type PasteResult =
  | { status: 'pasted'; from: string; label: string; chars: number }
  | { status: 'refused'; reason: string }
  | { status: 'needs_human'; reason: string }

/** The focused element must accept text; a password must land in a password field. */
async function checkFocus(vm: Vm, isPassword: boolean): Promise<string | null> {
  const focus = await focusedElement(vm)
  if (focus.role !== 'entry' && focus.role !== 'password text')
    return `focus is ${focus.role ?? 'nothing'}, not a text field`
  if (isPassword && focus.role !== 'password text')
    return `focused field "${focus.name}" is not a password field`
  return null
}

export async function paste(vm: Vm, source: PasteSource): Promise<PasteResult> {
  if (source.from === 'stash') {
    // Resolve the name first: "no such value" is more useful than "wrong focus".
    const value = await getValue(source.name)
    if (value === null) {
      const known = (await listValues()).map((v) => v.name)
      return {
        status: 'refused',
        reason: `no stashed value "${source.name}". Known: ${known.join(', ') || '(none)'}. The user adds one with: cubicle stash ${source.name} --file <path>`,
      }
    }
    const badFocus = await checkFocus(vm, false)
    if (badFocus) return { status: 'refused', reason: badFocus }
    await vm.typeSecret(value)
    return { status: 'pasted', from: 'stash', label: source.name, chars: value.length }
  }

  const badFocus = await checkFocus(vm, source.field === 'password')
  if (badFocus) return { status: 'refused', reason: badFocus }

  // 1Password: the domain comes from Chrome itself, never from the caller.
  const url = normalizeUrl(await currentUrl(vm))
  if (!url) return { status: 'refused', reason: 'no page url' }
  let item
  try {
    item = await resolveItem(url)
  } catch (e) {
    if (e instanceof SecretError)
      return e.code === 'locked'
        ? { status: 'needs_human', reason: e.message }
        : { status: 'refused', reason: `${e.code}: ${e.message}` }
    throw e
  }
  if (!domainMatches(url, item.urls)) return { status: 'refused', reason: 'domain mismatch' }

  let value: string
  try {
    value = await getField(item.id, source.field)
  } catch (e) {
    if (e instanceof SecretError && e.code === 'locked')
      return { status: 'needs_human', reason: e.message }
    throw e
  }
  if (!value) return { status: 'refused', reason: `item has no ${source.field}` }
  await vm.typeSecret(value)
  return { status: 'pasted', from: '1password', label: `${item.title}/${source.field}`, chars: value.length }
}
