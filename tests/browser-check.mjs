import fs from 'node:fs';
import path from 'node:path';

const downloadPath = path.resolve('artifacts');
fs.mkdirSync(downloadPath, { recursive: true });
const targets = await (await fetch('http://127.0.0.1:9223/json')).json();
const page = targets.find((target) => target.type === 'page' && target.url.includes('5173'));
if (!page) throw new Error('Game page not found in Chrome');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let id = 0;
const pending = new Map();
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (!message.id) return;
  const pair = pending.get(message.id);
  if (!pair) return;
  pending.delete(message.id);
  if (message.error) pair.reject(new Error(message.error.message)); else pair.resolve(message.result);
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
async function screenshot(name) {
  const result = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(path.join(downloadPath, name), Buffer.from(result.data, 'base64'));
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

await send('Page.enable');
await send('Runtime.enable');
await send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath });
await send('Emulation.clearDeviceMetricsOverride');
await sleep(350);
const before = await evaluate(`({canvas: [document.querySelector('canvas').width, document.querySelector('canvas').height], buttons: [...document.querySelectorAll('button')].map(b => ({text: b.textContent.trim(), disabled: b.disabled})), gameIndex: window.__game?.gameIndex})`);
if (before.canvas[0] !== 720 || before.canvas[1] !== 1280) throw new Error('Canvas dimensions wrong');
await screenshot('desktop.png');
await evaluate(`document.querySelector('button.primary').click()`);
await sleep(1200);
const during = await evaluate(`({status: document.querySelector('.record-status span').textContent, buttons: [...document.querySelectorAll('button')].map(b => b.disabled), mime: document.querySelector('.recorder-message').textContent, gameIndex: window.__game?.gameIndex})`);
if (during.status !== 'Đang quay' || during.buttons.join(',') !== 'true,false,true') throw new Error(`Recording UI invalid: ${JSON.stringify(during)}`);
const startIndex = during.gameIndex;
let observedIndex = startIndex;
for (let i = 0; i < 45 && observedIndex < startIndex + 2; i++) {
  await sleep(1000);
  observedIndex = await evaluate('window.__game?.gameIndex');
}
if (observedIndex < startIndex + 2) throw new Error(`Did not observe two game restarts: ${startIndex} -> ${observedIndex}`);
await sleep(900);
await evaluate(`([...document.querySelectorAll('button')].find(b => b.textContent.includes('Dừng quay'))).click()`);
await sleep(1700);
const after = await evaluate(`({status: document.querySelector('.record-status span').textContent, buttons: [...document.querySelectorAll('button')].map(b => b.disabled), gameIndex: window.__game?.gameIndex, losses: window.__game?.lossHistory})`);
if (after.status !== 'Sẵn sàng tải' || after.buttons.join(',') !== 'false,true,false') throw new Error(`Ready UI invalid: ${JSON.stringify(after)}`);
await evaluate(`([...document.querySelectorAll('button')].find(b => b.textContent.includes('Tải video'))).click()`);
await sleep(1800);
const videos = fs.readdirSync(downloadPath).filter((name) => name.endsWith('.webm'));
if (!videos.length) throw new Error('No downloaded WebM');
const videoPath = path.join(downloadPath, videos.at(-1));
const bytes = fs.statSync(videoPath).size;
if (bytes < 100_000) throw new Error(`WebM too small: ${bytes}`);

await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await sleep(1000);
const narrow = await evaluate(`({canvas: document.querySelector('canvas').getBoundingClientRect().toJSON(), controls: document.querySelector('.control-panel').getBoundingClientRect().toJSON()})`);
if (narrow.controls.y < narrow.canvas.bottom) throw new Error('Controls overlap the canvas on narrow view');
await screenshot('narrow.png');
console.log(JSON.stringify({ before, during, after, narrow, videoPath, bytes }, null, 2));
ws.close();
