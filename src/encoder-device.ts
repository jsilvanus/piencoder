import {
  MonarchBusyError,
  MonarchCommandError,
  MonarchConnectionError,
  MonarchHDX,
  type HDXStatus,
  type InputStatus
} from "@jsilvanus/matrox-monarch-control";

export type EncoderTarget = 1 | 2 | "both";

export interface MonarchDevice {
  getStatus(): Promise<HDXStatus>;
  startEncoder(encoder: 1 | 2): Promise<unknown>;
  stopEncoder(encoder: 1 | 2): Promise<unknown>;
  startBothEncoders(): Promise<unknown>;
  stopBothEncoders(): Promise<unknown>;
  getInputStatus(): Promise<InputStatus>;
  getVideoInput(): Promise<string>;
  setVideoInput(input: "SDI" | "HDMI"): Promise<unknown>;
  getAudioInput(): Promise<string>;
  setAudioInput(input: "ANALOG" | "DIGITAL"): Promise<unknown>;
  getStreamingVideoDataRate(): Promise<number>;
  setStreamingVideoDataRate(kbps: number): Promise<unknown>;
  getRecordFileName(): Promise<string>;
  setRecordFileName(name: string): Promise<unknown>;
  getEncoderRTMP(encoder: 1 | 2): Promise<{ url: string; streamName: string; username?: string | undefined }>;
  setEncoderRTMP(encoder: 1 | 2, config: { url: string; streamName: string }): Promise<unknown>;
}

export interface EncoderUnitState {
  id: number;
  name: string;
  configured: boolean;
  connected: boolean;
  encoder1: { mode: string; state: string };
  encoder2: { mode: string; state: string };
  error?: string | undefined;
}

export interface EncoderSettings {
  videoInput: string;
  audioInput: string;
  bitrateKbps: number;
  recordFileName: string;
  rtmp: Record<"encoder1" | "encoder2", { url: string; username?: string | undefined }>;
}

export class EncoderError extends Error {
  constructor(
    readonly code: "ENCODER_NOT_CONFIGURED" | "ENCODER_UNREACHABLE" | "ENCODER_BUSY" | "ENCODER_REFUSED",
    message: string
  ) {
    super(message);
    this.name = "EncoderError";
  }
}

export interface EncoderDeviceOptions {
  id: number;
  name: string;
  host?: string | undefined;
  username?: string | undefined;
  password?: string | undefined;
  https?: boolean | undefined;
  pollMs?: number | undefined;
  busyRetries?: number | undefined;
  busyDelayMs?: number | undefined;
  device?: MonarchDevice | undefined;
  onChange?: ((state: EncoderUnitState) => void) | undefined;
  logger?: { warn: (obj: unknown, msg?: string) => void } | undefined;
}

const EMPTY_CHANNEL = { mode: "NONE", state: "DISABLED" };

export class EncoderDevice {
  readonly id: number;
  readonly name: string;
  private readonly device: MonarchDevice | null;
  private readonly options: EncoderDeviceOptions;
  private queue: Promise<unknown> = Promise.resolve();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private state: EncoderUnitState;

  constructor(options: EncoderDeviceOptions) {
    this.id = options.id;
    this.name = options.name;
    this.options = options;
    this.device =
      options.device ??
      (options.host
        ? new MonarchHDX({
            host: options.host,
            ...(options.username && { username: options.username }),
            ...(options.password && { password: options.password }),
            protocol: options.https ? "https" : "http"
          })
        : null);

    this.state = {
      id: this.id,
      name: this.name,
      configured: Boolean(this.device),
      connected: false,
      encoder1: { ...EMPTY_CHANNEL },
      encoder2: { ...EMPTY_CHANNEL }
    };
  }

  startPolling(): void {
    if (this.running || !this.device) return;
    this.running = true;
    void this.pollLoop();
  }

  stopPolling(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  getState(): EncoderUnitState {
    return { ...this.state };
  }

  private enqueue<T>(op: (dev: MonarchDevice) => Promise<T>): Promise<T> {
    if (!this.device) {
      return Promise.reject(new EncoderError("ENCODER_NOT_CONFIGURED", `Encoder ${this.id} host is not configured`));
    }
    const dev = this.device;
    const task = () => this.withBusyRetry(() => op(dev));
    const next = this.queue.then(task, task);
    this.queue = next.catch(() => {});
    return next;
  }

  private async withBusyRetry<T>(fn: () => Promise<T>): Promise<T> {
    const retries = this.options.busyRetries ?? 3;
    const delay = this.options.busyDelayMs ?? 200;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        if (err instanceof MonarchBusyError && attempt < retries) {
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        if (err instanceof MonarchBusyError) {
          throw new EncoderError("ENCODER_BUSY", `Encoder ${this.id} is busy`);
        }
        if (err instanceof MonarchConnectionError) {
          throw new EncoderError("ENCODER_UNREACHABLE", `Encoder ${this.id} connection failed: ${err.message}`);
        }
        if (err instanceof MonarchCommandError) {
          throw new EncoderError("ENCODER_REFUSED", `Encoder ${this.id} refused command: ${err.message}`);
        }
        throw err;
      }
    }
    throw new EncoderError("ENCODER_BUSY", `Encoder ${this.id} is busy`);
  }

  private async pollLoop(): Promise<void> {
    const period = this.options.pollMs ?? 2500;
    while (this.running) {
      try {
        await this.pollOnce();
      } catch {
        // withBusyRetry already updates state
      }
      if (!this.running) break;
      await new Promise<void>((resolve) => {
        this.timer = setTimeout(() => {
          this.timer = null;
          resolve();
        }, period);
      });
    }
  }

  private async pollOnce(): Promise<void> {
    try {
      const status = await this.enqueue((d) => d.getStatus());
      this.updateState({
        connected: true,
        encoder1: status.encoder1,
        encoder2: status.encoder2,
        error: undefined
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.updateState({
        connected: false,
        error: msg
      });
    }
  }

  private updateState(patch: Partial<EncoderUnitState>): void {
    const next = { ...this.state, ...patch, id: this.id, name: this.name };
    const changed =
      next.connected !== this.state.connected ||
      next.encoder1?.state !== this.state.encoder1?.state ||
      next.encoder1?.mode !== this.state.encoder1?.mode ||
      next.encoder2?.state !== this.state.encoder2?.state ||
      next.encoder2?.mode !== this.state.encoder2?.mode ||
      next.error !== this.state.error;

    this.state = next;
    if (changed) {
      this.options.onChange?.(this.getState());
    }
  }

  async startEncoder(target: EncoderTarget): Promise<EncoderUnitState> {
    await this.enqueue(async (d) => {
      if (target === "both") await d.startBothEncoders();
      else await d.startEncoder(target);
    });
    await this.pollOnce();
    return this.getState();
  }

  async stopEncoder(target: EncoderTarget): Promise<EncoderUnitState> {
    await this.enqueue(async (d) => {
      if (target === "both") await d.stopBothEncoders();
      else await d.stopEncoder(target);
    });
    await this.pollOnce();
    return this.getState();
  }

  async getInputStatus(): Promise<InputStatus> {
    return this.enqueue((d) => d.getInputStatus());
  }

  async getSettings(): Promise<EncoderSettings> {
    return this.enqueue(async (d) => {
      const [videoInput, audioInput, bitrateKbps, recordFileName, rtmp1, rtmp2] = await Promise.all([
        d.getVideoInput(),
        d.getAudioInput(),
        d.getStreamingVideoDataRate(),
        d.getRecordFileName(),
        d.getEncoderRTMP(1),
        d.getEncoderRTMP(2)
      ]);
      return {
        videoInput,
        audioInput,
        bitrateKbps,
        recordFileName,
        rtmp: {
          encoder1: { url: rtmp1.url, username: rtmp1.username },
          encoder2: { url: rtmp2.url, username: rtmp2.username }
        }
      };
    });
  }

  async setSettings(patch: {
    videoInput?: "SDI" | "HDMI";
    audioInput?: "ANALOG" | "DIGITAL";
    bitrateKbps?: number;
    recordFileName?: string;
  }): Promise<EncoderSettings> {
    await this.enqueue(async (d) => {
      if (patch.videoInput) await d.setVideoInput(patch.videoInput);
      if (patch.audioInput) await d.setAudioInput(patch.audioInput);
      if (patch.bitrateKbps !== undefined) await d.setStreamingVideoDataRate(patch.bitrateKbps);
      if (patch.recordFileName) await d.setRecordFileName(patch.recordFileName);
    });
    return this.getSettings();
  }

  async setRtmp(encoder: 1 | 2, config: { url: string; streamName: string }): Promise<void> {
    await this.enqueue((d) => d.setEncoderRTMP(encoder, config));
  }
}
