/**
 * Full end-to-end login, driven entirely through the MCP server.
 *
 *   bun test/e2e-login.ts
 *
 * It deploys `evalsite/server.ts` into your computer as http://login.evalsite.com,
 * finds the form fields in the accessibility tree, and signs in with
 * computer_paste: username, password, and a live TOTP code from 1Password.
 *
 * Requires, besides E2B_API_KEY and a computer (`cubicle setup`), a 1Password login
 * item saved against https://login.evalsite.com with a username, a password and a
 * one-time-password field:
 *
 *   SECRET=$(python3 -c "import base64,os;print(base64.b32encode(os.urandom(10)).decode().rstrip('='))")
 *   op item create --category login --title "Cubicle Eval Site" --vault Personal \
 *     --url "https://login.evalsite.com" username=cubicle password="$(openssl rand -hex 10)" \
 *     "one-time password[otp]=otpauth://totp/evalsite:cubicle?secret=$SECRET&issuer=evalsite"
 *
 * Exits 0 only when the page reaches CUBICLE_LOGIN_OK.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { Vm } from '../src/vm'
import { getComputer } from '../src/computer'
import { getField, resolveItem } from '../src/broker'

// 1. put the eval site in the computer, served as http://login.evalsite.com
const vm: Vm = await getComputer()
const item = await resolveItem('https://login.evalsite.com')
const pw = await getField(item.id, 'password')
const totpSecret = (await Bun.$`op item get ${item.id} --format json`.quiet()).stdout
  .toString()
  .match(/secret=([A-Z2-7]+)/)![1]!

await vm.sbx.files.write('/home/user/evalsite.ts', await Bun.file('evalsite/server.ts').text())
await vm.sbx.files.write('/home/user/.evalenv', `${pw}\n${totpSecret}\n`)
await vm.sh(`grep -q evalsite.com /etc/hosts || echo '127.0.0.1 login.evalsite.com' | sudo tee -a /etc/hosts`)
await vm.sh('pkill -f evalsite.ts; sleep 1; true')
await vm.sh(
  'cd /home/user && sudo -E PATH=$PATH setsid bun evalsite.ts "$(sed -n 1p .evalenv)" "$(sed -n 2p .evalenv)" </dev/null >/home/user/evalsite.log 2>&1 & sleep 3; true',
  60_000,
)
await vm.sh('shred -u /home/user/.evalenv 2>/dev/null || rm -f /home/user/.evalenv')
console.log('eval site  :', await vm.sh(`curl -s -o /dev/null -w '%{http_code}' http://login.evalsite.com/`))

// 2. drive the whole login through MCP, as a client would
const client = new Client({ name: 'e2e', version: '0' })
await client.connect(new StdioClientTransport({ command: 'bun', args: ['bin/mcp.ts'], env: process.env as any }))
const call = async (n: string, a: any = {}) => ((await client.callTool({ name: n, arguments: a })) as any).content[0].text ?? ''
const page = async () => JSON.parse(await call('computer_page'))

console.log('navigate   :', await call('computer_navigate', { url: 'http://login.evalsite.com/' }))
const fields = (await page()).fields as Array<{ role: string; label: string; box: number[] }>
const at = (label: string) => {
  const f = fields.find((x) => x.label === label)!
  return { x: f.box[0]! + f.box[2]! / 2, y: f.box[1]! + f.box[3]! / 2 }
}
console.log('found      :', fields.filter((f) => f.role.includes('entry') || f.role.includes('password')).map((f) => `${f.role}:${f.label}`).join(', '))

await call('computer_click', at('Username'))
console.log('username   :', await call('computer_paste', { from: '1password', field: 'username' }))
await call('computer_click', at('Password'))
console.log('password   :', await call('computer_paste', { from: '1password', field: 'password' }))
await call('computer_key', { key: 'Return' })
await Bun.sleep(2500)

const otpFields = (await page()).fields as Array<{ role: string; label: string; box: number[] }>
const otp = otpFields.find((f) => f.role === 'entry')!
await call('computer_click', { x: otp.box[0]! + otp.box[2]! / 2, y: otp.box[1]! + otp.box[3]! / 2 })
console.log('otp        :', await call('computer_paste', { from: '1password', field: 'otp' }))
await call('computer_key', { key: 'Return' })
await Bun.sleep(2500)

const final = await page()
const ok = JSON.stringify(final.fields).includes('CUBICLE_LOGIN_OK')
console.log('result     :', ok ? 'PASS - signed in' : `FAIL - ${JSON.stringify(final.fields).slice(0, 200)}`)
console.log('pause      :', await call('computer_pause'))
await client.close()
process.exit(ok ? 0 : 1)
