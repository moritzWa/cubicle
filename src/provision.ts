/**
 * Turn a stock E2B `desktop` sandbox into a Cubicle computer.
 * Idempotent; this is the script that will become the custom template's Dockerfile.
 */
import { Vm } from './vm'
import { installAccessibility } from './accessibility'

/**
 * `full` installs packages (slow, once per sandbox). The light path only re-applies
 * settings that do not survive a fresh boot, and must stay fast: it runs inside an
 * MCP tool call, and clients time out at 60s.
 */
export async function provision(vm: Vm, log: (s: string) => void = console.log, full = false) {
  // 1. The screensaver blanks the screen to black and looks like a dead stream.
  await vm.sh('sudo rm -f /etc/xdg/autostart/xfce4-screensaver.desktop; pkill -9 -x xfce4-screensaver; true')
  await vm.x('xset s off -dpms s noblank; xset dpms force on')
  log('screensaver disabled')

  // 2. Chrome policy: no password-manager bubble covering the page after a fill.
  await vm.sh(
    `sudo mkdir -p /etc/opt/chrome/policies/managed && echo '{"PasswordManagerEnabled":false,` +
      `"AutofillAddressEnabled":false,"AutofillCreditCardEnabled":false,` +
      `"PromotionalTabsEnabled":false,"DefaultBrowserSettingEnabled":false}' ` +
      `| sudo tee /etc/opt/chrome/policies/managed/cubicle.json >/dev/null`,
  )
  log('chrome policy written')

  // 3. Bun, for the eval site and the future run_js tool.
  if (full && (await vm.sh('command -v bun || true')).trim() === '') {
    await vm.sh('curl -fsSL https://bun.sh/install | bash >/dev/null 2>&1; sudo ln -sf /home/user/.bun/bin/bun /usr/local/bin/bun; true', 300_000)
  }
  if (full) log('bun: ' + (await vm.sh('bun --version 2>&1 | tail -1')))

  // 4. Accessibility: the template ships at-spi2-core but not the python bindings.
  const py = full ? await vm.sh('python3 -c "import pyatspi" 2>&1 | tail -1') : ''
  if (py.includes('ModuleNotFoundError')) {
    await vm.sh(
      'sudo apt-get update -qq >/dev/null 2>&1; sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq python3-pyatspi at-spi2-core >/dev/null 2>&1; true',
      600_000,
    )
  }
  await vm.x('pgrep -f at-spi-bus-launcher >/dev/null || (setsid /usr/libexec/at-spi-bus-launcher --launch-immediately </dev/null >/dev/null 2>&1 &); sleep 2; true')
  await installAccessibility(vm)
  if (full) log('accessibility ready: ' + (await vm.sh('python3 -c "import pyatspi; print(\'pyatspi ok\')" 2>&1 | tail -1')))
}

/** Chrome must start AFTER the accessibility bus, with accessibility forced on. */
export async function launchChrome(vm: Vm, url = 'about:blank') {
  await vm.sh(
    `pgrep -x chrome >/dev/null || (DISPLAY=:0 GTK_MODULES=gail:atk-bridge ACCESSIBILITY_ENABLED=1 ` +
      `nohup google-chrome --no-first-run --no-default-browser-check --start-maximized ` +
      `--force-renderer-accessibility --disable-session-crashed-bubble ${JSON.stringify(url)} ` +
      `</dev/null >/home/user/chrome.log 2>&1 &); sleep 8; true`,
    90_000,
  )
}

export const streamUrl = (id: string) =>
  `https://6080-${id}.e2b.app/vnc.html?autoconnect=true&resize=scale`
