import { useEffect, useRef, useState } from 'react';
import { CONFIG } from './game/config.ts';
import { Game } from './game/game.ts';
import { render } from './game/renderer.ts';
import { CanvasRecorder, type RecorderInfo } from './recorder/CanvasRecorder.ts';
import { RecordingSchedule, type ScheduleInfo } from './recorder/RecordingSchedule.ts';
import './style.css';

const initialRecorder: RecorderInfo = { phase: 'IDLE', mime: '', seconds: 0, bytes: 0, error: '', exportProgress: null, exportMessage: '' };
const initialSchedule: ScheduleInfo = { entries: [], error: '' };

function formatTime(seconds: number): string {
  const value = Math.floor(seconds);
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

function dateTimeLocalValue(date: Date): string {
  const part = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${part(date.getMonth() + 1)}-${part(date.getDate())}T${part(date.getHours())}:${part(date.getMinutes())}`;
}

function defaultStartTime(): string {
  const date = new Date(Date.now() + 5 * 60_000);
  date.setSeconds(0, 0);
  return dateTimeLocalValue(date);
}

function formatDateTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString('vi-VN', {
    hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric',
  });
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const recorderRef = useRef<CanvasRecorder | null>(null);
  const scheduleRef = useRef<RecordingSchedule | null>(null);
  const startBackgroundClockRef = useRef<(() => void) | null>(null);
  const [recording, setRecording] = useState<RecorderInfo>(initialRecorder);
  const [schedule, setSchedule] = useState<ScheduleInfo>(initialSchedule);
  const [scheduleStart, setScheduleStart] = useState(defaultStartTime);
  const [scheduleDuration, setScheduleDuration] = useState('10');
  const [gameNumber, setGameNumber] = useState(1);
  const [canRecord, setCanRecord] = useState(true);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d', { alpha: false });
    if (!canvas || !ctx) return;
    const game = new Game(CONFIG.seed, (record) => {
      console.info('game over', record);
      setGameNumber(record.gameIndex);
    });
    if (import.meta.env.DEV) (window as Window & { __game?: Game }).__game = game;
    let scheduler: RecordingSchedule | null = null;
    const recorder = new CanvasRecorder(canvas, (info) => {
      setRecording(info);
      scheduler?.onRecorderChange(info);
    });
    scheduler = new RecordingSchedule(recorder, setSchedule);
    recorderRef.current = recorder;
    scheduleRef.current = scheduler;
    if (!CanvasRecorder.isAvailable(canvas)) {
      setCanRecord(false);
      setRecording({ ...initialRecorder, error: 'Trình duyệt thiếu MediaRecorder hoặc canvas.captureStream. Hãy mở bằng Chrome hoặc Safari mới.' });
    }
    let frame = 0;
    let backgroundTimer = 0;
    let previous = performance.now();
    let accumulator = 0;
    let elapsed = 0;
    let lastRender = 0;
    let shownGameIndex = game.gameIndex;
    let windowFocused = document.hasFocus();
    let audioContext: AudioContext | null = null;
    let audioNode: AudioWorkletNode | null = null;
    let audioModuleUrl: string | null = null;
    const clockStats = { pulses: 0, ticks: 0, renders: 0, audioState: '' };
    if (import.meta.env.DEV) (window as Window & { __clockStats?: typeof clockStats }).__clockStats = clockStats;

    const tick = (now: number) => {
      clockStats.ticks++;
      const isBackground = document.visibilityState === 'hidden' || !windowFocused;
      // Browsers pause requestAnimationFrame for hidden windows. Keep the game
      // clock and canvas moving with a timer while the window is in the back.
      const delta = Math.min(Math.max((now - previous) / 1000, 0), isBackground ? 1 : 0.12);
      previous = now;
      accumulator += delta;
      elapsed += delta;
      while (accumulator >= CONFIG.fixedStep) {
        game.update(CONFIG.fixedStep);
        accumulator -= CONFIG.fixedStep;
      }
      if (game.gameIndex !== shownGameIndex) {
        shownGameIndex = game.gameIndex;
        setGameNumber(shownGameIndex);
      }
      if (now - lastRender >= 1000 / 60 - 1) {
        render(ctx, game, elapsed, accumulator / CONFIG.fixedStep);
        clockStats.renders++;
        lastRender = now;
      }
      recorder.tick();
      scheduler?.tick();
    };
    const foregroundLoop = (now: number) => {
      tick(now);
      frame = requestAnimationFrame(foregroundLoop);
    };
    const syncClock = () => {
      cancelAnimationFrame(frame);
      window.clearInterval(backgroundTimer);
      if (document.visibilityState === 'hidden' || !windowFocused) {
        backgroundTimer = window.setInterval(() => tick(performance.now()), 1000 / 60);
      } else {
        frame = requestAnimationFrame(foregroundLoop);
      }
    };
    const onBlur = () => { windowFocused = false; syncClock(); };
    const onFocus = () => { windowFocused = true; syncClock(); };
    // An active audio render thread can keep sending pulses after Chromium
    // slows ordinary timers for a hidden tab. It produces silent samples and
    // is unlocked by the user's recording click.
    startBackgroundClockRef.current = () => {
      if (audioContext || !window.AudioContext || !window.AudioWorkletNode) return;
      try {
        const context = new AudioContext();
        audioContext = context;
        void context.resume();
        const source = `class GameClock extends AudioWorkletProcessor {
          constructor() { super(); this.samples = 0; }
          process(inputs, outputs) {
            this.samples += outputs[0][0].length;
            if (this.samples >= sampleRate / 60) {
              this.samples -= sampleRate / 60;
              this.port.postMessage(0);
            }
            return true;
          }
        }
        registerProcessor('game-background-clock', GameClock);`;
        audioModuleUrl = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
        void context.audioWorklet.addModule(audioModuleUrl).then(() => {
          if (context.state === 'closed') return;
          const node = new AudioWorkletNode(context, 'game-background-clock');
          node.port.onmessage = () => {
            clockStats.pulses++;
            if (document.visibilityState === 'hidden' || !windowFocused) tick(performance.now());
          };
          node.connect(context.destination);
          audioNode = node;
          clockStats.audioState = context.state;
        }).catch(() => {
          clockStats.audioState = 'failed';
          // The interval clock still handles browsers without an audio worklet.
        });
      } catch {
        // The interval clock remains available if Web Audio cannot start.
      }
    };
    render(ctx, game, 0);
    document.addEventListener('visibilitychange', syncClock);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    syncClock();
    return () => {
      cancelAnimationFrame(frame);
      window.clearInterval(backgroundTimer);
      document.removeEventListener('visibilitychange', syncClock);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
      startBackgroundClockRef.current = null;
      scheduler?.dispose();
      scheduleRef.current = null;
      audioNode?.disconnect();
      void audioContext?.close();
      if (audioModuleUrl) URL.revokeObjectURL(audioModuleUrl);
      recorder.dispose();
      recorderRef.current = null;
      if (import.meta.env.DEV) delete (window as Window & { __game?: Game }).__game;
      if (import.meta.env.DEV) delete (window as Window & { __clockStats?: typeof clockStats }).__clockStats;
    };
  }, []);

  const phaseText = recording.phase === 'RECORDING' ? 'Đang quay' :
    recording.phase === 'STOPPING' ? 'Đang hoàn tất' :
    recording.phase === 'EXPORTING' ? 'Đang xuất video' :
    recording.phase === 'READY' ? 'Sẵn sàng xuất' : 'Chưa quay';

  const scheduledRecording = schedule.entries.some((entry) =>
    entry.phase === 'RECORDING' || entry.phase === 'SAVING');
  const hasPendingSchedule = schedule.entries.some((entry) => entry.phase === 'WAITING');
  const canAddSchedule = canRecord && (scheduledRecording ||
    (recording.phase !== 'RECORDING' && recording.phase !== 'STOPPING' && recording.phase !== 'EXPORTING'));

  const setRecordingSchedule = () => {
    const startAt = new Date(scheduleStart).getTime();
    const durationMinutes = Number(scheduleDuration);
    if (scheduleRef.current?.add(startAt, durationMinutes)) {
      startBackgroundClockRef.current?.();
      const nextStart = new Date(startAt + durationMinutes * 60_000 + 60_000);
      nextStart.setSeconds(0, 0);
      setScheduleStart(dateTimeLocalValue(nextStart));
    }
  };

  return (
    <main className="app-shell">
      <section className="game-panel" aria-label="Màn hình A, nội dung được quay">
        <canvas ref={canvasRef} width={CONFIG.width} height={CONFIG.height} aria-label="Game phá gạch" />
      </section>
      <aside className="control-panel">
        <div className="eyebrow"><span className="live-dot" /> GAME ĐANG CHẠY</div>
        <h1>Gạch lên số,<br /><em>bóng nảy liên hồi.</em></h1>
        <p className="intro">Cuối ván có thêm gạch giáp. Bóng thứ hai mở ở 50 điểm; mỗi mốc bóng tiếp theo gấp 1,5 lần. Máy tự ngắm và tự bắt đầu ván mới. Chỉ màn hình game dọc bên cạnh được ghi vào video.</p>

        <div className="stat-row">
          <div><span>KHUNG HÌNH</span><strong>9:16</strong><small>720 × 1280 px</small></div>
          <div><span>VÁN HIỆN TẠI</span><strong>{String(gameNumber).padStart(2, '0')}</strong><small>Tiếp diễn tự động</small></div>
        </div>

        <section className="record-card" aria-label="Điều khiển quay video">
          <div className="record-heading"><div><span className="section-kicker">VIDEO RECORDER</span><h2>Quay màn hình A</h2></div><span className={`record-light ${recording.phase === 'RECORDING' ? 'active' : ''}`} /></div>
          <div className="record-status"><span>{phaseText}</span><strong>{formatTime(recording.seconds)}</strong></div>
          <div className="button-stack">
            <button className="primary" onClick={() => { startBackgroundClockRef.current?.(); recorderRef.current?.start(); }} disabled={!canRecord || hasPendingSchedule || recording.phase === 'RECORDING' || recording.phase === 'STOPPING' || recording.phase === 'EXPORTING'}>Bắt đầu quay</button>
            <div className="button-row">
              <button onClick={() => recorderRef.current?.stop()} disabled={recording.phase !== 'RECORDING'}>Dừng quay</button>
              <button onClick={() => { void recorderRef.current?.download(); }} disabled={recording.phase !== 'READY'}>Xuất video</button>
            </div>
          </div>
          <div className="schedule-panel">
            <h3>Đặt lịch quay video</h3>
            <div className="schedule-fields">
              <label>Ngày và giờ bắt đầu
                <input type="datetime-local" value={scheduleStart} onChange={(event) => setScheduleStart(event.target.value)} />
              </label>
              <label>Thời lượng (phút)
                <input type="number" min="1" step="1" value={scheduleDuration} onChange={(event) => setScheduleDuration(event.target.value)} />
              </label>
            </div>
            <div className="schedule-actions">
              <button type="button" onClick={setRecordingSchedule} disabled={!canAddSchedule}>Thêm lịch quay</button>
            </div>
            <p className={`schedule-message${schedule.error ? ' error' : ''}`} role="status">{schedule.error || 'Mỗi lịch mới phải bắt đầu sau khi lịch trước kết thúc.'}</p>
            {schedule.entries.length > 0 && (
              <ol className="schedule-list" aria-label="Các lịch quay đã đặt">
                {schedule.entries.map((entry) => (
                  <li key={entry.id}>
                    <div className="schedule-item-heading"><strong>Lịch {entry.id}</strong><span>{entry.phase === 'WAITING' ? 'Chờ đến giờ' : entry.phase === 'RECORDING' ? 'Đang quay' : entry.phase === 'SAVING' ? 'Đang hoàn tất' : entry.phase === 'DONE' ? 'Đã gửi tải xuống' : entry.phase === 'CANCELED' ? 'Đã hủy' : 'Lỗi'}</span></div>
                    <p>{formatDateTime(entry.startAt)} · {entry.durationMinutes} phút</p>
                    <small>{entry.error || (entry.phase === 'RECORDING' && entry.actualStartedAt !== null ? `Dự kiến dừng: ${formatDateTime(entry.actualStartedAt + entry.durationMinutes * 60_000)}` : `Kết thúc dự kiến: ${formatDateTime(entry.startAt + entry.durationMinutes * 60_000)}`)}</small>
                    {entry.phase === 'WAITING' && <button type="button" onClick={() => scheduleRef.current?.cancel(entry.id)}>Hủy lịch này</button>}
                    {entry.videoReady && <button type="button" onClick={() => scheduleRef.current?.downloadSaved(entry.id)}>Tải lại video</button>}
                  </li>
                ))}
              </ol>
            )}
          </div>
          {recording.exportProgress !== null && (
            <div className="export-progress" role="status">
              <div className="export-progress-heading"><span>TIẾN ĐỘ XUẤT VIDEO</span><strong>{recording.exportProgress}%</strong></div>
              <progress aria-label="Tiến độ xuất video" max={100} value={recording.exportProgress} />
              <small>{recording.exportMessage}</small>
            </div>
          )}
          <p className="recorder-message" role="status">{recording.error || (recording.phase === 'READY' ? `${recording.mime.startsWith('video/mp4') ? 'MP4' : 'WebM'} · ${(recording.bytes / 1024 / 1024).toFixed(1)} MB · có thể tải lại` : recording.mime ? `${recording.mime} · không ghi âm thanh` : 'Video MP4 hoặc WebM · không ghi âm thanh')}</p>
        </section>

        <div className="guide"><span className="guide-index">01 / 02 / 03</span><p>Quay thủ công hoặc đặt lịch → video liền mạch → xuất video hoặc tự tải khi hết giờ.</p></div>
        <p className="note">Giữ trang mở và máy hoạt động cho đến khi tải xong. Nếu trình duyệt chặn tải tự động, hãy bấm Tải lại video ở lịch tương ứng. Tab bị ẩn lâu hoặc máy ngủ có thể làm lệch giờ và gián đoạn bản quay.</p>
      </aside>
    </main>
  );
}
