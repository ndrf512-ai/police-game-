// Дымовой тест полной игры в headless Chromium: новая игра, прогон времени, скриншоты, ошибки консоли.
// node tools/smoke.mjs [url] [секунд реального прогона]
import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);
const { chromium } = (() => { for (const c of ['playwright', process.env.PLAYWRIGHT_PATH, '/opt/npm-tools/node_modules/playwright', '/opt/node-tools/node_modules/playwright']) { if (!c) continue; try { return require(c); } catch (e) { } } throw new Error('playwright не найден'); })();
const url = process.argv[2] || 'http://localhost:8765/index.html?quick=1';
const secs = +(process.argv[3] || 20);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errs = []; const logs = [];
page.on('console', (m) => { const t = m.text(); if (m.type() === 'error' || m.type() === 'warning') { if (!/willReadFrequently|GPU stall|AudioContext/.test(t)) errs.push(m.type() + ': ' + t); } else logs.push(t); });
page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message + ' @ ' + (e.stack || '').split('\n')[1]));
await page.goto(url); await page.waitForTimeout(4000);
const info = await page.evaluate(() => { const g = window.game; if (!g || !g.state) return { noState: true };
  return { mods: Object.fromEntries(Object.entries(g.sim).map(([k, v]) => [k, !!v])), station: !!g.station, combat: !!g.combat, ui: !!g.ui, audio: !!g.audio, staff: g.state.staff.length, actors: g.world.actors.length, districts: g.state.city?.districts?.length, time: g.timeStr() }; });
console.log('INFO', JSON.stringify(info));
await page.screenshot({ path: '/tmp/smoke_0.png' });
// ускоряем время, закрываем экраны
await page.evaluate(() => { const g = window.game; try { g.ui?.close?.(); } catch (e) { } g.setSpeed(10); });
const t0 = Date.now(); let k = 1;
while (Date.now() - t0 < secs * 1000) {
  await page.waitForTimeout(4000);
  const st = await page.evaluate(() => { const g = window.game; try { while (g.ui?.top?.()) g.ui.close(); } catch (e) { } if (g.paused) g.setSpeed(10);
    return { t: g.timeStr(), actors: g.world.actors.length, vis: g.world.actors.filter((a) => a.visible).map((a) => a.team[0] + ':' + (a.anim || '')).join(' ').slice(0, 300), radio: (g.state.radio || []).length, tasks: (g.state.city?.tasks || []).length, crimes: (g.state.city?.crimes || []).length, det: (g.state.detainees || []).length, atk: !!g.combat?.active, plans: (g.state.attackPlans || []).length, fps: g._fps };
  });
  console.log('STEP', JSON.stringify(st));
}
await page.screenshot({ path: '/tmp/smoke_1.png' });
const last = await page.evaluate(() => (window.game.state.radio || []).slice(-6).map((m) => `[${m.fromName || m.from}] ${m.text}`));
console.log('RADIO\n' + last.join('\n'));
console.log('ERRORS (' + errs.length + ')\n' + [...new Set(errs)].slice(0, 30).join('\n'));
await browser.close();
