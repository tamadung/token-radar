import { buildDossier } from './vendor/makefun-board.ts';
import { readFileSync } from 'node:fs';
const out = process.argv[2];
const got = readFileSync(out + '/dossier.json');
const want = buildDossier(out, { text_max_bytes: 65536, screenshots: { max: 4, max_bytes: 524288 }, dashboard: { max_files: 400, max_bytes: 4194304 } });
const wantBuf = Buffer.isBuffer(want) ? want : Buffer.from(want);
console.log(got.equals(wantBuf) ? 'MATCH' : 'MISMATCH');
if (!got.equals(wantBuf)) {
  console.log('got len:', got.length, 'want len:', wantBuf.length);
}
