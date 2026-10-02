#!/usr/bin/env bun
/**
 * Cubicle inner MCP server: gives any MCP client (Claude Code, Codex, our own
 * loop) a persistent, authenticated computer.
 */
import { loadEnv } from '../src/env'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { getComputer, IdlePauser, takeoverUrl } from '../src/computer'
import { requireReady } from '../src/preflight'
import { currentUrl, focusedElement, pageFields } from '../src/accessibility'
import { paste } from '../src/paste'
import { listValues } from '../src/stash'
import { basename } from 'node:path'
import type { Vm } from '../src/vm'

await loadEnv()

let vm: Vm | null = null

// Pause the computer when the session goes quiet: a sandbox that hits its own
// timeout silently reverts to the last pause, losing logins and any work since.
const idle = new IdlePauser(
  () => vm,
  () => {
    vm = null
  },
)

const computer = async () => {
  await requireReady()
  vm ??= await getComputer()
  idle.touch()
  return vm
}
const text = (s: string) => ({ content: [{ type: 'text' as const, text: s }] })

const server = new McpServer({ name: 'cubicle', version: '0.1.0' })

server.registerTool(
  'computer_screenshot',
  {
    title: 'Screenshot',
    description:
      'Screenshot the computer screen (1024x768). Use after any action that changes the screen.',
    inputSchema: {},
  },
  async () => {
    const c = await computer()
    const png = await c.screenshot()
    return {
      content: [
        { type: 'image' as const, data: Buffer.from(png).toString('base64'), mimeType: 'image/png' },
      ],
    }
  },
)

server.registerTool(
  'computer_page',
  {
    title: 'Page',
    description:
      'Read the current page WITHOUT a screenshot: URL plus every interactive element with its screen coordinates, from the accessibility tree. Prefer this over screenshots - cheaper, and it gives exact click targets.',
    inputSchema: {},
  },
  async () => {
    const c = await computer()
    const [url, fields, focus] = await Promise.all([currentUrl(c), pageFields(c), focusedElement(c)])
    return text(JSON.stringify({ url, focus, fields }, null, 1))
  },
)

server.registerTool(
  'computer_click',
  {
    title: 'Click',
    description:
      'Click at screen coordinates. Get them from computer_page (box = [x, y, width, height]; click the centre).',
    inputSchema: { x: z.number(), y: z.number() },
  },
  async ({ x, y }) => {
    const c = await computer()
    await c.click(x, y)
    return text(`clicked ${x},${y}`)
  },
)

server.registerTool(
  'computer_type',
  {
    title: 'Type',
    description:
      'Type text into the focused field. Never use this for passwords or codes - use computer_fill_secret.',
    inputSchema: { text: z.string() },
  },
  async ({ text: t }) => {
    const c = await computer()
    await c.type(t)
    return text(`typed ${t.length} chars`)
  },
)

server.registerTool(
  'computer_key',
  {
    title: 'Key',
    description:
      'Press a key or chord, e.g. Return, Tab, Escape, ctrl+l.',
    inputSchema: { key: z.string() },
  },
  async ({ key }) => {
    const c = await computer()
    await c.key(key)
    return text(`pressed ${key}`)
  },
)

server.registerTool(
  'computer_navigate',
  {
    title: 'Navigate',
    description:
      'Open a URL in the browser.',
    inputSchema: { url: z.string() },
  },
  async ({ url }) => {
    const c = await computer()
    await c.key('ctrl+l')
    await c.type(url)
    await c.key('Return')
    await Bun.sleep(3000)
    return text(`navigated to ${await currentUrl(c)}`)
  },
)

server.registerTool(
  'computer_shell',
  {
    title: 'Shell',
    description:
      'Run a shell command inside the computer (Ubuntu, user `user`).',
    inputSchema: { command: z.string() },
  },
  async ({ command }) => {
    const c = await computer()
    return text((await c.sh(command, 60_000)).slice(0, 8000))
  },
)

server.registerTool(
  'computer_paste',
  {
    title: 'Paste a value',
    description:
      "Type a value into the focused field without ever seeing it. Click the field first.\n" +
      "from='1password': takes the item matching the page's domain (field: username | password | otp).\n" +
      "from='stash': a value the user stashed locally by name (see computer_stash_list).\n" +
      'Refuses if the focused element is not a text field, if a password would land somewhere that is not a password field, or if no 1Password item matches the domain.',
    inputSchema: {
      from: z.enum(['1password', 'stash']),
      field: z.enum(['username', 'password', 'otp']).optional(),
      name: z.string().optional(),
    },
  },
  async ({ from, field, name }) => {
    const c = await computer()
    if (from === 'stash') {
      if (!name) return text(JSON.stringify({ status: 'refused', reason: 'stash needs a name' }))
      return text(JSON.stringify(await paste(c, { from: 'stash', name })))
    }
    if (!field) return text(JSON.stringify({ status: 'refused', reason: '1password needs a field' }))
    return text(JSON.stringify(await paste(c, { from: '1password', field })))
  },
)

server.registerTool(
  'computer_stash_list',
  {
    title: 'List stashed values',
    description:
      'Names of values the user stashed locally, with sizes - never the values. Use a name with computer_paste. If what you need is missing, ask the user to run: cubicle stash <name> --file <path>',
    inputSchema: {},
  },
  async () => text(JSON.stringify(await listValues())),
)

server.registerTool(
  'computer_upload_file',
  {
    title: 'Upload a file',
    description:
      "Copy a file from the user's machine into the computer. Returns the path inside the computer.",
    inputSchema: { localPath: z.string(), remotePath: z.string().optional() },
  },
  async ({ localPath, remotePath }) => {
    const c = await computer()
    const dest = remotePath ?? `/home/user/${basename(localPath)}`
    await c.sbx.files.write(dest, await Bun.file(localPath).arrayBuffer())
    return text(`uploaded to ${dest} (${await c.sh(`stat -c %s ${dest}`)} bytes)`)
  },
)

server.registerTool(
  'computer_download_file',
  {
    title: 'Download a file',
    description:
      "Copy a file out of the computer onto the user's machine (e.g. something the browser downloaded). Browser downloads land in /home/user/Downloads.",
    inputSchema: { remotePath: z.string(), localPath: z.string() },
  },
  async ({ remotePath, localPath }) => {
    const c = await computer()
    const data = await c.sbx.files.read(remotePath, { format: 'bytes' })
    await Bun.write(localPath, data as Uint8Array)
    return text(`downloaded ${remotePath} -> ${localPath}`)
  },
)

server.registerTool(
  'computer_takeover',
  {
    title: 'Takeover',
    description:
      'Get a URL where the user can see and control the computer themselves - for logins, MFA, CAPTCHAs, or anything you should not do unattended. Tell the user what to do there, then wait.',
    inputSchema: { reason: z.string() },
  },
  async ({ reason }) => {
    const c = await computer()
    return text(`Ask the user to open ${takeoverUrl(c)}\nReason: ${reason}`)
  },
)

process.on('SIGTERM', () => void idle.pauseNow().then(() => process.exit(0)))
process.on('SIGINT', () => void idle.pauseNow().then(() => process.exit(0)))

server.registerTool(
  'computer_pause',
  {
    title: 'Pause',
    description:
      'Pause the computer, saving all state including logins. Call this when finished: if the sandbox hits its timeout instead, everything since the last pause is silently lost.',
    inputSchema: {},
  },
  async () => {
    const c = await computer()
    idle.stop()
    await c.pause()
    vm = null
    return text('paused')
  },
)

await server.connect(new StdioServerTransport())
