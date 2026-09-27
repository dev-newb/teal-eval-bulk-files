#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname, sep } from 'node:path';
import { Marked } from 'marked';

const root = resolve(import.meta.dirname, '..');
const docs = resolve(root, 'docs');
const source = await readFile(resolve(docs, 'manual.md'), 'utf8');
const base = 'https://github.com/dev-newb/teal-eval-bulk-files/blob/main/docs/';
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const images = new Map();
for (const match of source.matchAll(/!\[([^\]]*)\]\(([^)]+)\)/g)) {
  const path = resolve(docs, match[2]);
  if (!path.startsWith(resolve(docs, 'images') + sep) || !path.endsWith('.png')) throw new Error('Manual images must be local documentation PNGs.');
  images.set(match[2], `data:image/png;base64,${(await readFile(path)).toString('base64')}`);
}
const headings = [];
const markdown = new Marked({ gfm: true, renderer: {
  heading({ tokens, depth }) {
    const title = tokens.map(token => token.text ?? token.raw ?? '').join('');
    const id = title.toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-');
    headings.push({ title, id, depth });
    return `<h${depth} id="${id}">${this.parser.parseInline(tokens)}</h${depth}>\n`;
  },
  image({ href, text }) {
    if (!images.has(href)) throw new Error(`Missing embedded screenshot: ${href}`);
    return `<figure><img src="${images.get(href)}" alt="${escape(text)}" loading="lazy"><figcaption>${escape(text)}</figcaption></figure>`;
  },
  link({ href, tokens }) {
    const destination = href.startsWith('#') ? href : new URL(href, base).href;
    if (!destination.startsWith('#') && !/^https?:/.test(destination)) throw new Error('Unsupported manual link');
    return `<a href="${escape(destination)}">${this.parser.parseInline(tokens)}</a>`;
  }
} });
const body = markdown.parse(source);
const ids = new Set(headings.map(heading => heading.id));
for (const match of body.matchAll(/href="#([^"]+)"/g)) if (!ids.has(match[1])) throw new Error(`Broken manual anchor: ${match[1]}`);
const navigation = headings.filter(h => h.depth === 2 && h.title !== 'Contents')
  .map(h => `<a href="#${h.id}">${escape(h.title)}</a>`).join('\n');
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Teal Eval Bulk Files — User and Agent Manual</title>
<style>
:root{color-scheme:light;--ink:#1e293b;--muted:#5b677b;--line:#dbe2ed;--accent:#4d46b5;--paper:#fff;--code:#f1f4fa}
*{box-sizing:border-box}html{scroll-behavior:smooth;scroll-padding-top:24px}body{margin:0;background:#f4f6fb;color:var(--ink);font:16px/1.65 Segoe UI,system-ui,sans-serif}
aside{position:fixed;inset:0 auto 0 0;width:244px;padding:30px 22px;background:#11131d;color:#edf0fa;overflow:auto}
.brand{font-size:20px;font-weight:750;line-height:1.25;margin-bottom:8px}.edition{font-size:12px;color:#a6aec5;margin-bottom:24px}nav a{display:block;color:#c6cce0;text-decoration:none;font-size:13px;line-height:1.45;padding:9px 0;border-bottom:1px solid #ffffff10}nav a:hover{color:white}
.print{width:100%;margin-top:24px;border:1px solid #7c82b1;background:#232840;color:white;border-radius:7px;padding:10px;font:600 13px Segoe UI,system-ui;cursor:pointer}
main{margin-left:244px;padding:42px 5vw 70px}article{max-width:1020px;margin:0 auto;background:var(--paper);padding:44px 48px;border:1px solid var(--line);border-radius:14px;box-shadow:0 10px 30px #1b245508}
h1,h2,h3{line-height:1.25;color:#121b30}h1{font-size:36px;letter-spacing:-.025em;margin:0 0 14px}h2{font-size:27px;margin:52px 0 18px;padding-top:14px;border-top:2px solid var(--line)}h3{font-size:20px;margin-top:32px}
p{margin:15px 0}a{color:var(--accent);text-decoration-thickness:1px;text-underline-offset:3px}li{margin:7px 0}strong{font-weight:650}code{font: .9em Consolas,ui-monospace,monospace;background:var(--code);padding:2px 5px;border-radius:4px}pre{background:#171c2b;color:#e7ecf7;border-radius:9px;padding:19px;overflow:auto;font-size:13px;line-height:1.55}pre code{background:none;padding:0;color:inherit}table{border-collapse:collapse;width:100%;font-size:14px;line-height:1.55;margin:22px 0}th{text-align:left;background:#edf0f8;color:#28324b}td,th{border:1px solid var(--line);padding:11px 13px;vertical-align:top}tr:nth-child(even) td{background:#fafbfe}blockquote{margin:22px 0;padding:2px 20px;border-left:4px solid #8079ce;background:#f4f3fb;color:#34335c}
figure{margin:26px 0 32px}figure img{display:block;width:100%;height:auto;border:1px solid #303340;border-radius:10px}figcaption{font-size:12px;color:var(--muted);text-align:center;line-height:1.5;padding-top:9px}footer{max-width:1020px;margin:22px auto;color:var(--muted);font-size:12px}
@media(max-width:950px){aside{position:static;width:auto;padding:22px}nav{display:flex;gap:10px;flex-wrap:wrap}nav a{padding:3px;border:0}.edition{margin-bottom:12px}.print{width:auto;padding:8px 18px;margin-top:12px}main{margin:0;padding:20px}article{padding:28px 24px}h1{font-size:30px}}
@media print{aside{display:none}body{background:white;font-size:10pt}main{margin:0;padding:0}article{max-width:none;padding:0;border:0;box-shadow:none}h1{font-size:24pt}h2{font-size:18pt;break-before:page}h3{break-after:avoid}figure,table,pre{break-inside:avoid}figure img{max-height:8in;object-fit:contain;border-radius:3px}pre{white-space:pre-wrap;overflow:visible;font-size:8pt}a{color:inherit}footer{display:none}@page{size:A4;margin:16mm}
</style></head><body>
<aside><div class="brand">Teal Eval<br>Bulk Files</div><div class="edition">USER &amp; AGENT MANUAL · 0.10.0</div><nav>${navigation}</nav><button class="print" onclick="window.print()">Print / Save PDF</button></aside>
<main><article>${body}</article><footer>Offline edition. All screenshots are embedded. Documentation uses a fictional local eval page. External reference links require an internet connection.</footer></main>
</body></html>`;
await writeFile(resolve(docs, 'manual.html'), html);
console.log(JSON.stringify({ output: resolve(docs, 'manual.html'), screenshots: images.size, headings: headings.length, bytes: Buffer.byteLength(html) }));
