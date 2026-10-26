// Imported first by every test so config.ts sees these values.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'magpie-test-'));
process.env.FETCH_ENABLED = 'false';
