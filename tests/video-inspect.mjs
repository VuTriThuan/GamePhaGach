import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve('artifacts');
const filename = process.env.VIDEO_FILE || fs.readdirSync(dir).filter((name) => name.endsWith('.webm') && fs.statSync(path.join(dir, name)).size > 1_000_000).sort((a, b) => fs.statSync(path.join(dir, b)).mtimeMs - fs.statSync(path.join(dir, a)).mtimeMs)[0];
if (!filename) throw new Error('No downloaded WebM to inspect');
const targets = await (await fetch('http://127.0.0.1:9223/json')).json();
const page = targets.find((target) => target.type === 'page' && target.url.includes('5173'));
const ws = new WebSocket(page.webSocketDebuggerUrl);
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
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const key = ++id;
  pending.set(key, { resolve, reject });
  ws.send(JSON.stringify({ id: key, method, params }));
});
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}
const metadata = await evaluate(`(async () => {
  const video = document.createElement('video');
  video.src = '/artifacts/${filename}';
  video.muted = true;
  video.preload = 'auto';
  await new Promise((resolve, reject) => { video.onloadedmetadata = resolve; video.onerror = () => reject(new Error('Could not open WebM')); });
  window.__inspectedVideo = video;
  if (!Number.isFinite(video.duration)) {
    video.currentTime = 1e10;
    await new Promise((resolve, reject) => { video.onseeked = resolve; video.onerror = reject; });
  }
  return {width: video.videoWidth, height: video.videoHeight, duration: Number.isFinite(video.duration) ? video.duration : video.currentTime, durationText: String(video.duration), readyState: video.readyState};
})()`);
if (metadata.width !== 720 || metadata.height !== 1280 || metadata.duration < 10) throw new Error(`Bad video metadata: ${JSON.stringify(metadata)}`);
const frames = [];
for (const second of [1, metadata.duration * 0.25, metadata.duration * 0.4, metadata.duration * 0.5, metadata.duration * 0.6, metadata.duration * 0.75, metadata.duration * 0.9, metadata.duration - 1]) {
  const result = await evaluate(`(async () => {
    const video = window.__inspectedVideo;
    video.currentTime = ${second};
    await new Promise((resolve, reject) => { video.onseeked = resolve; video.onerror = reject; });
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d'); ctx.drawImage(video, 0, 0);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let sum = 0; for (let i = 0; i < data.length; i += 300) sum = (sum + data[i]) >>> 0;
    return {image: canvas.toDataURL('image/png'), checksum: sum, time: video.currentTime};
  })()`);
  const name = `video-frame-${frames.length + 1}.png`;
  fs.writeFileSync(path.join(dir, name), Buffer.from(result.image.split(',')[1], 'base64'));
  frames.push({ time: result.time, checksum: result.checksum, file: name });
}
if (new Set(frames.map((frame) => frame.checksum)).size < 3) throw new Error('Video frames are not changing');
console.log(JSON.stringify({ filename, metadata, frames }, null, 2));
ws.close();
