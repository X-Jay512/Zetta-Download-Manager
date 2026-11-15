const fs = require('fs');
const path = require('path');
const archiver = require('archiver');

const rootDir = path.resolve(__dirname, '..');
const extDir = path.join(rootDir, 'ext');
const manifestPath = path.join(extDir, 'manifest.json');

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const version = manifest.version || '1.0.0';
const safeName = (manifest.name || 'zdm').replace(/\s+/g, '-');

const targets = [
  path.join(rootDir, 'ZDM.zip'),
  path.join(rootDir, `${safeName}-${version}.zip`),
  path.join(rootDir, 'ZDM-firefox.zip')
];

function collectFiles(dir, base = '') {
  const result = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === 'back' || entry.name === 'bak' || entry.name.includes('Copy')) {
      continue;
    }
    const fullPath = path.join(dir, entry.name);
    const relPath = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      result.push(...collectFiles(fullPath, relPath));
    } else if (entry.isFile()) {
      result.push({ fullPath, relPath });
    }
  }
  return result;
}

const files = collectFiles(extDir);

function createZip(outputPath, isFirefox = false) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outputPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => resolve(output.bytesWritten));
    archive.on('error', (err) => reject(err));

    archive.pipe(output);

    for (const file of files) {
      if (isFirefox && file.relPath === 'manifest.json') {
        const ffManifest = { ...manifest };
        if (ffManifest.background && ffManifest.background.service_worker) {
          ffManifest.background = {
            scripts: [ffManifest.background.service_worker],
            service_worker: ffManifest.background.service_worker
          };
        }
        archive.append(JSON.stringify(ffManifest, null, 2), { name: 'manifest.json' });
      } else {
        archive.file(file.fullPath, { name: file.relPath });
      }
    }

    archive.finalize();
  });
}

async function run() {
  console.log(`Packaging extension from ${extDir}`);
  console.log(`Included files (${files.length}):`);
  files.forEach(f => console.log(` - ${f.relPath}`));

  for (const target of targets) {
    const isFf = target.toLowerCase().includes('firefox');
    const bytes = await createZip(target, isFf);
    console.log(`Created ${path.basename(target)} (${bytes} bytes)`);
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
