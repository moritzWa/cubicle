/**
 * Load the checkout's own .env.
 * The MCP server is launched from the client's working directory, so Bun's
 * automatic .env loading looks in the wrong place and the E2B key goes missing.
 */
const FILE = `${import.meta.dir}/../.env`

export async function loadEnv() {
  if (process.env.E2B_API_KEY) return
  const f = Bun.file(FILE)
  if (!(await f.exists())) return
  for (const line of (await f.text()).split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2]!.replace(/^["']|["']$/g, '')
  }
}
