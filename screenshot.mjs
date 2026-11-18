// Screenshot the dashboard (board, detail, filtered) with Puppeteer.
import puppeteer from 'puppeteer';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'out');
const shotsDir = join(here, 'screenshots');

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-gpu', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 1440, deviceScaleFactor: 1 });
await page.goto('file://' + join(outDir, 'dashboard', 'index.html'), { waitUntil: 'networkidle0' });
await new Promise(r => setTimeout(r, 800));

// 1. Board view (top of page).
await page.screenshot({ path: join(shotsDir, 'board.png') });

// 2. Detail view: click the first row, then jump straight to the detail's top (no smooth scroll).
await page.evaluate(() => {
  const tr = document.querySelector('#rows tr[data-slug]');
  if (tr) tr.click();
});
await new Promise(r => setTimeout(r, 800));
await page.evaluate(() => {
  const d = document.getElementById('detail');
  const y = d.getBoundingClientRect().top + window.scrollY;
  window.scrollTo(0, y);
});
await new Promise(r => setTimeout(r, 500));
await page.screenshot({ path: join(shotsDir, 'detail.png') });

// 3. Filtered view: close detail, set verdict filter to "thin", scroll to top.
await page.evaluate(() => {
  document.getElementById('dClose').click();
  const sel = document.getElementById('fVerdict');
  sel.value = 'thin';
  sel.dispatchEvent(new Event('change', { bubbles: true }));
  window.scrollTo(0, 0);
});
await new Promise(r => setTimeout(r, 600));
await page.screenshot({ path: join(shotsDir, 'filtered.png') });

// 4. Method view: scroll to the method section (variant table + walk-forward).
await page.evaluate(() => {
  document.getElementById('fVerdict').value = '';
  document.getElementById('fVerdict').dispatchEvent(new Event('change', { bubbles: true }));
  const m = document.getElementById('methodSec');
  const y = m.getBoundingClientRect().top + window.scrollY;
  window.scrollTo(0, y);
});
await new Promise(r => setTimeout(r, 600));
await page.screenshot({ path: join(shotsDir, 'method.png') });

await browser.close();
console.log('screenshots done');
