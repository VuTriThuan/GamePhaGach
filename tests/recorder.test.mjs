import assert from 'node:assert/strict';
import { CanvasRecorder } from '../src/recorder/CanvasRecorder.ts';
import { RecordingSchedule } from '../src/recorder/RecordingSchedule.ts';

const downloads = [];
const revoked = [];
const blobs = [];
const originalCreate = URL.createObjectURL;
const originalRevoke = URL.revokeObjectURL;
URL.createObjectURL = (blob) => { blobs.push(blob); return `blob:fake-${blobs.length}`; };
URL.revokeObjectURL = (url) => revoked.push(url);
globalThis.document = { createElement: () => ({ click() { downloads.push({ href: this.href, filename: this.download }); } }) };

class FakeMediaRecorder {
  static supported = new Set();
  static defaultMime = 'video/mp4';
  static payloadSize = 4096;
  static isTypeSupported(mime) { return this.supported.has(mime); }
  constructor(stream, options) {
    this.stream = stream;
    this.mimeType = options?.mimeType || FakeMediaRecorder.defaultMime;
    this.state = 'inactive';
  }
  start() { this.state = 'recording'; }
  stop() {
    this.state = 'inactive';
    queueMicrotask(() => {
      this.ondataavailable?.({ data: new Blob([new Uint8Array(FakeMediaRecorder.payloadSize)], { type: this.mimeType }) });
      this.onstop?.();
    });
  }
}
globalThis.MediaRecorder = FakeMediaRecorder;
const tracks = [];
const canvas = { captureStream: () => ({ getTracks: () => [{ stop: () => tracks.push('stopped') }] }) };
const changes = [];
const recorder = new CanvasRecorder(canvas, (info) => changes.push(info));

FakeMediaRecorder.supported = new Set(['video/mp4']);
recorder.start();
assert.equal(recorder.info.phase, 'RECORDING');
recorder.stop();
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(recorder.info.phase, 'READY');
assert.equal(recorder.info.mime, 'video/mp4');
assert.ok(recorder.info.bytes > 0);
recorder.download();
assert.ok(downloads.at(-1).filename.endsWith('.mp4'));
assert.equal(blobs.at(-1).type, 'video/mp4');
assert.equal(recorder.info.exportProgress, 100);
assert.match(recorder.info.exportMessage, /trình duyệt/);

FakeMediaRecorder.supported = new Set(['video/webm;codecs=vp8', 'video/mp4']);
recorder.start();
assert.deepEqual(revoked, ['blob:fake-1']);
recorder.stop();
await new Promise((resolve) => setTimeout(resolve, 0));
recorder.download();
assert.ok(downloads.at(-1).filename.endsWith('.mp4'));
assert.equal(recorder.info.mime, 'video/mp4');

FakeMediaRecorder.supported = new Set(['video/webm;codecs=vp8']);
recorder.start();
recorder.stop();
await new Promise((resolve) => setTimeout(resolve, 0));
recorder.download();
assert.ok(downloads.at(-1).filename.endsWith('.webm'));
assert.equal(recorder.info.mime, 'video/webm;codecs=vp8');

FakeMediaRecorder.supported = new Set();
FakeMediaRecorder.defaultMime = 'video/mp4';
recorder.start();
recorder.stop();
await new Promise((resolve) => setTimeout(resolve, 0));
recorder.download();
assert.ok(downloads.at(-1).filename.endsWith('.mp4'));
assert.equal(downloads.length, 4);
FakeMediaRecorder.payloadSize = 512 * 1024;
recorder.start();
recorder.stop();
await new Promise((resolve) => setTimeout(resolve, 0));
let written = 0;
let closed = false;
let chosenName = '';
globalThis.window = {
  showSaveFilePicker: async ({ suggestedName }) => {
    chosenName = suggestedName;
    return { createWritable: async () => ({
      write: async (data) => { written += data.byteLength; },
      close: async () => { closed = true; },
      abort: async () => { throw new Error('Unexpected abort'); },
    }) };
  },
};
const beforeExport = changes.length;
await recorder.download();
assert.equal(written, FakeMediaRecorder.payloadSize);
assert.equal(closed, true);
assert.ok(chosenName.endsWith('.mp4'));
assert.equal(recorder.info.phase, 'READY');
assert.equal(recorder.info.exportProgress, 100);
assert.ok(changes.slice(beforeExport).some((info) => info.phase === 'EXPORTING' &&
  info.exportProgress > 0 && info.exportProgress < 100), 'streaming should report measured intermediate progress');
delete globalThis.window;
assert.equal(tracks.length, 5);
assert.ok(changes.some((info) => info.phase === 'STOPPING'));
recorder.dispose();

let clockNow = 1_000_000;
let nextTimer = 0;
const timers = new Map();
const clock = {
  now: () => clockNow,
  setTimeout(callback, delay) {
    const id = ++nextTimer;
    timers.set(id, { callback, at: clockNow + delay });
    return id;
  },
  clearTimeout(id) { timers.delete(id); },
  advance(milliseconds) {
    clockNow += milliseconds;
    while (true) {
      const due = [...timers].find(([, timer]) => timer.at <= clockNow);
      if (!due) break;
      timers.delete(due[0]);
      due[1].callback();
    }
  },
};
let pickerOpened = false;
globalThis.window = { showSaveFilePicker() { pickerOpened = true; throw new Error('Picker must not open automatically'); } };
let schedule;
const scheduledRecorder = new CanvasRecorder(canvas, (info) => schedule?.onRecorderChange(info));
schedule = new RecordingSchedule(scheduledRecorder, () => {}, clock);
const downloadsBeforeSchedule = downloads.length;
const firstStart = clock.now() + 1_000;
const secondStart = firstStart + 62_000;
assert.equal(schedule.add(firstStart, 1), true);
assert.equal(schedule.add(firstStart + 60_000, 1), false, 'a second video cannot start exactly when the first ends');
assert.match(schedule.info.error, /sau khi video/);
assert.equal(schedule.add(firstStart + 30_000, 1), false, 'overlapping schedules must be rejected');
assert.equal(schedule.add(secondStart, 1), true);
assert.equal(schedule.info.entries.length, 2, 'invalid attempts do not remove existing schedules');
const thirdStart = secondStart + 61_000;
assert.equal(schedule.add(thirdStart, 1), true);
schedule.cancel(schedule.info.entries[2].id);
assert.equal(schedule.info.entries[2].phase, 'CANCELED');

clock.advance(999);
assert.equal(scheduledRecorder.info.phase, 'IDLE');
clock.advance(1);
assert.equal(scheduledRecorder.info.phase, 'RECORDING');
assert.equal(schedule.info.entries[0].phase, 'RECORDING');
assert.equal(schedule.info.entries[1].phase, 'WAITING');
clock.advance(59_999);
assert.equal(scheduledRecorder.info.phase, 'RECORDING');
clock.advance(1);
assert.equal(schedule.info.entries[0].phase, 'SAVING');
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(schedule.info.entries[0].phase, 'DONE');
assert.equal(scheduledRecorder.info.phase, 'READY');
assert.equal(downloads.length, downloadsBeforeSchedule + 1);
assert.ok(downloads.at(-1).filename.endsWith('.mp4'));
assert.equal(pickerOpened, false);
assert.equal(scheduledRecorder.info.exportProgress, 100);

clock.advance(1_999);
assert.equal(schedule.info.entries[1].phase, 'WAITING');
clock.advance(1);
assert.equal(schedule.info.entries[1].phase, 'RECORDING');
clock.advance(60_000);
assert.equal(schedule.info.entries[1].phase, 'SAVING');
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(schedule.info.entries[1].phase, 'DONE');
assert.equal(downloads.length, downloadsBeforeSchedule + 2, 'each schedule downloads its own video');
assert.equal(schedule.info.entries[0].videoReady, true);
assert.equal(schedule.downloadSaved(schedule.info.entries[0].id), true, 'the first video remains available after the second');
assert.equal(downloads.length, downloadsBeforeSchedule + 3);
const firstSavedUrl = downloads.at(-1).href;
assert.equal(revoked.includes(firstSavedUrl), false);
clock.advance(2_000);
assert.equal(schedule.info.entries[2].phase, 'CANCELED');
const delayedFirstStart = clock.now() + 1_000;
const delayedSecondStart = delayedFirstStart + 61_000;
assert.equal(schedule.add(delayedFirstStart, 1), true);
assert.equal(schedule.add(delayedSecondStart, 1), true);
clock.advance(90_000);
assert.equal(schedule.info.entries[3].phase, 'RECORDING', 'a late timer starts the first delayed video');
assert.equal(schedule.info.entries[4].phase, 'WAITING', 'the next video cannot start while the first is recording');
clock.advance(60_000);
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(schedule.info.entries[3].phase, 'DONE');
assert.equal(schedule.info.entries[4].phase, 'WAITING');
clock.advance(1_000);
assert.equal(schedule.info.entries[4].phase, 'RECORDING', 'the next video starts after the prior download');
clock.advance(60_000);
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(schedule.info.entries[4].phase, 'DONE');
assert.equal(schedule.add(clock.now() - 1, 1), false);
assert.match(schedule.info.error, /tương lai/);
schedule.dispose();
assert.equal(revoked.includes(firstSavedUrl), true, 'archived video URLs are released on cleanup');
scheduledRecorder.dispose();
delete globalThis.window;
URL.createObjectURL = originalCreate;
URL.revokeObjectURL = originalRevoke;
console.log('Recorder: formats, downloads, measured export progress and multiple scheduled recordings passed.');
