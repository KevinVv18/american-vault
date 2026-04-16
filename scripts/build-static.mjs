import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

const entriesToCopy = [
  'index.html',
  'app.js',
  'styles.css',
  'src',
  'AV LOGO'
];

async function main() {
  await fs.rm(DIST, { recursive: true, force: true });
  await fs.mkdir(DIST, { recursive: true });

  for (const entry of entriesToCopy) {
    const source = path.join(ROOT, entry);
    const target = path.join(DIST, entry);
    await fs.cp(source, target, { recursive: true });
  }

  console.log(`Build listo en ${DIST}`);
}

main().catch((error) => {
  console.error('No se pudo generar dist:', error);
  process.exit(1);
});
