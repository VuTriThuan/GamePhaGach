import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve('artifacts');
const target = (await (await fetch('http://127.0.0.1:9223/json')).json()).find((item) => item.type === 'page' && item.url.includes('5173'));
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let id = 0;
const pending = new Map();
ws.onmessage = ({ data }) => {
  const message = JSON.parse(data);
  if (!message.id) return;
  const waiter = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) waiter.reject(new Error(message.error.message)); else waiter.resolve(message.result);
};
function send(method, params = {}) { return new Promise((resolve, reject) => { const key = ++id; pending.set(key, { resolve, reject }); ws.send(JSON.stringify({ id: key, method, params })); }); }
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
await send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: dir });
const results = [];
for (let cycle = 0; cycle < 2; cycle++) {
  const existing = new Set(fs.readdirSync(dir));
  await evaluate(`document.querySelector('button.primary').click()`);
  await sleep(2200);
  await evaluate(`([...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Dừng quay')).click()`);
  await sleep(850);
  const state = await evaluate(`({status: document.querySelector('.record-status span').textContent, buttons: [...document.querySelectorAll('button')].map(b => b.disabled), label: [...document.querySelectorAll('button')].map(b => b.textContent.trim())})`);
  if (state.status !== 'Sẵn sàng tải' || state.buttons.join(',') !== 'false,true,false') throw new Error(JSON.stringify(state));
  await evaluate(`([...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Tải video')).click()`);
  await sleep(850);
  const added = fs.readdirSync(dir).filter((file) => !existing.has(file) && file.endsWith('.webm'));
  if (added.length !== 1) throw new Error(`Cycle ${cycle + 1}: expected one new WebM, found ${JSON.stringify(added)}`);
  const bytes = fs.statSync(path.join(dir, added[0])).size;
  if (bytes < 10_000) throw new Error(`Cycle ${cycle + 1}: tiny video ${bytes} bytes`);
  results.push({ cycle: cycle + 1, state, file: added[0], bytes });
}
console.log(JSON.stringify(results, null, 2));
ws.close();
