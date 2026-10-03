/** Re-grade saved WebVoyager answers against their screenshots. */
const results = JSON.parse(await Bun.file(`${import.meta.dir}/webvoyager-results.json`).text())
const data = (await Bun.file(`${import.meta.dir}/data/webvoyager.jsonl`).text()).trim().split('\n').map((l: string) => JSON.parse(l))
for (const r of results) {
  const task = data.find((t: any) => t.id === r.id)
  const shot = `${import.meta.dir}/shots/${r.id.replace(/[^a-z0-9]+/gi, '-')}.png`
  const p = Bun.spawn(
    ['claude', '-p',
     `Grade a web agent. Task: "${task.ques}" on ${task.web}\n\nThe agent answered:\n${r.answer}\n\n` +
     `Read the final screenshot at ${shot}. Reply with exactly one word first, PASS or FAIL, then one short sentence. ` +
     `PASS if the answer is specific and plausible for the task. FAIL if it is vague or the agent says it could not do it.`,
     '--output-format', 'text', '--allowedTools', 'Read'],
    { cwd: import.meta.dir, stdout: 'pipe', stderr: 'pipe', stdin: 'ignore' },
  )
  const v = (await new Response(p.stdout).text()).trim()
  await p.exited
  r.verdict = v.split('\n')[0]!.slice(0, 100)
  console.log(`${/^\s*PASS/i.test(v) ? 'PASS' : 'FAIL'}  ${r.id.padEnd(26)} ${r.verdict.slice(0, 80)}`)
}
console.log(`\n${results.filter((r: any) => /^\s*PASS/i.test(r.verdict)).length}/${results.length} passed`)
await Bun.write(`${import.meta.dir}/webvoyager-results.json`, JSON.stringify(results, null, 2))
