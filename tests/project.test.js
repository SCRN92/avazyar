// بررسی هماهنگی فایل‌های پروژه با هم: چیزهایی که فراموش کردنشان آسان است
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fa } from '../js/notes.js';
import '../js/version.js';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
const list = (dir) => readdirSync(new URL(dir, root)).filter((f) => !f.startsWith('.')).map((f) => `${dir}/${f}`);

const VERSION = globalThis.AVAZYAR_VERSION;
const shell = [...read('sw.js').matchAll(/'\.\/([^']*)'/g)].map((m) => m[1]);

test('version is a plain x.y.z number', () => {
  assert.match(VERSION, /^\d+\.\d+\.\d+$/);
});

test('README shows the current version', () => {
  const [major, minor] = VERSION.split('.');
  assert.ok(read('README.md').includes(`نسخه‌ی ${fa(`${major}.${minor}`)}`), `README title should mention version ${major}.${minor}`);
});

test('the service worker precaches every file the app serves', () => {
  const served = [
    'index.html',
    'manifest.webmanifest',
    ...list('css'),
    ...list('js'),
    ...list('icons'),
    ...list('fonts').filter((f) => f.endsWith('.woff2')),
  ];
  for (const file of served) assert.ok(shell.includes(file), `sw.js SHELL is missing ${file}`);
});

test('the service worker precache has no missing files', () => {
  for (const file of shell.filter((f) => f !== '')) assert.doesNotThrow(() => readFileSync(new URL(file, root)), `sw.js lists ${file}, which does not exist`);
});

test('every font used by the stylesheet is a local file', () => {
  const css = read('css/style.css');
  const urls = [...css.matchAll(/url\(['"]?([^'")]+)['"]?\)/g)].map((m) => m[1]);
  assert.ok(urls.length >= 3);
  for (const u of urls) {
    assert.ok(!/^(https?:)?\/\//.test(u), `external url in css: ${u}`);
    assert.doesNotThrow(() => readFileSync(new URL(u, new URL('css/', root))), `missing ${u}`);
  }
});

test('the page loads nothing from other origins', () => {
  const html = read('index.html');
  assert.doesNotMatch(html, /(src|href)="(https?:)?\/\//);
});

test('manifest icons exist', () => {
  const manifest = JSON.parse(read('manifest.webmanifest'));
  assert.ok(manifest.icons.length >= 2);
  for (const icon of manifest.icons) assert.doesNotThrow(() => readFileSync(new URL(icon.src, root)), `missing ${icon.src}`);
});

test('the Docker image copies every folder the service worker needs', () => {
  const dockerfile = read('Dockerfile');
  const folders = new Set(shell.filter((f) => f.includes('/')).map((f) => f.split('/')[0]));
  for (const folder of folders) assert.match(dockerfile, new RegExp(`COPY ${folder} `), `Dockerfile does not copy ${folder}/`);
});
