import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';

const root = 'https://raw.githubusercontent.com/ToxSam/open-source-avatars/main/data/avatars';
const files = ['100avatars-r1.json', '100avatars-r2.json', '100avatars-r3.json'];
const output = 'v46-avatar-contact-sheet';
await mkdir(output, { recursive: true });

const collections = await Promise.all(
  files.map(async file => {
    const response = await fetch(`${root}/${file}`);
    if (!response.ok) throw new Error(`data fetch failed ${response.status}: ${file}`);
    return response.json();
  }),
);
const avatars = collections.flat().sort((a, b) => {
  const na = Number(a.metadata?.number ?? 0);
  const nb = Number(b.metadata?.number ?? 0);
  return na - nb;
});

const concurrency = 12;
const cards = new Array(avatars.length);
let cursor = 0;

async function worker() {
  while (true) {
    const index = cursor++;
    if (index >= avatars.length) return;
    const avatar = avatars[index];
    const number = String(avatar.metadata?.number ?? index + 1).padStart(3, '0');
    const name = String(avatar.name ?? 'Unnamed').slice(0, 22);
    let image;
    let error = null;
    try {
      const response = await fetch(avatar.thumbnail_url, { redirect: 'follow' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const source = Buffer.from(await response.arrayBuffer());
      image = await sharp(source, { animated: false, pages: 1 })
        .resize(150, 150, { fit: 'cover', position: 'centre' })
        .jpeg({ quality: 85 })
        .toBuffer();
    } catch (cause) {
      error = cause?.message ?? String(cause);
      image = await sharp({
        create: { width: 150, height: 150, channels: 3, background: '#282b34' },
      }).jpeg().toBuffer();
    }
    const safe = name.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
    const svg = Buffer.from(`<svg width="170" height="190" xmlns="http://www.w3.org/2000/svg">
      <rect width="170" height="190" rx="10" fill="#f4f5f7"/>
      <text x="10" y="171" font-family="Arial,sans-serif" font-size="13" font-weight="700" fill="#15171c">${number} ${safe}</text>
      ${error ? '<circle cx="157" cy="12" r="6" fill="#d64545"/>' : ''}
    </svg>`);
    cards[index] = await sharp(svg)
      .composite([{ input: image, left: 10, top: 10 }])
      .png()
      .toBuffer();
  }
}
await Promise.all(Array.from({ length: concurrency }, () => worker()));

const perSheet = 30;
const cols = 6;
const rows = 5;
for (let sheetIndex = 0; sheetIndex < Math.ceil(cards.length / perSheet); sheetIndex += 1) {
  const chunk = cards.slice(sheetIndex * perSheet, (sheetIndex + 1) * perSheet);
  const composites = chunk.map((input, index) => ({
    input,
    left: (index % cols) * 176 + 8,
    top: Math.floor(index / cols) * 196 + 8,
  }));
  await sharp({
    create: { width: cols * 176 + 16, height: rows * 196 + 16, channels: 3, background: '#d9dce3' },
  })
    .composite(composites)
    .jpeg({ quality: 90 })
    .toFile(`${output}/sheet-${String(sheetIndex + 1).padStart(2, '0')}.jpg`);
}

await writeFile(
  `${output}/avatars.json`,
  `${JSON.stringify(avatars.map(a => ({
    number: a.metadata?.number,
    name: a.name,
    model_file_url: a.model_file_url,
    thumbnail_url: a.thumbnail_url,
    project_id: a.project_id,
  })), null, 2)}\n`,
  'utf8',
);
console.log(JSON.stringify({ avatars: avatars.length, sheets: Math.ceil(cards.length / perSheet) }, null, 2));
