// Deterministic capability probe for integrating ExHarness with agent CLIs (Codex, Kiro, agy).
// Runs only --version/--help commands (no prompts, no provider calls, no config reads) and checks
// whether the non-interactive, resume, structured-output, permission and MCP surfaces exist.
// Usage from repository root: node docs/blackboard/evidence/BB-097/agent-cli-probe.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const win = process.platform === 'win32';

function run(bin, args) {
  // npm-installed codex is a .cmd/.ps1 shim on Windows; run it through cmd.exe with an argument array.
  const [cmd, argv] = win && bin === 'codex' ? ['cmd.exe', ['/d', '/c', 'codex', ...args]] : [bin, args];
  const r = spawnSync(cmd, argv, { encoding: 'utf8', timeout: 15000, windowsHide: true });
  return { ok: r.error == null && r.status === 0, text: `${r.stdout ?? ''}\n${r.stderr ?? ''}`, error: r.error?.code ?? null, timedOut: r.error?.code === 'ETIMEDOUT' };
}
const has = (text, flag) => text.includes(flag);

const tools = {
  codex: {
    version: ['--version'],
    help: { exec: ['exec', '--help'], resume: ['exec', 'resume', '--help'], mcp: ['mcp', '--help'] },
    flags: { exec: ['--json', '--output-last-message', '--sandbox', 'workspace-write', 'danger-full-access', '--cd', '--model', '--skip-git-repo-check'], resume: ['--last', '--json'], mcp: ['add', 'list'] }
  },
  'kiro-cli': {
    version: ['--version'],
    help: { chat: ['chat', '--help'], mcp: ['mcp', '--help'] },
    flags: { chat: ['--no-interactive', '--trust-all-tools', '--trust-tools', '--resume', '--agent', '--model'], mcp: ['add', 'list', 'status'] }
  },
  agy: {
    version: ['--version'],
    help: { root: ['--help'] },
    flags: { root: ['--print', '--continue', '--conversation', '--dangerously-skip-permissions', '--log-file', '--model', '--mode', 'accept-edits', '--add-dir'] }
  }
};

const result = { kind: 'BB097_AGENT_CLI_PROBE_RESULT', version: 1, platform: `${process.platform}-${process.arch}`, node: process.version, tools: {} };
for (const [bin, spec] of Object.entries(tools)) {
  const v = run(bin, spec.version);
  const entry = { installed: v.ok, version: v.ok ? v.text.trim().split(/\r?\n/)[0] : null, surfaces: {} };
  for (const [surface, args] of Object.entries(spec.help)) {
    const h = run(bin, args);
    entry.surfaces[surface] = {
      command: [bin, ...args].join(' '),
      helpAvailable: h.ok,
      flags: Object.fromEntries(spec.flags[surface].map((f) => [f, h.ok && has(h.text, f)])),
      helpLines: h.ok ? h.text.split(/\r?\n/).map((l) => l.trim()).filter((l) => /--trust-tools|--trust-all-tools|--print|--sandbox|--mode|--resume|--continue|--json|--last|SESSION_ID|read from stdin|cwd filtering/.test(l)).slice(0, 16) : []
    };
  }
  result.tools[bin] = entry;
}
// Hook/config locations are recorded by existence only; contents are never read (may hold credentials).
const home = os.homedir();
result.configLocationsPresent = Object.fromEntries([
  ['codex ~/.codex/config.toml', path.join(home, '.codex', 'config.toml')],
  ['codex ~/.codex/hooks.json', path.join(home, '.codex', 'hooks.json')],
  ['kiro ~/.kiro', path.join(home, '.kiro')],
  ['agy ~/.gemini', path.join(home, '.gemini')]
].map(([k, p]) => [k, fs.existsSync(p)]));
const t = result.tools;
result.conclusions = {
  allInstalled: Object.values(t).every((x) => x.installed),
  allHaveNonInteractiveMode: Boolean(t.codex.surfaces.exec?.helpAvailable && t['kiro-cli'].surfaces.chat.flags['--no-interactive'] && t.agy.surfaces.root.flags['--print']),
  allHaveResume: Boolean(t.codex.surfaces.resume?.flags['--last'] && t['kiro-cli'].surfaces.chat.flags['--resume'] && t.agy.surfaces.root.flags['--continue']),
  structuredEventStream: { codex: t.codex.surfaces.exec.flags['--json'], 'kiro-cli': false, agy: false },
  mcpClientManagement: { codex: t.codex.surfaces.mcp.flags.add, 'kiro-cli': t['kiro-cli'].surfaces.mcp.flags.add, agy: 'NOT_PROBED_VIA_CLI' }
};
fs.writeFileSync(path.join(here, 'agent-cli-probe-result.json'), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result.conclusions));
