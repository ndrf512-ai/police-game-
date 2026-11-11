// Сборка в один самодостаточный HTML: dist/index.html
import { createRequire } from 'node:module'; import fs from 'node:fs'; import path from 'node:path';
const require = createRequire(import.meta.url);
const esbuild = (() => { for (const c of ['esbuild', process.env.ESBUILD_PATH, '/opt/npm-tools/node_modules/esbuild', '/opt/node-tools/node_modules/esbuild']) { if (!c) continue; try { return require(c); } catch (e) { } } throw new Error('esbuild не найден: npm i -g esbuild@0.23 или ESBUILD_PATH=/путь/к/esbuild'); })();
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const res = await esbuild.build({ entryPoints: [path.join(root, 'src/main.js')], bundle: true, format: 'iife', globalName: 'Uchastok', minify: true, target: ['chrome80'], write: false, legalComments: 'none', logLevel: 'warning' });
const js = res.outputFiles[0].text;
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
html = html.replace(/<script type="module">[\s\S]*?<\/script>/, () => `<script>${js.replace(/<\/script/g, '<\\/script')}\nUchastok.boot().catch(function(e){console.error(e);var b=document.getElementById('boot');if(b)b.querySelector('.msg').textContent='Ошибка: '+e.message;});</script>`);
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist/index.html'), html);
console.log('dist/index.html', (html.length / 1024).toFixed(0) + ' KB');
