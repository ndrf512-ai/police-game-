// Стили интерфейса «Участка» (CSS как JS-строка; без внешних шрифтов и картинок — только CSS и inline SVG).

const NOISE = (op = 0.16, freq = 0.85) => `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='${freq}' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0.32  0 0 0 0 0.26  0 0 0 0 0.16  0 0 0 ${op} 0'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>")`;
const FIBERS = `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='400' height='400'><filter id='f'><feTurbulence type='fractalNoise' baseFrequency='0.012 0.09' numOctaves='3' seed='7'/><feColorMatrix values='0 0 0 0 0.45  0 0 0 0 0.38  0 0 0 0 0.22  0 0 0 0.10 0'/></filter><rect width='100%25' height='100%25' filter='url(%23f)'/></svg>")`;
const INKMASK = `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120'><filter id='m'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' seed='3'/><feColorMatrix values='0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -2.2 1.75'/></filter><rect width='100%25' height='100%25' filter='url(%23m)'/></svg>")`;

export const CSS = `
.uch{position:fixed;inset:0;z-index:40;pointer-events:none;overflow:hidden;
  --ui-scale:1;--fs:calc(clamp(12px, 1.55vmin + 6.2px, 19px) * var(--ui-scale));
  --ink:#24211c;--ink2:#4c463b;--ink3:#7d7565;--paper:#efe7d0;--paper2:#e5dbbf;--paper3:#d5c8a3;--paperEdge:#bfb08a;
  --blueLine:rgba(64,92,170,.26);--marg:rgba(196,60,50,.38);--red:#a8261d;--violet:#55399a;--ok:#3a6b31;--warn:#9a5c12;--bad:#a1271d;--blue:#2d4f8e;
  --hudBg:rgba(14,16,18,.66);--hudBg2:rgba(22,25,28,.82);--hudFg:#ebe4d1;--hudDim:#a69e8a;--amber:#e8a63c;--hudLine:rgba(235,228,209,.16);
  --sa-l:env(safe-area-inset-left,0px);--sa-r:env(safe-area-inset-right,0px);--sa-t:env(safe-area-inset-top,0px);--sa-b:env(safe-area-inset-bottom,0px);
  font-family:'Courier New','Liberation Mono','Nimbus Mono L','Cousine',monospace;font-size:var(--fs);line-height:1.3;color:var(--ink);
  -webkit-tap-highlight-color:transparent;user-select:none;-webkit-user-select:none;-webkit-text-size-adjust:100%;text-size-adjust:100%}
.uch *{box-sizing:border-box}
.uch button{font:inherit;color:inherit;cursor:pointer;-webkit-appearance:none;appearance:none;background:none;border:0;margin:0;touch-action:manipulation}
.uch input,.uch textarea,.uch select{font:inherit;color:inherit}
.uch .pix{image-rendering:pixelated;image-rendering:crisp-edges;display:block}
.uch .hidden{display:none!important}
.uch b,.uch strong{font-weight:700}
.uch .dim{color:var(--ink3)}
.uch .t-ok{color:var(--ok)} .uch .t-bad{color:var(--bad)} .uch .t-warn{color:var(--warn)} .uch .t-blue{color:var(--blue)}
.uch .nowrap{white-space:nowrap}
.uch .caps{text-transform:uppercase;letter-spacing:.08em}
.uch .small{font-size:.86em}
.uch .tiny{font-size:.76em}
.uch .grow{flex:1 1 auto;min-width:0}
.uch .row{display:flex;align-items:center;gap:.5em}
.uch .row.wrap{flex-wrap:wrap}
.uch .col{display:flex;flex-direction:column;gap:.4em}
.uch .sp{flex:1 1 auto}
.uch .center{text-align:center}
.uch .mt{margin-top:.6em} .uch .mb{margin-bottom:.6em}

/* ——— HUD ——— */
.uch-hud{position:absolute;inset:0;pointer-events:none;color:var(--hudFg);transition:opacity .25s}
.uch-hud.off{opacity:0;visibility:hidden}
.hud-chip{background:var(--hudBg);border:1px solid var(--hudLine);border-radius:3px;backdrop-filter:blur(2px);-webkit-backdrop-filter:blur(2px);box-shadow:0 2px 10px rgba(0,0,0,.35)}
.hud-top{position:absolute;top:calc(6px + var(--sa-t));left:50%;transform:translateX(-50%);display:flex;align-items:stretch;gap:4px;pointer-events:auto;z-index:2}
.hud-clock{display:flex;flex-direction:column;justify-content:center;padding:.15em .7em;min-height:44px;text-align:center;white-space:nowrap}
.hud-clock .c-main{font-size:1.18em;font-weight:700;letter-spacing:.04em;color:#f3ecd8}
.hud-clock .c-main .sep{opacity:.45;margin:0 .25em}
.hud-clock .c-sub{font-size:.74em;color:var(--hudDim);letter-spacing:.06em;text-transform:uppercase}
.hud-speed{display:flex;padding:3px;gap:2px}
.hud-speed button{min-width:40px;min-height:38px;padding:0 .35em;border-radius:2px;color:var(--hudDim);font-size:.95em;letter-spacing:-.12em;font-weight:700;line-height:1}
.hud-speed button.on{background:var(--amber);color:#1c1406;box-shadow:inset 0 -2px 0 rgba(0,0,0,.25)}
.hud-speed button:disabled{opacity:.22}
.hud-speed button:not(:disabled):active{background:rgba(255,255,255,.12)}
.hud-radio{position:absolute;top:calc(6px + var(--sa-t));left:calc(6px + var(--sa-l));width:min(36vw,440px);pointer-events:auto;padding:.35em .55em .4em;cursor:pointer;min-height:44px;
  background:linear-gradient(180deg,rgba(18,30,14,.78),rgba(10,18,8,.74));border-color:rgba(160,220,120,.18);color:#bfe39a;font-size:.84em}
.hud-radio .r-h{display:flex;align-items:center;gap:.4em;font-size:.82em;color:#86b06a;letter-spacing:.1em;text-transform:uppercase;margin-bottom:.15em}
.hud-radio .r-h .led{width:7px;height:7px;border-radius:50%;background:#3f5e2c;box-shadow:0 0 0 1px rgba(0,0,0,.4)}
.hud-radio .r-h .led.on{background:#8dff5a;box-shadow:0 0 6px #8dff5a}
.hud-radio .r-line{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;opacity:.62;line-height:1.35}
.hud-radio .r-line:last-child{opacity:1}
.hud-radio .r-line .cs{color:#e7f7c8;font-weight:700}
.hud-radio .r-line.alarm{color:#ffb38a}
.hud-radio .r-line.request{color:#ffe08a}
.hud-radio.req{animation:hudReq 1s steps(2) infinite}
.hud-radio .r-req{display:none;margin-top:.2em;color:#1d1405;background:#ffd36a;padding:.1em .4em;font-weight:700;font-size:.9em;letter-spacing:.04em}
.hud-radio.req .r-req{display:block}
@keyframes hudReq{0%{border-color:rgba(255,211,106,.9);box-shadow:0 0 14px rgba(255,200,90,.45)}100%{border-color:rgba(160,220,120,.18)}}
.hud-right{position:absolute;top:calc(6px + var(--sa-t));right:calc(6px + var(--sa-r));display:flex;gap:4px;pointer-events:auto;align-items:flex-start}
.hud-btn{min-width:44px;min-height:44px;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:.1em .45em;color:var(--hudFg);font-size:.72em;letter-spacing:.06em;text-transform:uppercase}
.hud-btn svg{width:1.9em;height:1.9em;display:block;margin-bottom:1px}
.hud-btn:active{background:rgba(255,255,255,.14)}
.hud-btn .badge{position:absolute;top:-4px;right:-4px;min-width:18px;height:18px;border-radius:9px;background:#c93a2a;color:#fff;font-size:11px;line-height:18px;text-align:center;padding:0 4px;font-weight:700}
.hud-btn{position:relative}
.hud-ind{position:absolute;top:calc(56px + var(--sa-t));right:calc(6px + var(--sa-r));display:flex;flex-direction:column;align-items:flex-end;gap:4px;pointer-events:none}
.hud-ind > *{pointer-events:auto}
.ind{display:flex;align-items:center;gap:.4em;padding:.25em .55em;font-size:.76em;letter-spacing:.08em;text-transform:uppercase;min-height:28px}
.ind .dot{width:8px;height:8px;border-radius:50%;background:currentColor}
.ind.raised{color:#ffcb66;border-color:rgba(255,203,102,.4)}
.ind.siege{color:#ff8a6a;border-color:rgba(255,120,90,.5)}
.ind.power{color:#ffd7a0;border-color:rgba(255,190,120,.4)}
.ind.threat{color:#ffcb66;cursor:pointer;min-height:36px}
.ind.power svg{width:1.3em;height:1.3em}
.hud-attack{position:absolute;top:calc(58px + var(--sa-t));left:50%;transform:translateX(-50%);pointer-events:auto;cursor:pointer;
  background:rgba(120,14,10,.86);color:#fff3e6;border:1px solid #ff8a6a;padding:.35em 1em;font-weight:700;letter-spacing:.14em;text-transform:uppercase;font-size:.95em;
  box-shadow:0 0 24px rgba(255,60,30,.45);animation:atkBlink 1.1s ease-in-out infinite;white-space:nowrap;min-height:40px;display:flex;align-items:center;gap:.6em}
.hud-attack .sub{font-weight:400;letter-spacing:.04em;text-transform:none;font-size:.82em;opacity:.85}
@keyframes atkBlink{50%{background:rgba(70,8,6,.86);box-shadow:0 0 8px rgba(255,60,30,.25)}}
.hud-cross{position:absolute;left:50%;top:50%;width:22px;height:22px;margin:-11px 0 0 -11px;opacity:.85;transition:opacity .2s,transform .15s}
.hud-cross i{position:absolute;background:rgba(240,235,220,.9);box-shadow:0 0 2px rgba(0,0,0,.9)}
.hud-cross i:nth-child(1){left:10px;top:0;width:2px;height:7px}.hud-cross i:nth-child(2){left:10px;bottom:0;width:2px;height:7px}
.hud-cross i:nth-child(3){top:10px;left:0;height:2px;width:7px}.hud-cross i:nth-child(4){top:10px;right:0;height:2px;width:7px}
.hud-cross b{position:absolute;left:10px;top:10px;width:2px;height:2px;background:#fff;box-shadow:0 0 2px #000}
.hud-cross.hot{transform:scale(1.25)} .hud-cross.hot i{background:#ffd27a}
.hud-prompt{position:absolute;left:50%;top:calc(50% + 24px);transform:translate(-50%,0);padding:.4em .9em;font-size:.95em;white-space:nowrap;max-width:46vw;overflow:hidden;text-overflow:ellipsis;
  color:#fff7e2;background:rgba(10,12,14,.72);border:1px solid rgba(255,210,122,.45);border-radius:3px;opacity:0;transition:opacity .15s,transform .15s}
.hud-prompt.on{opacity:1;transform:translate(-50%,3px)}
.hud-prompt .k{display:inline-block;background:#ffd27a;color:#1e1606;font-weight:700;padding:0 .35em;margin-right:.5em;border-radius:2px;font-size:.85em}
.hud-player{position:absolute;top:calc(6px + var(--sa-t));left:calc(6px + var(--sa-l));margin-top:var(--radioH,72px);display:flex;gap:.6em;align-items:center;padding:.2em .55em;font-size:.8em;pointer-events:none}
.hud-player .hp{display:flex;align-items:center;gap:.35em}
.hud-player .hp i{display:block;width:5em;height:6px;background:rgba(255,255,255,.15);position:relative}
.hud-player .hp i b{position:absolute;left:0;top:0;bottom:0;background:#d9573f}
.uch-subs{position:absolute;left:50%;bottom:calc(10px + var(--sa-b));transform:translateX(-50%);width:min(44vw,640px);display:flex;flex-direction:column;align-items:center;gap:4px;pointer-events:none;z-index:3}
.sub-line{background:rgba(8,9,10,.7);color:#f2ecdb;padding:.25em .7em;border-radius:2px;text-align:center;font-size:.95em;line-height:1.3;animation:fadeIn .2s;text-shadow:0 1px 1px #000}
.sub-line .who{color:#ffd27a;font-weight:700}
.sub-line.out{opacity:0;transition:opacity .4s}
.uch-toasts{position:absolute;top:calc(56px + var(--sa-t));right:calc(6px + var(--sa-r));width:min(34vw,420px);display:flex;flex-direction:column;gap:5px;align-items:flex-end;pointer-events:none;z-index:6}
.uch.hasInd .uch-toasts{top:calc(56px + var(--indH,0px) + var(--sa-t))}
.toast{pointer-events:auto;background:var(--hudBg2);color:var(--hudFg);border-left:4px solid #8e8a7c;padding:.45em .7em;font-size:.86em;line-height:1.3;box-shadow:0 4px 16px rgba(0,0,0,.4);animation:toastIn .22s ease-out;max-width:100%;cursor:pointer}
.toast.good{border-left-color:#6fb35a}.toast.bad{border-left-color:#e0523c}.toast.warn{border-left-color:#e8a63c}.toast.radio{border-left-color:#8dff5a;color:#d4f4b4}.toast.money{border-left-color:#d8c160}
.toast.out{opacity:0;transform:translateX(16px);transition:all .35s}
@keyframes toastIn{from{opacity:0;transform:translateX(24px)}}
@keyframes fadeIn{from{opacity:0}}

/* ——— экраны и окна ——— */
.uch-screens{position:absolute;inset:0;pointer-events:none}
.scr{position:absolute;inset:0;pointer-events:auto;background:rgba(8,9,11,.66);display:flex;align-items:center;justify-content:center;animation:scrIn .2s ease-out;
  padding:max(5px,1.4vh) max(6px,1.4vw);padding-left:max(6px,1.4vw,var(--sa-l));padding-right:max(6px,1.4vw,var(--sa-r))}
.scr.solid{background:#0b0c0d}
.scr.under{display:none}
.scr.closing{animation:scrOut .16s ease-in forwards}
@keyframes scrIn{from{opacity:0}}
@keyframes scrOut{to{opacity:0}}
.scr > .win{animation:winIn .24s cubic-bezier(.2,.8,.3,1)}
@keyframes winIn{from{transform:translateY(14px) scale(.985);opacity:.4}}
.win{position:relative;display:flex;flex-direction:column;width:100%;height:100%;max-width:1480px;max-height:960px;min-height:0;
  background-color:var(--paper);background-image:${FIBERS},${NOISE(0.17)},linear-gradient(180deg,#f2ead4,#e9dfc4);
  box-shadow:0 1px 0 rgba(255,255,255,.5) inset,0 0 0 1px rgba(0,0,0,.25),0 14px 50px rgba(0,0,0,.6),0 3px 0 -1px #d9cfb2,0 6px 0 -2px #c9bd9b;border-radius:2px;color:var(--ink)}
.win.mid{max-width:980px}
.win.narrow{max-width:720px}
.win.small{max-width:560px;height:auto;max-height:100%}
.win.auto{height:auto;max-height:100%}
.win-head{display:flex;align-items:center;gap:.6em;padding:.35em .45em .3em .9em;border-bottom:3px double rgba(36,33,28,.55);min-height:48px;flex:0 0 auto;position:relative}
.win-title{font-size:1.12em;font-weight:700;letter-spacing:.14em;text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.win-sub{font-size:.76em;color:var(--ink3);letter-spacing:.05em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.win-titles{display:flex;flex-direction:column;min-width:0;flex:0 1 auto}
.win-x{flex:0 0 auto;width:44px;height:44px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:1.25em;color:var(--ink2);border:2px solid rgba(36,33,28,.35);margin-left:auto}
.win-x:active{background:rgba(0,0,0,.08)}
.win-body{flex:1 1 auto;min-height:0;display:flex;position:relative;overflow:hidden}
.win-foot{flex:0 0 auto;display:flex;align-items:center;gap:.5em;padding:.4em .6em;border-top:1px solid rgba(36,33,28,.25);flex-wrap:wrap}
.scroll{overflow-y:auto;overflow-x:hidden;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;touch-action:pan-y;scrollbar-width:thin;scrollbar-color:rgba(36,33,28,.35) transparent;min-height:0}
.scroll::-webkit-scrollbar{width:7px}.scroll::-webkit-scrollbar-thumb{background:rgba(36,33,28,.3);border-radius:4px}
.scroll-x{overflow-x:auto;overflow-y:hidden;touch-action:pan-x;-webkit-overflow-scrolling:touch;scrollbar-width:none}
.pad{padding:.6em .9em}
.formno{position:absolute;top:.25em;right:3.6em;font-size:.62em;color:var(--ink3);letter-spacing:.06em;pointer-events:none}

/* вкладки */
.tabs{display:flex;gap:2px;align-items:flex-end;flex:0 1 auto;min-width:0;overflow-x:auto;scrollbar-width:none;touch-action:pan-x}
.tabs::-webkit-scrollbar{display:none}
.tab{min-height:40px;padding:.2em .85em;border:1.5px solid rgba(36,33,28,.4);border-bottom:0;border-radius:5px 5px 0 0;background:rgba(0,0,0,.05);color:var(--ink2);white-space:nowrap;font-size:.9em;letter-spacing:.03em}
.tab.on{background:var(--paper);color:var(--ink);font-weight:700;box-shadow:0 2px 0 var(--paper);position:relative;z-index:1}
.tab .cnt{display:inline-block;margin-left:.35em;background:var(--ink);color:var(--paper);border-radius:8px;padding:0 .4em;font-size:.8em;font-weight:700}
.tab .cnt.red{background:var(--red)}

/* кнопки */
.btn{min-height:max(44px,3.1em);padding:.3em .95em;border:2px solid var(--ink2);border-radius:2px;background:rgba(255,255,255,.18);color:var(--ink);font-weight:700;letter-spacing:.06em;text-transform:uppercase;font-size:.9em;
  display:inline-flex;align-items:center;justify-content:center;gap:.4em;text-align:center;line-height:1.15;box-shadow:0 2px 0 rgba(36,33,28,.35);transition:transform .05s}
.btn:active:not(:disabled){transform:translateY(2px);box-shadow:0 0 0 rgba(0,0,0,0);background:rgba(0,0,0,.08)}
.btn:disabled{opacity:.38;cursor:default;box-shadow:none}
.btn.primary{border-color:var(--red);color:var(--red);background:rgba(168,38,29,.06);box-shadow:0 2px 0 rgba(168,38,29,.45)}
.btn.primary.big{font-size:1.05em;letter-spacing:.18em;border-width:3px;padding:.3em 1.4em}
.btn.danger{border-color:var(--bad);color:var(--bad)}
.btn.violet{border-color:var(--violet);color:var(--violet)}
.btn.ghost{border-color:transparent;box-shadow:none;background:transparent;text-decoration:underline;text-underline-offset:3px;font-weight:400}
.btn.slim{min-height:44px;padding:.2em .6em;font-size:.82em}
.btn.wide{width:100%}
.btn .ic{font-size:1.1em}
.btns{display:flex;flex-wrap:wrap;gap:.45em}

/* сегменты и переключатели */
.seg{display:inline-flex;border:2px solid var(--ink2);border-radius:2px;overflow:hidden;max-width:100%}
.seg.wrap{flex-wrap:wrap}
.seg-opt{min-height:44px;padding:.2em .75em;border-right:1px solid rgba(36,33,28,.35);font-size:.88em;color:var(--ink2);background:rgba(255,255,255,.14);line-height:1.15;flex:1 1 auto;white-space:nowrap}
.seg.wrap .seg-opt{white-space:normal;border-bottom:1px solid rgba(36,33,28,.25)}
.seg-opt:last-child{border-right:0}
.seg-opt.on{background:var(--ink);color:var(--paper);font-weight:700}
.seg-opt:disabled{opacity:.35}
.seg.small .seg-opt{min-height:40px;font-size:.82em;padding:.15em .55em}
.tgl{min-height:44px;display:inline-flex;align-items:center;gap:.55em;padding:0 .2em}
.tgl-track{width:46px;height:24px;border-radius:12px;border:2px solid var(--ink2);position:relative;background:rgba(0,0,0,.06);flex:0 0 auto}
.tgl-knob{position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:var(--ink2);transition:left .15s}
.tgl.on .tgl-track{background:var(--ink)}
.tgl.on .tgl-knob{left:24px;background:var(--paper)}
.tgl-lbl{font-size:.88em;min-width:2.4em;text-align:left}
input[type=range].rng{-webkit-appearance:none;appearance:none;width:100%;height:44px;background:transparent;touch-action:pan-x}
input[type=range].rng::-webkit-slider-runnable-track{height:6px;background:linear-gradient(90deg,var(--ink2),var(--ink3));border-radius:3px}
input[type=range].rng::-webkit-slider-thumb{-webkit-appearance:none;width:26px;height:26px;border-radius:50%;background:var(--paper);border:3px solid var(--ink);margin-top:-10px;box-shadow:0 2px 3px rgba(0,0,0,.3)}
input[type=range].rng::-moz-range-track{height:6px;background:var(--ink2);border-radius:3px}
input[type=range].rng::-moz-range-thumb{width:22px;height:22px;border-radius:50%;background:var(--paper);border:3px solid var(--ink)}
.inp{width:100%;min-height:44px;border:0;border-bottom:2px solid var(--ink2);background:rgba(255,255,255,.25);padding:.3em .5em;font-size:1em;outline:none;user-select:text;-webkit-user-select:text}
textarea.inp{min-height:4.5em;resize:vertical;border:1.5px solid var(--ink3);background-image:repeating-linear-gradient(180deg,transparent 0,transparent calc(1.3em - 1px),var(--blueLine) calc(1.3em - 1px),var(--blueLine) 1.3em);line-height:1.3em}
.inp:focus{background-color:rgba(255,255,255,.5)}

/* полоски */
.bar{display:flex;align-items:center;gap:.35em;font-size:.78em;min-width:0}
.bar-l{color:var(--ink3);white-space:nowrap;min-width:0}
.bar-t{flex:1 1 auto;height:7px;background:rgba(36,33,28,.14);border:1px solid rgba(36,33,28,.3);position:relative;min-width:2.5em}
.bar-t i{position:absolute;left:0;top:0;bottom:0;display:block}
.bar.ok .bar-t i{background:#4f7b3f}.bar.mid .bar-t i{background:#b07d22}.bar.low .bar-t i{background:#b0352a}
.bar-n{min-width:1.9em;text-align:right;color:var(--ink2);font-weight:700}
.bar.thin .bar-t{height:5px}
.bars3{display:grid;grid-template-columns:auto 1fr;gap:.1em .4em;align-items:center}

/* фишки */
.chip{display:inline-flex;align-items:center;gap:.25em;border:1.2px solid var(--ink3);border-radius:10px;padding:.02em .5em;font-size:.76em;color:var(--ink2);white-space:nowrap;line-height:1.35}
.chip.good{border-color:#5b8a4b;color:#2f5a25;background:rgba(80,140,60,.08)}
.chip.bad{border-color:#b0493b;color:#8f251b;background:rgba(170,50,40,.07)}
.chip.mixed{border-color:#9a7a3a;color:#6e4f12}
.chip.st-ok{border-color:#5b8a4b;color:#2f5a25}.chip.st-blue{border-color:#3f5f9e;color:#2a4a86}.chip.st-bad{border-color:#b0493b;color:#8f251b;background:rgba(170,50,40,.08)}
.chip.st-dim{color:var(--ink3);border-style:dashed}.chip.st-dead{background:#2a2622;color:#e9e0c8;border-color:#2a2622}
.chip.red{background:var(--red);color:#fff;border-color:var(--red)}
.chips{display:flex;flex-wrap:wrap;gap:.25em}

/* бланки и машинопись */
.form-h{text-align:center;font-size:.72em;letter-spacing:.1em;color:var(--ink2);text-transform:uppercase;line-height:1.35}
.form-h b{font-size:1.12em;color:var(--ink)}
.form-title{text-align:center;font-weight:700;letter-spacing:.3em;text-transform:uppercase;font-size:1.15em;margin:.4em 0 .2em}
.lined{background-image:repeating-linear-gradient(180deg,transparent 0,transparent calc(1.45em - 1px),var(--blueLine) calc(1.45em - 1px),var(--blueLine) 1.45em);line-height:1.45em}
.margin-l{border-left:1.5px solid var(--marg);padding-left:.8em}
.fld{display:flex;align-items:baseline;gap:.4em;min-height:1.6em;border-bottom:1px dotted rgba(36,33,28,.35);padding:.12em 0}
.fld-l{color:var(--ink3);font-size:.82em;white-space:nowrap;flex:0 0 auto}
.fld-v{flex:1 1 auto;text-align:right;font-weight:700;min-width:0}
.typed{font-family:inherit;white-space:pre-wrap;color:#262320;text-shadow:0 0 .6px rgba(30,28,24,.7)}
.typed .hl{background:rgba(255,230,120,.5)}
.sect{font-weight:700;letter-spacing:.14em;text-transform:uppercase;font-size:.82em;color:var(--ink2);border-bottom:1.5px solid var(--ink2);padding-bottom:.1em;margin:.8em 0 .35em}
.sect:first-child{margin-top:.1em}
.note{font-size:.84em;color:var(--ink2);background:rgba(255,255,255,.22);border-left:3px solid var(--ink3);padding:.35em .6em}
.note.warn{border-left-color:var(--warn);background:rgba(220,160,60,.12)}
.note.bad{border-left-color:var(--bad);background:rgba(180,50,40,.08);color:#5e1a12}
.empty{color:var(--ink3);text-align:center;padding:1.6em .6em;font-style:italic}

.stamp{position:absolute;pointer-events:none;color:var(--red);border:3px double currentColor;padding:.15em .55em;font-weight:700;letter-spacing:.16em;text-transform:uppercase;font-size:1.05em;
  opacity:.72;mix-blend-mode:multiply;-webkit-mask-image:${INKMASK};mask-image:${INKMASK};-webkit-mask-size:120px;mask-size:120px;border-radius:3px;white-space:nowrap;line-height:1.1;text-align:center}
.stamp.violet{color:var(--violet);border-radius:50%;padding:.6em .7em;border-width:2px;font-size:.66em;letter-spacing:.06em}
.stamp.slam{animation:stampSlam .35s cubic-bezier(.3,1.6,.5,1)}
@keyframes stampSlam{0%{transform:scale(2.4) rotate(-14deg);opacity:0}60%{opacity:.85}}
.clip{position:absolute;width:16px;height:46px;pointer-events:none;filter:drop-shadow(1px 2px 1px rgba(0,0,0,.35))}
.photo{position:relative;background:#f7f4ea;padding:4px 4px 10px;box-shadow:0 2px 6px rgba(0,0,0,.35);transform:rotate(-1.5deg);flex:0 0 auto}
.photo .clip{top:-14px;right:10px}
.photo img{display:block}

/* списки-карточки */
.list{display:flex;flex-direction:column}
.li{display:flex;align-items:center;gap:.6em;padding:.35em .5em;border-bottom:1px solid rgba(36,33,28,.18);min-height:52px;cursor:pointer;position:relative}
.li:active{background:rgba(0,0,0,.05)}
.li.sel{background:rgba(168,38,29,.08);box-shadow:inset 4px 0 0 var(--red)}
.li.off{opacity:.5}
.li .portrait{flex:0 0 auto;border:1px solid rgba(0,0,0,.4)}
.li-main{flex:1 1 auto;min-width:0}
.li-t{font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.li-s{font-size:.8em;color:var(--ink3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.li-side{flex:0 0 auto;display:flex;align-items:center;gap:.4em}
.check{width:28px;height:28px;border:2px solid var(--ink2);border-radius:2px;flex:0 0 auto;display:flex;align-items:center;justify-content:center;font-weight:700;color:var(--red);font-size:1.2em;background:rgba(255,255,255,.3)}
.li.sel .check::after{content:'✓'}
.star{width:44px;height:44px;flex:0 0 auto;display:flex;align-items:center;justify-content:center;font-size:1.3em;color:var(--ink3);border-radius:50%}
.star.on{color:#b8860b;text-shadow:0 0 1px #000}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(13em,1fr));gap:.55em}
.card{border:1.5px solid rgba(36,33,28,.4);background:rgba(255,255,255,.2);padding:.5em .6em;position:relative;cursor:pointer;min-height:44px;text-align:left;display:block;width:100%}
.card:active{background:rgba(0,0,0,.05)}
.card.sel{border:2.5px solid var(--red);background:rgba(168,38,29,.06);box-shadow:2px 2px 0 rgba(168,38,29,.25)}
.card.dis{opacity:.42;cursor:default}
.card-t{font-weight:700;letter-spacing:.04em;margin-bottom:.15em}
.card-d{font-size:.8em;color:var(--ink2);line-height:1.3}
.card-m{font-size:.74em;color:var(--ink3);margin-top:.3em}

/* раскладки */
.split{display:flex;flex:1 1 auto;min-width:0;min-height:0}
.split > .pane{min-width:0;min-height:0;display:flex;flex-direction:column}
.pane.l{flex:1 1 56%;border-right:1.5px solid rgba(36,33,28,.3)}
.pane.r{flex:1 1 44%}
.pane.narrowL{flex:0 0 clamp(14em,36%,26em)}
.pane.fill{flex:1 1 auto}
.vdiv{border-left:1.5px solid rgba(36,33,28,.3)}

/* ——— главное меню ——— */
.scr.menu{background:#07080a;padding:0}
.menu-cv{position:absolute;inset:0;width:100%;height:100%;display:block}
.menu-wrap{position:relative;z-index:1;display:flex;align-items:center;gap:4vw;width:100%;height:100%;padding:4vh 6vw;padding-left:max(6vw,var(--sa-l))}
.menu-card{width:min(25em,48vw);padding:1.2em 1.4em 1.1em;position:relative;transform:rotate(-1.2deg);
  background-color:#d9c79d;background-image:${FIBERS},${NOISE(0.22)},linear-gradient(160deg,#dccb9f,#cbb684);box-shadow:0 20px 60px rgba(0,0,0,.75),0 0 0 1px rgba(0,0,0,.35)}
.menu-card .lbl{font-size:.68em;letter-spacing:.2em;color:#5a4a2c;text-transform:uppercase}
.menu-title{font-size:min(3.1em,11vh);font-weight:700;letter-spacing:.2em;color:#201b14;line-height:1;margin:.15em 0 .05em;text-shadow:0 0 1px rgba(0,0,0,.4)}
.menu-subt{font-size:1.05em;letter-spacing:.3em;color:#6b2a1e;margin-bottom:.6em}
.menu-card .rule{border-top:2px solid #3a3020;border-bottom:1px solid #3a3020;height:4px;margin:.4em 0 .7em}
.menu-btns{display:flex;flex-direction:column;gap:.45em}
.menu-btns .btn{justify-content:flex-start;background:rgba(255,255,255,.12);border-color:#3a3020;letter-spacing:.14em}
.menu-btns .btn .n{opacity:.5;margin-right:.6em;font-weight:400}
.menu-foot{position:absolute;right:max(14px,var(--sa-r));bottom:10px;color:rgba(230,220,200,.35);font-size:.7em;letter-spacing:.1em;z-index:1}
.menu-card .stamp{right:-.6em;top:1.4em}

/* ——— новая игра ——— */
.ng-body{display:flex;gap:1em;padding:.7em 1em;min-height:0;flex:1 1 auto}
.ng-col{display:flex;flex-direction:column;gap:.45em;min-width:0}
.ng-row{display:flex;align-items:center;gap:.6em;flex-wrap:wrap}
.ng-lbl{font-size:.78em;color:var(--ink3);letter-spacing:.08em;text-transform:uppercase;min-width:7.5em}
.ng-name{font-size:1.18em;font-weight:700;line-height:1.25}
.ng-story{font-size:.88em;line-height:1.45;color:#2d2924}
.ng-sand{display:grid;grid-template-columns:auto 1fr;gap:.35em .7em;align-items:center}

/* ——— карта города ——— */
.map-wrap{position:relative;flex:1 1 auto;min-height:0;background:#3a342a}
.map-wrap canvas{position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none}
.map-hint{position:absolute;left:.6em;bottom:.5em;font-size:.72em;color:#5c5140;pointer-events:none;background:rgba(239,231,208,.75);padding:.1em .4em}
.dist-head{display:flex;align-items:center;gap:.6em}
.dist-name{font-size:1.2em;font-weight:700;letter-spacing:.1em;text-transform:uppercase}
.kv{display:grid;grid-template-columns:auto 1fr;gap:.15em .6em;align-items:center}
.task-li{border:1.5px solid rgba(36,33,28,.35);margin:.35em 0;padding:.4em .55em;background:rgba(255,255,255,.18);position:relative}
.task-li .cs{font-weight:700;letter-spacing:.06em}
.task-li .ph{display:inline-block;padding:0 .4em;border:1px solid currentColor;font-size:.74em;letter-spacing:.06em;text-transform:uppercase;margin-left:.4em}
.ph.departing{color:#6b5a1e}.ph.enroute{color:#2a4a86}.ph.active{color:#3a6b31}.ph.returning{color:#6a3e86}.ph.done{color:var(--ink3)}
.prog{height:5px;background:rgba(36,33,28,.14);margin:.3em 0;position:relative}
.prog i{position:absolute;left:0;top:0;bottom:0;background:var(--ink2)}
.wiz-steps{display:flex;gap:2px;flex:1 1 auto;min-width:0;overflow-x:auto;scrollbar-width:none}
.wiz-steps::-webkit-scrollbar{display:none}
.wiz-step{flex:1 1 0;min-width:2.4em;min-height:36px;display:flex;align-items:center;justify-content:center;gap:.3em;font-size:.78em;color:var(--ink3);border-bottom:3px solid rgba(36,33,28,.15);white-space:nowrap;padding:0 .3em}
.wiz-step b{display:inline-flex;width:1.6em;height:1.6em;border-radius:50%;border:1.5px solid currentColor;align-items:center;justify-content:center;font-size:.9em}
.wiz-step.on{color:var(--red);border-bottom-color:var(--red);font-weight:700}
.wiz-step.done{color:var(--ink);border-bottom-color:var(--ink2)}
.wiz-step.done b{background:var(--ink);color:var(--paper)}
.opt-row{display:grid;grid-template-columns:minmax(8em,13em) 1fr;gap:.3em .8em;align-items:center;padding:.3em 0;border-bottom:1px dotted rgba(36,33,28,.25)}
.opt-row .ol{font-size:.86em;font-weight:700;color:var(--ink2)}
.opt-row .od{grid-column:2;font-size:.76em;color:var(--ink3);min-height:1em;line-height:1.3}
.details{border:1.5px dashed rgba(36,33,28,.4);margin:.6em 0;padding:0 .6em}
.details > summary,.det-sum{min-height:44px;display:flex;align-items:center;gap:.5em;font-weight:700;letter-spacing:.06em;cursor:pointer;list-style:none;text-transform:uppercase;font-size:.86em}
.details > summary::-webkit-details-marker{display:none}
.details > summary::before{content:'▸';transition:transform .15s;display:inline-block}
.details[open] > summary::before{transform:rotate(90deg)}
.order-sheet{background:rgba(255,255,255,.3);border:1px solid rgba(36,33,28,.25);padding:.6em .9em;position:relative;box-shadow:2px 3px 0 rgba(36,33,28,.08)}
.risk{display:flex;align-items:center;gap:.8em}
.risk-g{width:7.5em;height:3.9em;position:relative;overflow:hidden;flex:0 0 auto}
.risk-g::before{content:'';position:absolute;left:0;top:0;width:7.5em;height:7.5em;border-radius:50%;background:conic-gradient(from 270deg,#4f7b3f 0 45deg,#b9932c 45deg 100deg,#b0352a 100deg 180deg,transparent 180deg);-webkit-mask:radial-gradient(circle at 50% 50%,transparent 52%,#000 53%);mask:radial-gradient(circle at 50% 50%,transparent 52%,#000 53%)}
.risk-g i{position:absolute;left:50%;bottom:0;width:3px;height:3.4em;background:var(--ink);transform-origin:50% 100%;border-radius:2px;margin-left:-1.5px;transition:transform .6s cubic-bezier(.3,1.4,.5,1)}
.risk-g b{position:absolute;left:50%;bottom:-.45em;width:.9em;height:.9em;margin-left:-.45em;border-radius:50%;background:var(--ink)}
.risk-v{font-size:1.25em;font-weight:700;letter-spacing:.08em;text-transform:uppercase}

/* ——— личный состав ——— */
.pers-row .bars3{width:min(12em,24vw);flex:0 0 auto}
.pers-row .bar{font-size:.7em}
.shift-cell{display:flex;flex-direction:column;align-items:center;font-size:.66em;color:var(--ink3);letter-spacing:.06em;text-transform:uppercase}
.dossier{display:flex;gap:1em;padding:.7em .9em .9em;min-height:0}
.dossier .left{flex:0 0 auto;display:flex;flex-direction:column;align-items:center;gap:.5em;width:clamp(8em,22%,12em)}
.dossier .right{flex:1 1 auto;min-width:0}
.skills{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.15em 1.2em}
.trait{margin:.25em 0;font-size:.86em;line-height:1.35}
.trait .chip{margin-right:.4em}
.hist{font-size:.84em;line-height:1.4}
.hist .d{color:var(--ink3);margin-right:.5em}
.act-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(9.5em,1fr));gap:.4em}

/* ——— рация ——— */
.scr.radio .win{background:linear-gradient(180deg,#2b2d2b,#1c1e1c);color:#d8dccd;box-shadow:0 0 0 1px #000,0 14px 50px rgba(0,0,0,.7),inset 0 1px 0 rgba(255,255,255,.08);border-radius:10px}
.scr.radio .win-head{border-bottom:1px solid #0b0c0b;color:#c9cdbd}
.scr.radio .win-x{border-color:#5a5e55;color:#c9cdbd}
.radio-body{display:flex;gap:.6em;padding:.5em .6em .6em;flex:1 1 auto;min-height:0}
.lcd{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;border-radius:5px;padding:.35em .2em .35em .5em;position:relative;
  background:radial-gradient(ellipse at 40% 30%,#b9d27e,#93b25a 70%,#7f9e4a);color:#14200a;box-shadow:inset 0 0 0 2px #0f140a,inset 0 3px 12px rgba(0,0,0,.45),0 0 0 4px #3a3d38,0 0 0 5px #111}
.lcd::after{content:'';position:absolute;inset:0;pointer-events:none;border-radius:5px;background:repeating-linear-gradient(0deg,rgba(0,0,0,.05) 0 1px,transparent 1px 3px),repeating-linear-gradient(90deg,rgba(0,0,0,.04) 0 1px,transparent 1px 3px)}
.lcd .scroll{scrollbar-color:rgba(20,32,10,.4) transparent}
.lcd-top{display:flex;justify-content:space-between;font-size:.74em;letter-spacing:.12em;border-bottom:1px solid rgba(20,32,10,.35);padding:0 .3em .2em;margin-right:.3em;font-weight:700}
.rmsg{padding:.28em .3em;border-bottom:1px dashed rgba(20,32,10,.25);font-size:.9em;line-height:1.3;text-shadow:1px 1px 0 rgba(20,32,10,.12)}
.rmsg .t{opacity:.7;margin-right:.4em}
.rmsg .cs{font-weight:700;margin-right:.3em}
.rmsg.alarm{background:rgba(20,32,10,.12)}
.rmsg.alarm .cs::before{content:'!! ';font-weight:700}
.rmsg.request{background:rgba(20,32,10,.08);box-shadow:inset 3px 0 0 #14200a}
.rmsg .ch{display:flex;flex-wrap:wrap;gap:.35em;margin-top:.3em}
.rmsg .ch button{min-height:44px;padding:.1em .8em;background:#14200a;color:#b4cf7a;border-radius:2px;font-weight:700;letter-spacing:.04em;font-size:.92em}
.rmsg .ch button:active{background:#2b3d14}
.rmsg .ans{margin-top:.2em;font-weight:700}
.rmsg .exp{font-size:.82em;opacity:.75;margin-top:.2em}
.radio-side{flex:0 0 clamp(9em,24%,15em);display:flex;flex-direction:column;gap:.35em;min-height:0}
.hw-btn{min-height:44px;border-radius:4px;background:linear-gradient(180deg,#4a4d48,#353833);color:#e2e5d8;box-shadow:0 2px 0 #121311,inset 0 1px 0 rgba(255,255,255,.12);font-size:.8em;letter-spacing:.06em;padding:.15em .5em;text-align:left;display:flex;align-items:center;gap:.4em;width:100%}
.hw-btn.on{background:linear-gradient(180deg,#6b5d2a,#4e431c);color:#ffe9a8;box-shadow:0 1px 0 #121311,inset 0 0 6px rgba(255,220,120,.25)}
.hw-btn .led{width:7px;height:7px;border-radius:50%;background:#262824;flex:0 0 auto}
.hw-btn.on .led{background:#ffd36a;box-shadow:0 0 5px #ffd36a}
.hw-btn .led.req{background:#ff7b4a;box-shadow:0 0 5px #ff7b4a}
.grille{height:2.4em;border-radius:4px;background:radial-gradient(circle,#0b0c0b 1.5px,transparent 2px) 0 0/7px 7px,#2c2e2b;flex:0 0 auto}
.knob{width:2.8em;height:2.8em;border-radius:50%;background:radial-gradient(circle at 35% 30%,#6a6d66,#262824 70%);box-shadow:0 2px 4px rgba(0,0,0,.6),inset 0 0 0 2px #1a1b19;position:relative;flex:0 0 auto}
.knob::after{content:'';position:absolute;left:50%;top:12%;width:3px;height:30%;background:#d8dccd;margin-left:-1.5px;border-radius:2px}

/* ——— ТВ ——— */
.scr.tv{background:rgba(4,4,6,.82)}
.tv-case{position:relative;width:min(100%,calc((100vh - 3vh) * 1.62));height:100%;max-height:900px;display:flex;gap:2.5%;padding:2.4% 2.6%;border-radius:22px;
  background:linear-gradient(180deg,#3d322a,#2a221c 60%,#1f1915);box-shadow:0 0 0 2px #120e0b,inset 0 2px 0 rgba(255,255,255,.08),0 20px 60px rgba(0,0,0,.8)}
.tv-case::before{content:'';position:absolute;inset:0;border-radius:22px;background:repeating-linear-gradient(90deg,rgba(255,255,255,.015) 0 2px,transparent 2px 7px);pointer-events:none}
.tv-screen{position:relative;flex:1 1 auto;border-radius:12% / 16%;overflow:hidden;background:#0b0f12;box-shadow:0 0 0 6px #0c0a08,0 0 0 9px #2f2620,inset 0 0 40px rgba(0,0,0,.9)}
.tv-content{position:absolute;inset:0;display:flex;flex-direction:column;color:#eef3f6;font-size:1.02em;filter:saturate(1.15) contrast(1.05);transform:scale(1.025)}
.tv-glass{position:absolute;inset:0;pointer-events:none;border-radius:12% / 16%;
  background:radial-gradient(ellipse 80% 70% at 35% 25%,rgba(255,255,255,.12),transparent 45%),radial-gradient(ellipse at center,transparent 55%,rgba(0,0,0,.65) 100%),repeating-linear-gradient(0deg,rgba(0,0,0,.28) 0 1px,transparent 1px 3px)}
.tv-noise{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;mix-blend-mode:screen;opacity:.1;image-rendering:pixelated}
.tv-roll{animation:tvRoll 5.5s linear infinite}
@keyframes tvRoll{0%,92%{transform:translateY(0)}93%{transform:translateY(-1.5%)}95%{transform:translateY(1%)}97%{transform:translateY(0)}}
.tv-flick{animation:tvFlick .12s steps(2) infinite}
@keyframes tvFlick{50%{opacity:.96}}
.tv-top{display:flex;justify-content:space-between;align-items:center;padding:3.5% 6% 0;font-size:.82em;letter-spacing:.1em;text-shadow:2px 0 rgba(255,0,0,.35),-2px 0 rgba(0,180,255,.35)}
.tv-logo{background:#c6222a;color:#fff;padding:.1em .5em;font-weight:700;letter-spacing:.12em}
.tv-main{flex:1 1 auto;display:flex;gap:4%;padding:3% 6% 2%;min-height:0;align-items:center}
.tv-anchor{flex:0 0 auto;border:2px solid rgba(255,255,255,.25);box-shadow:0 0 12px rgba(80,140,255,.35)}
.tv-text{flex:1 1 auto;min-width:0;text-shadow:1.5px 0 rgba(255,0,0,.4),-1.5px 0 rgba(0,190,255,.4),0 0 6px rgba(255,255,255,.25)}
.tv-head{font-size:1.25em;font-weight:700;line-height:1.2;margin-bottom:.45em;text-transform:uppercase;letter-spacing:.03em}
.tv-body{font-size:.9em;line-height:1.38;opacity:.92;max-height:9.6em;overflow:hidden}
.tv-ticker{flex:0 0 auto;background:#0b2a63;border-top:2px solid #e7c548;white-space:nowrap;overflow:hidden;padding:.3em 0;font-size:.88em;margin-bottom:4.2%}
.tv-ticker span{display:inline-block;padding-left:100%;animation:tick linear infinite}
@keyframes tick{to{transform:translateX(-100%)}}
.tv-side{flex:0 0 clamp(4.5em,13%,7em);display:flex;flex-direction:column;align-items:center;gap:.7em;padding-top:1em}
.tv-side .knob{width:3.2em;height:3.2em}
.tv-key{width:100%;min-height:44px;border-radius:3px;background:linear-gradient(180deg,#4b4038,#2c241e);color:#d9cfbf;box-shadow:0 2px 0 #0d0a08,inset 0 1px 0 rgba(255,255,255,.1);font-weight:700;font-size:.9em}
.tv-key:active{transform:translateY(2px);box-shadow:none}
.tv-brand{color:#bfae8c;font-size:.66em;letter-spacing:.24em;margin-top:auto;padding-bottom:.5em;text-align:center}
.tv-x{position:absolute;top:6px;right:6px;z-index:3;color:#e7dcc6;border-color:#6b5c4c}
.tv-chan{position:absolute;top:8%;right:9%;font-size:2.2em;color:#7dff6a;text-shadow:0 0 8px #3f3;font-weight:700;opacity:0;transition:opacity .3s}
.tv-chan.on{opacity:1}

/* ——— схема участка ——— */
.plan-wrap{position:relative;flex:1 1 auto;min-height:0;background:#ece7d8}
.plan-wrap canvas{position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none}
.plan-legend{position:absolute;left:.5em;bottom:.4em;font-size:.68em;color:#5d5747;background:rgba(240,236,224,.85);padding:.15em .45em;pointer-events:none;display:flex;gap:.8em;flex-wrap:wrap}
.plan-legend i{display:inline-block;width:.9em;height:.9em;vertical-align:-.12em;margin-right:.3em;border:1px solid rgba(0,0,0,.4)}
.grp{border:1.5px solid rgba(36,33,28,.4);padding:.35em .55em;margin:.35em 0;background:rgba(255,255,255,.2);cursor:pointer;position:relative}
.grp.sel{border-color:var(--red);box-shadow:inset 4px 0 0 var(--red)}
.grp-h{display:flex;align-items:center;gap:.5em}
.grp-sw{width:.9em;height:.9em;border:1px solid rgba(0,0,0,.5);flex:0 0 auto}
.mem-chips{display:flex;flex-wrap:wrap;gap:.3em}
.mem{min-height:44px;display:flex;align-items:center;gap:.4em;border:1.5px solid rgba(36,33,28,.35);padding:.15em .5em .15em .2em;background:rgba(255,255,255,.2);font-size:.84em;text-align:left}
.mem.on{border-color:var(--ink);background:var(--ink);color:var(--paper)}
.mem.lead{border-color:#b8860b;box-shadow:0 0 0 2px rgba(184,134,11,.4)}
.mem img{border:1px solid rgba(0,0,0,.4)}
.mem .og{font-size:.8em;opacity:.7}
.combat-log{font-size:.82em;line-height:1.35}
.combat-log div{padding:.15em 0;border-bottom:1px dotted rgba(36,33,28,.2)}

/* ——— ИВС, допрос ——— */
.cellblk{border:2px solid rgba(36,33,28,.5);margin:.4em 0;background:repeating-linear-gradient(90deg,rgba(36,33,28,.06) 0 3px,transparent 3px 16px)}
.cellblk-h{display:flex;justify-content:space-between;align-items:center;padding:.2em .5em;background:rgba(36,33,28,.1);font-weight:700;letter-spacing:.1em;font-size:.84em;text-transform:uppercase}
.timer{font-weight:700}
.timer.low{color:var(--bad)}
.scr.interrog{background:rgba(2,2,3,.9)}
.scr.interrog .win{background:radial-gradient(ellipse 60% 70% at 30% 20%,#3b3628,#16140f 70%);color:#ddd5c0}
.scr.interrog .win-head{border-bottom-color:rgba(220,210,180,.25)}
.scr.interrog .win-x{border-color:rgba(220,210,180,.35);color:#ddd5c0}
.int-body{display:flex;gap:.8em;padding:.6em .8em;flex:1 1 auto;min-height:0}
.int-who{flex:0 0 auto;display:flex;flex-direction:column;gap:.4em;width:clamp(9em,26%,14em)}
.int-who .portrait{box-shadow:0 0 0 2px #000,0 0 30px rgba(255,220,140,.15)}
.int-who .bar-l,.int-who .bar-n{color:#bdb39b}
.int-proto{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;background:var(--paper);color:var(--ink);background-image:${NOISE(0.15)};box-shadow:0 4px 18px rgba(0,0,0,.6);transform:rotate(.4deg)}
.int-lines{padding:.5em .8em}
.int-lines p{margin:.25em 0;line-height:1.4}
.int-lines p.me{color:#2a3f78}
.int-lines p.intel{background:rgba(255,230,120,.55);padding:.2em .4em;font-weight:700}
.int-lines p.eff{font-size:.8em;color:var(--ink3)}
.app-btns{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:.35em;padding:.5em .8em .6em}
.app-btn{min-height:52px;border:1.5px solid rgba(220,210,180,.4);color:#efe6cf;background:rgba(255,255,255,.04);padding:.25em .35em;text-align:center;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.1em}
.app-btn b{font-size:.88em;letter-spacing:.04em}
.app-btn span{font-size:.66em;opacity:.65;line-height:1.2}
.app-btn:active{background:rgba(255,255,255,.12)}
.app-btn:disabled{opacity:.3}

/* ——— посетитель / предложение ——— */
.visit{display:flex;gap:1em;padding:.7em .9em;flex:1 1 auto;min-height:0}
.visit .glass{flex:0 0 auto;position:relative;padding:8px;background:linear-gradient(135deg,#5d6a6e,#3a4447);border-radius:4px;box-shadow:inset 0 0 0 2px #2a3033,0 4px 14px rgba(0,0,0,.35)}
.visit .glass::after{content:'';position:absolute;inset:8px;background:linear-gradient(120deg,rgba(255,255,255,.22),transparent 35%,transparent 70%,rgba(255,255,255,.08));pointer-events:none}
.visit .glass .hole{position:absolute;left:50%;bottom:16px;width:30%;height:10%;margin-left:-15%;border-radius:50%;background:radial-gradient(circle,rgba(0,0,0,.4) 1px,transparent 1.5px) 0 0/5px 5px;pointer-events:none}
.say{margin:.35em 0;line-height:1.42;animation:fadeIn .3s}
.say.them::before{content:'— ';}
.say.me{color:#2a3f78}
.choices{display:flex;flex-direction:column;gap:.4em}
.choice{min-height:46px;border:1.5px solid var(--ink2);background:rgba(255,255,255,.22);padding:.35em .7em;text-align:left;display:flex;flex-direction:column;gap:.1em;box-shadow:0 2px 0 rgba(36,33,28,.25)}
.choice b{font-size:.94em}
.choice span{font-size:.78em;color:var(--ink3)}
.choice:active{transform:translateY(2px);box-shadow:none}
.letter{background:#f4efe1;padding:1em 1.2em;box-shadow:0 3px 14px rgba(0,0,0,.25);position:relative;transform:rotate(-.5deg);line-height:1.45}

/* ——— блокнот ——— */
.scr.notebook .win{background-color:#f3f1ea;background-image:${NOISE(0.1)},linear-gradient(rgba(90,120,170,.2) 1px,transparent 1px),linear-gradient(90deg,rgba(90,120,170,.2) 1px,transparent 1px);background-size:auto,1.1em 1.1em,1.1em 1.1em;padding-left:2.2em}
.scr.notebook .win::before{content:'';position:absolute;left:0;top:0;bottom:0;width:2.2em;background:radial-gradient(circle at 50% 50%,#1b1b1b 0 .32em,#c9c4b5 .34em .5em,transparent .52em) 0 0/2.2em 1.6em repeat-y,linear-gradient(90deg,#7a2520,#5e1b17);box-shadow:inset -3px 0 6px rgba(0,0,0,.35)}
.nb-ink{color:#1d2f6b}
.goal{display:flex;gap:.6em;align-items:flex-start;padding:.35em 0;border-bottom:1px solid rgba(29,47,107,.12)}
.goal .box{width:1.3em;height:1.3em;border:2px solid #1d2f6b;flex:0 0 auto;display:flex;align-items:center;justify-content:center;font-weight:700;color:#a8261d;margin-top:.05em}
.goal.done .txt{text-decoration:line-through;text-decoration-color:#a8261d;opacity:.75}
.goal.failed .txt{color:#8f251b}
.logrow{display:flex;gap:.6em;padding:.2em 0;font-size:.88em;border-bottom:1px solid rgba(29,47,107,.08)}
.logrow .tm{color:#5a6a9a;flex:0 0 auto;white-space:nowrap}
.logrow.bad .tx,.logrow.combat .tx{color:#8f251b}.logrow.good .tx{color:#2f5a25}
.help-grid{display:grid;grid-template-columns:auto 1fr;gap:.3em 1em;font-size:.9em}
.help-grid dt{font-weight:700;white-space:nowrap}
.help-grid dd{margin:0;color:#2b2a26}

/* ——— диалоги ——— */
.uch-modal{position:absolute;inset:0;pointer-events:none;z-index:8}
.modal{position:absolute;inset:0;pointer-events:auto;background:rgba(6,7,8,.6);display:flex;align-items:center;justify-content:center;animation:scrIn .15s;padding:2vh 2vw}
.dlg{position:relative;width:min(36em,94vw);max-height:94vh;display:flex;flex-direction:column;background-color:var(--paper);background-image:${FIBERS},${NOISE(0.17)};box-shadow:0 14px 50px rgba(0,0,0,.6),0 0 0 1px rgba(0,0,0,.3);animation:winIn .2s}
.dlg-h{padding:.55em .9em .35em;font-weight:700;letter-spacing:.12em;text-transform:uppercase;border-bottom:3px double rgba(36,33,28,.5)}
.dlg-b{padding:.6em .9em;display:flex;gap:.8em;min-height:0}
.dlg-t{line-height:1.45;white-space:pre-wrap}
.dlg-c{padding:.2em .9em .8em;display:flex;flex-direction:column;gap:.4em}
.dlg-c.row{flex-direction:row;justify-content:flex-end}

/* ——— итоги, развод, конец ——— */
.sheet{max-width:52em;margin:0 auto;padding:.9em 1.4em 1.4em;position:relative}
.sheet .stamp{right:1em;top:3.2em}
.num-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(10em,1fr));gap:.4em;margin:.4em 0}
.num{border:1px solid rgba(36,33,28,.3);padding:.3em .5em;background:rgba(255,255,255,.18)}
.num b{display:block;font-size:1.45em;line-height:1.1}
.num span{font-size:.74em;color:var(--ink3);text-transform:uppercase;letter-spacing:.06em}
.num.bad b{color:var(--bad)}.num.good b{color:var(--ok)}
.scr.gameover{background:#050506}
.go-wrap{max-width:46em;width:100%;max-height:100%;display:flex;flex-direction:column}
.go-sheet{background-color:var(--paper);background-image:${FIBERS},${NOISE(0.2)};box-shadow:0 20px 70px rgba(0,0,0,.85);padding:1em 1.6em 1.2em;position:relative;min-height:0;display:flex;flex-direction:column}
.go-sheet.lose{filter:sepia(.25)}
.go-big{font-size:1.5em;font-weight:700;letter-spacing:.2em;text-align:center;margin:.3em 0}

/* ——— настройки ——— */
.set-grid{display:grid;grid-template-columns:minmax(9em,15em) 1fr;gap:.2em 1em;align-items:center}
.set-grid .sl{font-size:.9em;color:var(--ink2)}
.set-grid .sv{display:flex;align-items:center;gap:.6em;min-height:46px}
.set-grid .sv .val{min-width:3.2em;text-align:right;font-weight:700}

/* ——— сейф/снабжение ——— */
.cat-row{display:grid;grid-template-columns:1fr auto auto;gap:.3em .8em;align-items:center;padding:.4em .2em;border-bottom:1px dotted rgba(36,33,28,.3)}
.cat-row .nm{font-weight:700}
.cat-row .ds{font-size:.76em;color:var(--ink3);grid-column:1}
.cat-row .pr{text-align:right;white-space:nowrap}
.qty{display:flex;align-items:center;border:1.5px solid var(--ink2)}
.qty button{width:44px;height:44px;font-size:1.2em;font-weight:700}
.qty span{min-width:2.2em;text-align:center;font-weight:700}
.moneybox{display:flex;align-items:baseline;gap:.5em;font-size:1.1em}
.moneybox b{font-size:1.25em}
.phone-pad{background:#2b2b2b;color:#ddd;border-radius:6px;padding:.5em .7em;box-shadow:inset 0 2px 6px rgba(0,0,0,.5)}
.inv-row{display:flex;align-items:center;gap:.5em;padding:.2em 0;border-bottom:1px dotted rgba(36,33,28,.25);font-size:.9em}
.inv-row .c{margin-left:auto;font-weight:700;min-width:2.4em;text-align:right}
.slot{display:flex;align-items:center;gap:.6em;border:1.5px solid rgba(36,33,28,.35);padding:.3em .5em;margin:.35em 0;background:rgba(255,255,255,.2)}
.slot .sn{font-size:.74em;color:var(--ink3);text-transform:uppercase;letter-spacing:.08em;min-width:6.5em}
.slot .sv{font-weight:700;flex:1 1 auto;min-width:0}

/* ——— адаптив ——— */
@media (max-height:430px){
  .win-head{min-height:44px;padding-top:.2em;padding-bottom:.15em}
  .win-title{font-size:1.02em}
  .pad{padding:.45em .65em}
  .dossier{padding:.45em .6em}
  .app-btns{grid-template-columns:repeat(5,minmax(0,1fr))}
}
@media (max-width:720px){
  .hud-radio{width:min(34vw,330px)}
  .pane.narrowL{flex-basis:clamp(12em,40%,20em)}
  .opt-row{grid-template-columns:minmax(6.5em,9em) 1fr}
  .set-grid{grid-template-columns:minmax(7em,11em) 1fr}
  .app-btn span{display:none}
}
@media (prefers-reduced-motion:reduce){.scr,.scr > .win,.toast,.hud-attack,.hud-radio.req{animation:none!important}}
`;

export function injectStyle(doc = document) {
  if (doc.getElementById('uch-style')) return;
  const s = doc.createElement('style');
  s.id = 'uch-style';
  s.textContent = CSS;
  doc.head.appendChild(s);
}
