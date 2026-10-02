/** Thin control surface over an E2B desktop sandbox. */
import { Sandbox } from '@e2b/desktop'

export class Vm {
  private constructor(readonly sbx: Sandbox, readonly id: string) {}

  static async connect(id: string, timeoutMs = 3600_000) {
    const sbx = await Sandbox.connect(id)
    await sbx.setTimeout(timeoutMs)
    return new Vm(sbx, id)
  }

  /** Run a shell command; never throws, returns stdout+stderr. */
  async sh(cmd: string, timeoutMs = 30_000): Promise<string> {
    try {
      const r = await this.sbx.commands.run(cmd, { timeoutMs })
      return (r.stdout || r.stderr || '').trim()
    } catch (e: any) {
      return `ERR ${String(e?.message ?? e).slice(0, 120)}`
    }
  }

  x = (cmd: string, timeoutMs = 30_000) => this.sh(`DISPLAY=:0 ${cmd}`, timeoutMs)

  click = (x: number, y: number) => this.x(`xdotool mousemove ${x} ${y} click 1`)
  key = (k: string) => this.x(`xdotool key --clearmodifiers ${k}`)
  type = (text: string) =>
    this.x(`xdotool type --clearmodifiers --delay 20 -- ${JSON.stringify(text)}`)

  /**
   * Type a secret without it appearing in a command line, process list or log.
   * The value goes over the file API, is typed, then the file is shredded.
   */
  async typeSecret(value: string) {
    const path = `/home/user/.s${Math.random().toString(36).slice(2)}`
    await this.sbx.files.write(path, value)
    await this.x(`xdotool type --clearmodifiers --delay 20 -- "$(cat ${path})"`, 60_000)
    await this.sh(`shred -u ${path} 2>/dev/null || rm -f ${path}`)
  }

  screenshot = () => this.sbx.screenshot()

  async saveShot(file: string) {
    await Bun.write(file, await this.screenshot())
    return file
  }

  /** URL of the focused Chrome tab, read from the accessibility tree. */
  async currentUrl(): Promise<string | null> {
    const out = await this.x(
      `python3 - <<'PY'
import pyatspi
def walk(n, d=0):
    try:
        if n.getRole() == pyatspi.ROLE_ENTRY and 'Address' in (n.name or ''):
            print(n.queryText().getText(0, -1)); return True
    except Exception: pass
    for i in range(n.childCount):
        try:
            if walk(n.getChildAtIndex(i), d+1): return True
        except Exception: pass
    return False
for app in pyatspi.Registry.getDesktop(0):
    if app and 'hrome' in (app.name or ''):
        walk(app)
PY`,
    )
    return out.startsWith('ERR') || !out ? null : out.split('\n')[0]!.trim()
  }

  pause = () => (this.sbx as any).betaPause()
}
