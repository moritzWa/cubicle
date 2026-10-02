/**
 * Tiny login site for Cubicle evals: username + password, then a TOTP code.
 * Runs inside the VM as http://login.evalsite.com (via /etc/hosts).
 * Usage: bun evalsite/server.ts <password> <base32-totp-secret>
 */
import { createHmac } from 'node:crypto'

const [PASSWORD = 'hunter2', TOTP_SECRET = 'JBSWY3DPEHPK3PXP'] = Bun.argv.slice(2)
const USER = 'cubicle'

const unbase32 = (s: string) => {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = ''
  for (const c of s.toUpperCase().replace(/=+$/, '')) bits += A.indexOf(c).toString(2).padStart(5, '0')
  return Buffer.from((bits.match(/.{8}/g) ?? []).map((b) => parseInt(b, 2)))
}

function totp(secret: string, at = Date.now()) {
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / 30)))
  const h = createHmac('sha1', unbase32(secret)).update(counter).digest()
  const o = h[h.length - 1]! & 0x0f
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, '0')
}

const page = (title: string, heading: string, body: string) => `<!doctype html>
<meta charset=utf-8><title>${title}</title>
<style>body{font:16px system-ui;max-width:26rem;margin:6rem auto}
input{display:block;width:100%;padding:.6rem;margin:.6rem 0;font-size:1rem}
button{padding:.6rem 1.2rem;font-size:1rem}</style>
<h1>${heading}</h1>${body}`

const LOGIN = page('Sign in - evalsite', 'Sign in', `<form method=post action=/login>
<input name=username placeholder="Username" autofocus>
<input name=password type=password placeholder="Password">
<button>Next</button></form>`)

const OTP = page('Verify - evalsite', 'Two-factor code', `<form method=post action=/verify>
<input name=code placeholder="6-digit code" autocomplete=one-time-code autofocus>
<button>Verify</button></form>`)

const API_KEY = 'evs_live_7Q2f9KpR4mXv'
const OK = page(
  'Dashboard - evalsite',
  'Dashboard',
  `<p id=ok>CUBICLE_LOGIN_OK</p>
   <p>Your API key:</p>
   <pre id=key style="background:#f4f4f5;padding:.8rem;border-radius:.4rem">${API_KEY}</pre>`,
)
const FAIL = page('Denied - evalsite', 'Wrong credentials', '<p id=fail>DENIED</p><a href=/>back</a>')

const html = (body: string, status = 200) =>
  new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8' } })

Bun.serve({
  port: Number(process.env.PORT ?? 80),
  hostname: '0.0.0.0',
  async fetch(req) {
    const { pathname } = new URL(req.url)
    if (req.method === 'GET') return html(pathname === '/done' ? OK : LOGIN)
    const f = new URLSearchParams(await req.text())
    if (pathname === '/login')
      return html(f.get('username') === USER && f.get('password') === PASSWORD ? OTP : FAIL)
    if (pathname === '/verify') {
      const code = f.get('code') ?? ''
      // accept the previous window too, so a slow type doesn't fail the test
      return html(code === totp(TOTP_SECRET) || code === totp(TOTP_SECRET, Date.now() - 30_000) ? OK : FAIL)
    }
    return html(FAIL, 404)
  },
})
