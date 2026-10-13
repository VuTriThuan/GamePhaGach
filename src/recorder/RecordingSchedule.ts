import { CanvasRecorder, type RecorderInfo } from './CanvasRecorder.ts';

export type SchedulePhase = 'WAITING' | 'RECORDING' | 'SAVING' | 'DONE' | 'CANCELED' | 'ERROR';

export interface ScheduleEntry {
  id: number;
  phase: SchedulePhase;
  startAt: number;
  actualStartedAt: number | null;
  durationMinutes: number;
  error: string;
  videoReady: boolean;
}

export interface ScheduleInfo {
  entries: ScheduleEntry[];
  error: string;
}

export interface ScheduleClock {
  now(): number;
  setTimeout(callback: () => void, delay: number): number;
  clearTimeout(id: number): void;
}

const browserClock: ScheduleClock = {
  now: () => Date.now(),
  setTimeout: (callback, delay) => window.setTimeout(callback, delay),
  clearTimeout: (id) => window.clearTimeout(id),
};

const maximumTimerDelay = 2 ** 31 - 1;

export class RecordingSchedule {
  info: ScheduleInfo = { entries: [], error: '' };
  private timer: number | null = null;
  private timerTarget: number | null = null;
  private nextId = 1;
  private nextStartNotBefore = 0;
  private savedFiles = new Map<number, { url: string; filename: string }>();

  constructor(
    private readonly recorder: CanvasRecorder,
    private readonly onChange: (info: ScheduleInfo) => void,
    private readonly clock: ScheduleClock = browserClock,
  ) {}

  add(startAt: number, durationMinutes: number): boolean {
    if (!Number.isFinite(startAt) || startAt <= this.clock.now()) {
      return this.reject('Chọn ngày và giờ bắt đầu trong tương lai.');
    }
    if (!Number.isFinite(durationMinutes) || durationMinutes <= 0 ||
        !Number.isFinite(startAt + durationMinutes * 60_000)) {
      return this.reject('Thời lượng quay phải lớn hơn 0 phút.');
    }
    const last = [...this.info.entries].reverse().find((entry) =>
      entry.phase !== 'CANCELED' && entry.phase !== 'ERROR');
    if (last) {
      const plannedEnd = last.startAt + last.durationMinutes * 60_000;
      const actualEnd = last.actualStartedAt === null ? plannedEnd :
        last.actualStartedAt + last.durationMinutes * 60_000;
      if (startAt <= Math.max(plannedEnd, actualEnd)) {
        return this.reject('Lịch mới phải bắt đầu sau khi video của lịch trước kết thúc.');
      }
    }
    const active = this.activeEntry();
    if (!active && (this.recorder.info.phase === 'RECORDING' ||
        this.recorder.info.phase === 'STOPPING' || this.recorder.info.phase === 'EXPORTING')) {
      return this.reject('Hãy hoàn tất bản quay thủ công trước khi đặt lịch.');
    }
    const entry: ScheduleEntry = {
      id: this.nextId++, phase: 'WAITING', startAt, actualStartedAt: null,
      durationMinutes, error: '', videoReady: false,
    };
    this.publish([...this.info.entries, entry], '');
    this.tick();
    return true;
  }

  cancel(id: number): void {
    const entry = this.info.entries.find((item) => item.id === id);
    if (entry?.phase !== 'WAITING') return;
    this.replaceEntry({ ...entry, phase: 'CANCELED' });
    this.tick();
  }

  downloadSaved(id: number): boolean {
    const file = this.savedFiles.get(id);
    if (!file) return false;
    try {
      const link = document.createElement('a');
      link.href = file.url;
      link.download = file.filename;
      link.click();
      return true;
    } catch {
      return false;
    }
  }

  tick(): void {
    const active = this.activeEntry();
    if (active?.phase === 'RECORDING') {
      const endAt = active.actualStartedAt! + active.durationMinutes * 60_000;
      if (this.clock.now() >= endAt) this.finish();
      else this.arm(endAt);
      return;
    }
    if (active?.phase === 'SAVING') {
      this.clearTimer();
      return;
    }
    const next = this.info.entries.find((entry) => entry.phase === 'WAITING');
    if (!next) {
      this.clearTimer();
      return;
    }
    const startAt = Math.max(next.startAt, this.nextStartNotBefore);
    if (this.clock.now() >= startAt) this.begin(next);
    else this.arm(startAt);
  }

  onRecorderChange(recorderInfo: RecorderInfo): void {
    const active = this.activeEntry();
    if (!active) return;
    if (recorderInfo.phase === 'IDLE') {
      this.failEntry(active, recorderInfo.error || 'Bản quay theo lịch đã dừng trước khi có video.');
    } else if (recorderInfo.phase === 'STOPPING' && active.phase === 'RECORDING') {
      this.replaceEntry({ ...active, phase: 'SAVING' });
      this.clearTimer();
    } else if (recorderInfo.phase === 'READY') {
      this.clearTimer();
      const file = this.recorder.getReadyFile();
      let videoReady = false;
      if (file) {
        try {
          const url = URL.createObjectURL(file.blob);
          this.savedFiles.set(active.id, { url, filename: file.filename });
          videoReady = true;
        } catch {
          // The current recording can still use its normal download URL.
        }
      }
      // Download publishes another recorder update, so mark this entry done first.
      this.replaceEntry({ ...active, phase: 'DONE', videoReady });
      if (!this.recorder.downloadAutomatically()) {
        this.failEntry({ ...active, videoReady }, this.recorder.info.error || 'Không thể tải video tự động.');
      } else {
        this.nextStartNotBefore = this.clock.now() + 1_000;
        this.tick();
      }
    }
  }

  dispose(): void {
    this.clearTimer();
    for (const file of this.savedFiles.values()) URL.revokeObjectURL(file.url);
    this.savedFiles.clear();
  }

  private activeEntry(): ScheduleEntry | undefined {
    return this.info.entries.find((entry) =>
      entry.phase === 'RECORDING' || entry.phase === 'SAVING');
  }

  private begin(entry: ScheduleEntry): void {
    this.clearTimer();
    if (this.recorder.info.phase === 'RECORDING' || this.recorder.info.phase === 'STOPPING' ||
        this.recorder.info.phase === 'EXPORTING') {
      this.failEntry(entry, 'Không thể bắt đầu lịch vì đang có bản quay khác.');
      return;
    }
    const startedAt = this.clock.now();
    this.replaceEntry({ ...entry, phase: 'RECORDING', actualStartedAt: startedAt });
    const started = this.recorder.start();
    if (this.info.entries.find((item) => item.id === entry.id)?.phase !== 'RECORDING') return;
    if (!started) {
      this.failEntry(entry, this.recorder.info.error || 'Không thể bắt đầu quay theo lịch.');
      return;
    }
    this.arm(startedAt + entry.durationMinutes * 60_000);
  }

  private finish(): void {
    this.clearTimer();
    this.recorder.stop();
  }

  private failEntry(entry: ScheduleEntry, error: string): void {
    this.clearTimer();
    this.replaceEntry({ ...entry, phase: 'ERROR', error });
    this.nextStartNotBefore = this.clock.now() + 1_000;
    this.tick();
  }

  private replaceEntry(entry: ScheduleEntry): void {
    this.publish(this.info.entries.map((item) => item.id === entry.id ? entry : item), this.info.error);
  }

  private reject(error: string): false {
    this.publish(this.info.entries, error);
    return false;
  }

  private publish(entries: ScheduleEntry[], error: string): void {
    this.info = { entries, error };
    this.onChange(this.info);
  }

  private arm(target: number): void {
    if (this.timer !== null && this.timerTarget === target) return;
    this.clearTimer();
    const delay = Math.min(Math.max(target - this.clock.now(), 0), maximumTimerDelay);
    this.timerTarget = target;
    this.timer = this.clock.setTimeout(() => {
      this.timer = null;
      this.timerTarget = null;
      this.tick();
    }, delay);
  }

  private clearTimer(): void {
    if (this.timer !== null) this.clock.clearTimeout(this.timer);
    this.timer = null;
    this.timerTarget = null;
  }
}
