import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyCandidate } from './fixture/acceptance.mjs';

export { verifyCandidate };

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
  const candidateDir = option('--candidate'), fault = option('--fault'), output = option('--output');
  if (!candidateDir || !fault || !output) {
    console.error('usage: verify.mjs --candidate <directory> --fault <task-id> --output <verification.json>');
    process.exitCode = 2;
  } else {
    const result = await verifyCandidate({ candidateDir, fault, browser: true });
    await writeFile(output, JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify({ status: result.status, candidateDigest: result.candidateDigest }));
    if (result.status === 'INCONCLUSIVE') process.exitCode = 4;
  }
}
