import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const port = process.env.CDP_PORT || '9224';
const pagePort = process.env.PAGE_PORT || '5174';
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
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
  pending.delete(message.id);
  if (message.error) waiter.reject(new Error(message.error.message));
  else waiter.resolve(message.result);
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

const downloadPath = path.resolve('artifacts');
fs.mkdirSync(downloadPath, { recursive: true });
const priorFiles = new Set(fs.readdirSync(downloadPath));
await send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath });
await send('Page.reload', { ignoreCache: true });
await sleep(1000);
const button = await evaluate(`(() => { const r = document.querySelector('button.primary').getBoundingClientRect(); return {x: r.x + r.width / 2, y: r.y + r.height / 2}; })()`);
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: button.x, y: button.y, button: 'left', clickCount: 1 });
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: button.x, y: button.y, button: 'left', clickCount: 1 });
await sleep(500);
const before = await evaluate(`({visibility: document.visibilityState, time: window.__game?.shotTime, phaseTime: window.__game?.phaseTime, turn: window.__game?.turn, status: document.querySelector('.record-status span').textContent, clock: window.__clockStats || 'none'})`);
const otherTab = await send('Target.createTarget', { url: 'about:blank' });
await send('Target.activateTarget', { targetId: otherTab.targetId });
await sleep(5000);
const after = await evaluate(`({visibility: document.visibilityState, time: window.__game?.shotTime, phaseTime: window.__game?.phaseTime, turn: window.__game?.turn, status: document.querySelector('.record-status span').textContent, seconds: document.querySelector('.record-status strong').textContent, clock: window.__clockStats || 'none'})`);
await send('Target.activateTarget', { targetId: page.id });
await evaluate(`([...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Dừng quay')).click()`);
await sleep(1000);
const ready = await evaluate(`({status: document.querySelector('.record-status span').textContent, message: document.querySelector('.recorder-message').textContent})`);
await evaluate(`([...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Tải video')).click()`);
let filename;
for (let attempt = 0; attempt < 20; attempt++) {
  await sleep(250);
  filename = fs.readdirSync(downloadPath).find((file) => !priorFiles.has(file) && file.endsWith('.mp4'));
  if (filename) break;
}
assert.ok(filename, 'background video downloaded');
const video = await evaluate(`(async () => {
  const video = document.createElement('video');
  video.src = '/artifacts/${filename}';
  video.muted = true;
  await new Promise((resolve, reject) => { video.onloadedmetadata = resolve; video.onerror = reject; });
  await video.play();
  await new Promise((resolve) => { video.onended = resolve; setTimeout(resolve, 8000); });
  return {duration: video.duration, frames: video.getVideoPlaybackQuality().totalVideoFrames};
})()`);
await send('Target.closeTarget', { targetId: otherTab.targetId });
assert.equal(after.status, 'Đang quay');
assert.equal(ready.status, 'Sẵn sàng tải');
assert.ok(after.turn > before.turn || after.time > before.time + 2 || after.phaseTime > before.phaseTime + 2,
  `game did not advance in the background: ${JSON.stringify({ before, after })}`);
assert.equal(after.clock.audioState, 'running');
assert.ok(after.clock.pulses > before.clock.pulses + 120, 'audio clock should pulse in the background');
assert.ok(video.frames >= 120, `background recording has too few frames: ${video.frames}`);
console.log(JSON.stringify({ before, after, ready, filename, video }, null, 2));
ws.close();
