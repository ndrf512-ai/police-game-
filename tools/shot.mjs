// node tools/shot.mjs <url> <out-prefix> [script.json]
import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);
const { chromium } = (() => { for (const c of ['playwright', process.env.PLAYWRIGHT_PATH, '/opt/npm-tools/node_modules/playwright', '/opt/node-tools/node_modules/playwright']) { if (!c) continue; try { return require(c); } catch (e) { } } throw new Error('playwright не найден'); })();
const url = process.argv[2]; const out = process.argv[3] || '/tmp/shot'; const steps = JSON.parse(process.argv[4] || '[]');
const w = +(process.env.W || 960), h = +(process.env.H || 540);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
const logs = []; page.on('console', (m) => logs.push(m.type() + ': ' + m.text())); page.on('pageerror', (e) => logs.push('PAGEERROR: ' + e.message + '\n' + e.stack));
await page.goto(url); await page.waitForTimeout(+(process.env.WAIT || 3000));
let k = 0;
for (const s of steps) {
  if (s.eval) { try { const r = await page.evaluate(s.eval); if (r !== undefined) console.log('eval:', JSON.stringify(r).slice(0, 2000)); } catch (e) { console.log('eval error', e.message); } }
  if (s.wait) await page.waitForTimeout(s.wait);
  if (s.shot) { await page.screenshot({ path: `${out}_${s.shot}.png` }); k++; }
}
if (!steps.length) await page.screenshot({ path: `${out}_0.png` });
console.log(logs.filter((l) => !l.includes('GPU stall')).slice(0, 40).join('\n'));
await browser.close();
