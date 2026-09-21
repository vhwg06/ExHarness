import fs from 'node:fs';
import path from 'node:path';

// Load local evaluation variables without overriding an explicitly exported
// shell or CI value. The .env file is intentionally never committed.
export function loadDotEnv(root = process.cwd(), file = '.env') {
  const ref = path.resolve(root, file);
  if (!fs.existsSync(ref)) return { loaded: false, ref };

  const text = fs.readFileSync(ref, 'utf8').replace(/^\uFEFF/, '');
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, key, valueText] = match;
    if (process.env[key] !== undefined) continue;

    let value = valueText.trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, '').trim();
    }
    process.env[key] = value;
  }
  return { loaded: true, ref };
}
