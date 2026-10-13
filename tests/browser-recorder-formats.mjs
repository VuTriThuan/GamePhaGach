import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const cdpPort = process.env.CDP_PORT || '9224';
const pagePort = process.env.PAGE_PORT || '5174';
const dir = path.resolve('artifacts');
fs.mkdirSync(dir, { recursive: true });
const targets = await (await fetch(`http://127.0.0.1:${cdpPort}/json`)).json();
const page = targets.find((item) => item.type === 'page' && item.url.includes(`:${pagePort}/`));
assert.ok(page, 'game page open in Chrome');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let id = 0;
const pending = new Map();
ws.onmessage = ({ data }) => {
  const message = JSON.parse(data);
  if (!message.id) return;
  const waiter = pending.get(message.id);
  if (!waiter) return;
  pending.delete(message.id);
  if (message.error) waiter.reject(new Error(message.error.message)); else waiter.resolve(message.result);
};
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const key = ++id;
    pending.set(key, { resolve, reject });
    ws.send(JSON.stringify({ id: key, method, params }));
  });
}
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
await send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: dir });
const support = await evaluate(`({webm: MediaRecorder.isTypeSupported('video/webm'), mp4: MediaRecorder.isTypeSupported('video/mp4'), avc: MediaRecorder.isTypeSupported('video/mp4;codecs=avc1.42E01E')})`);

async function cycle(extension) {
  const before = new Set(fs.readdirSync(dir));
  await evaluate(`document.querySelector('button.primary').click()`);
  await sleep(2400);
  const recording = await evaluate(`({status: document.querySelector('.record-status span').textContent, mime: document.querySelector('.recorder-message').textContent})`);
  assert.equal(recording.status, 'Đang quay');
  await evaluate(`([...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Dừng quay')).click()`);
  await sleep(1000);
  const ready = await evaluate(`({status: document.querySelector('.record-status span').textContent, message: document.querySelector('.recorder-message').textContent})`);
  assert.equal(ready.status, 'Sẵn sàng tải');
  await evaluate(`([...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Tải video')).click()`);
  let added = [];
  for (let attempt = 0; attempt < 20; attempt++) {
    await sleep(500);
    added = fs.readdirSync(dir).filter((file) => !before.has(file) && file.endsWith(`.${extension}`));
    if (added.length === 1) break;
  }
  assert.equal(added.length, 1, `one downloaded ${extension} file`);
  const filename = added[0];
  const bytes = fs.statSync(path.join(dir, filename)).size;
  assert.ok(bytes > 20_000, `${extension} file should contain frames`);
  const metadata = await evaluate(`(async () => {
    const video = document.createElement('video');
    video.src = '/artifacts/${filename}';
    await new Promise((resolve, reject) => { video.onloadedmetadata = resolve; video.onerror = () => reject(new Error('video decode failed')); });
    return {width: video.videoWidth, height: video.videoHeight};
  })()`);
  assert.deepEqual(metadata, { width: 720, height: 1280 });
  return { filename, bytes, recording, ready, metadata };
}

const preferred = await cycle(support.mp4 || support.avc ? 'mp4' : 'webm');
console.log(JSON.stringify({ support, preferred }, null, 2));
ws.close();
