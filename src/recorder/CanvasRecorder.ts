export type RecorderPhase = 'IDLE' | 'RECORDING' | 'STOPPING' | 'READY' | 'EXPORTING';

type VideoWritable = {
  write(data: Uint8Array): Promise<void>;
  close(): Promise<void>;
  abort(): Promise<void>;
};
type SaveFilePicker = (options: { suggestedName: string }) => Promise<{
  createWritable(): Promise<VideoWritable>;
}>;

export interface RecorderInfo {
  phase: RecorderPhase;
  mime: string;
  seconds: number;
  bytes: number;
  error: string;
  exportProgress: number | null;
  exportMessage: string;
}

export class CanvasRecorder {
  private recorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private chunks: Blob[] = [];
  private url: string | null = null;
  private blob: Blob | null = null;
  private startedAt = 0;
  private stoppedSeconds = 0;
  private filename = '';
  private filenameBase = '';
  private requestedMime = '';
  private disposed = false;
  private failed = false;
  info: RecorderInfo = { phase: 'IDLE', mime: '', seconds: 0, bytes: 0, error: '', exportProgress: null, exportMessage: '' };

  constructor(private readonly canvas: HTMLCanvasElement, private readonly onChange: (info: RecorderInfo) => void) {}

  private publish(): void {
    this.info = { ...this.info };
    this.onChange(this.info);
  }

  static isAvailable(canvas: HTMLCanvasElement): boolean {
    return typeof MediaRecorder !== 'undefined' && typeof canvas.captureStream === 'function';
  }

  private static formatsToTry(): string[] {
    const candidates = [
      // H.264 is commonly hardware encoded in Chrome and avoids the large
      // frame gaps seen with software VP9 at this canvas resolution.
      'video/mp4;codecs=avc1.42E01E',
      'video/mp4',
      'video/webm;codecs=vp8',
      'video/webm',
      'video/webm;codecs=vp9',
    ];
    const supported = typeof MediaRecorder.isTypeSupported === 'function'
      ? candidates.filter((mime) => MediaRecorder.isTypeSupported(mime)) : [];
    // Let the browser choose as a final fallback. Its actual output MIME is
    // inspected before assigning a file extension.
    return [...supported, ''];
  }

  start(): boolean {
    if (this.info.phase === 'RECORDING' || this.info.phase === 'STOPPING' || this.info.phase === 'EXPORTING') return false;
    if (!CanvasRecorder.isAvailable(this.canvas)) {
      this.info.error = 'Trình duyệt thiếu MediaRecorder hoặc canvas.captureStream. Hãy mở bằng Chrome hoặc Safari mới.';
      this.publish();
      return false;
    }
    this.cleanupRecording();
    if (this.url) { URL.revokeObjectURL(this.url); this.url = null; }
    this.blob = null;
    this.chunks = [];
    this.failed = false;
    try {
      this.stream = this.canvas.captureStream(60);
      this.recorder = null;
      for (const mime of CanvasRecorder.formatsToTry()) {
        try {
          const candidate = mime
            ? new MediaRecorder(this.stream, { mimeType: mime })
            : new MediaRecorder(this.stream);
          candidate.start(1000);
          this.recorder = candidate;
          this.requestedMime = mime;
          break;
        } catch {
          // A browser may claim support but reject this particular stream.
        }
      }
      if (!this.recorder) throw new Error('No working recording format');
      this.recorder.ondataavailable = (event) => {
        if (event.data.size > 0) this.chunks.push(event.data);
      };
      this.recorder.onerror = () => {
        if (this.disposed) return;
        this.failed = true;
        this.info.error = 'Ghi video thất bại. Hãy kiểm tra bộ nhớ trống và thử lại.';
        this.info.phase = 'IDLE';
        this.cleanupRecording();
        this.publish();
      };
      this.recorder.onstop = () => {
        if (this.disposed) return;
        if (this.failed) return;
        const mime = this.chunks.find((chunk) => chunk.type)?.type || this.recorder?.mimeType || this.requestedMime;
        const baseMime = mime.toLowerCase().split(';')[0].trim();
        const extension = baseMime === 'video/mp4' ? 'mp4' : baseMime === 'video/webm' ? 'webm' : null;
        const blob = new Blob(this.chunks, { type: mime });
        this.cleanupRecording();
        this.chunks = [];
        this.info.bytes = blob.size;
        this.info.seconds = this.stoppedSeconds;
        if (blob.size > 0 && extension) {
          this.blob = blob;
          this.url = URL.createObjectURL(blob);
          this.filename = `${this.filenameBase}.${extension}`;
          this.info.phase = 'READY';
          this.info.mime = mime;
          this.info.error = '';
          this.info.exportProgress = null;
          this.info.exportMessage = '';
        } else {
          this.info.phase = 'IDLE';
          this.info.error = blob.size === 0 ? 'Video rỗng. Hãy quay lâu hơn rồi thử lại.' : 'Trình duyệt không cho biết định dạng video đã quay.';
        }
        this.publish();
      };
      this.startedAt = performance.now();
      this.stoppedSeconds = 0;
      const now = new Date();
      const part = (value: number) => String(value).padStart(2, '0');
      this.filenameBase = `game-pha-gach-${now.getFullYear()}-${part(now.getMonth() + 1)}-${part(now.getDate())}T${part(now.getHours())}-${part(now.getMinutes())}-${part(now.getSeconds())}`;
      this.info = { phase: 'RECORDING', mime: this.recorder.mimeType || this.requestedMime, seconds: 0, bytes: 0, error: '', exportProgress: null, exportMessage: '' };
      this.publish();
      return true;
    } catch {
      this.cleanupRecording();
      this.info.error = 'Không thể bắt đầu quay với WebM hoặc MP4 trên trình duyệt này.';
      this.info.phase = 'IDLE';
      this.publish();
      return false;
    }
  }

  tick(): void {
    if (this.info.phase === 'RECORDING') {
      const next = Math.floor((performance.now() - this.startedAt) / 1000);
      if (next !== this.info.seconds) { this.info.seconds = next; this.publish(); }
    }
  }

  stop(): void {
    if (this.info.phase !== 'RECORDING' || !this.recorder) return;
    this.stoppedSeconds = (performance.now() - this.startedAt) / 1000;
    this.info.phase = 'STOPPING';
    this.publish();
    try { this.recorder.stop(); }
    catch {
      this.cleanupRecording();
      this.info.phase = 'IDLE';
      this.info.error = 'Không thể hoàn tất bản ghi.';
      this.publish();
    }
  }

  async download(): Promise<void> {
    const blob = this.blob;
    if (this.info.phase !== 'READY' || !this.url || !blob || this.info.bytes === 0) return;
    const picker = typeof window === 'undefined'
      ? undefined : (window as Window & { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker;
    if (!picker) {
      this.downloadAutomatically();
      return;
    }

    this.info.phase = 'EXPORTING';
    this.info.exportProgress = 0;
    this.info.exportMessage = 'Chọn nơi lưu video';
    this.info.error = '';
    this.publish();
    let writable: VideoWritable | null = null;
    try {
      // Open the picker in the original click gesture, before the first await.
      const handlePromise = picker.call(window, { suggestedName: this.filename });
      const handle = await handlePromise;
      writable = await handle.createWritable();
      this.info.exportMessage = 'Đang ghi tệp video';
      this.publish();
      const reader = blob.stream().getReader();
      let written = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        await writable.write(value);
        written += value.byteLength;
        const progress = Math.min(99, Math.floor(written / blob.size * 100));
        if (progress !== this.info.exportProgress) {
          this.info.exportProgress = progress;
          this.publish();
        }
      }
      await writable.close();
      writable = null;
      if (this.disposed) return;
      this.info.phase = 'READY';
      this.info.exportProgress = 100;
      this.info.exportMessage = 'Đã lưu video';
      this.publish();
    } catch (error) {
      if (writable) { try { await writable.abort(); } catch { /* The write already failed. */ } }
      if (this.disposed) return;
      this.info.phase = 'READY';
      this.info.exportProgress = null;
      this.info.exportMessage = '';
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        this.info.error = 'Không thể xuất video. Hãy chọn nơi lưu và thử lại.';
      }
      this.publish();
    }
  }

  downloadAutomatically(): boolean {
    if (this.info.phase !== 'READY' || !this.url || !this.blob || this.info.bytes === 0) return false;
    try {
      const link = document.createElement('a');
      link.href = this.url;
      link.download = this.filename;
      link.click();
      this.info.exportProgress = 100;
      this.info.exportMessage = 'Đã chuyển video cho trình duyệt tải xuống.';
      this.info.error = '';
      this.publish();
      return true;
    } catch {
      this.info.error = 'Trình duyệt không cho tải tự động. Hãy bấm Xuất video để lưu bản quay.';
      this.publish();
      return false;
    }
  }

  getReadyFile(): { blob: Blob; filename: string } | null {
    if (this.info.phase !== 'READY' || !this.blob || !this.filename) return null;
    return { blob: this.blob, filename: this.filename };
  }

  dispose(): void {
    this.disposed = true;
    if (this.recorder?.state === 'recording') this.recorder.stop();
    this.cleanupRecording();
    if (this.url) { URL.revokeObjectURL(this.url); this.url = null; }
    this.blob = null;
  }

  private cleanupRecording(): void {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.recorder = null;
  }
}
