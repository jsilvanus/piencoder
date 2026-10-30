import {
  EncoderDevice,
  EncoderError,
  type EncoderDeviceOptions,
  type EncoderSettings,
  type EncoderTarget,
  type EncoderUnitState,
  type MonarchDevice
} from "./encoder-device.js";
import type { EncoderEventBroker } from "./events.js";
import type { AppConfig } from "./config.js";
import type { InputStatus } from "@jsilvanus/matrox-monarch-control";

export interface MultiEncoderServiceOptions {
  config: AppConfig;
  eventBroker?: EncoderEventBroker | undefined;
  devices?: Map<number, MonarchDevice> | undefined;
  busyDelayMs?: number | undefined;
  pollMs?: number | undefined;
}

export class MultiEncoderService {
  private readonly encoders = new Map<number, EncoderDevice>();
  private readonly eventBroker?: EncoderEventBroker | undefined;

  constructor(options: MultiEncoderServiceOptions) {
    this.eventBroker = options.eventBroker;

    for (const conf of options.config.encoders) {
      const customDevice = options.devices?.get(conf.id);
      const dev = new EncoderDevice({
        id: conf.id,
        name: conf.name,
        host: conf.host,
        username: conf.username,
        password: conf.password,
        https: conf.https,
        busyDelayMs: options.busyDelayMs,
        pollMs: options.pollMs,
        device: customDevice,
        onChange: (state) => {
          this.eventBroker?.emit({ type: "encoder", data: state });
        }
      });
      this.encoders.set(conf.id, dev);
      dev.startPolling();
    }
  }

  list(): EncoderUnitState[] {
    return [...this.encoders.values()].map((d) => d.getState());
  }

  get(id: number): EncoderUnitState | undefined {
    return this.encoders.get(id)?.getState();
  }

  private getDevice(id: number): EncoderDevice {
    const dev = this.encoders.get(id);
    if (!dev) {
      throw new EncoderError("ENCODER_NOT_CONFIGURED", `Encoder unit ${id} not found`);
    }
    return dev;
  }

  async startEncoder(id: number, target: EncoderTarget): Promise<EncoderUnitState> {
    return this.getDevice(id).startEncoder(target);
  }

  async stopEncoder(id: number, target: EncoderTarget): Promise<EncoderUnitState> {
    return this.getDevice(id).stopEncoder(target);
  }

  async getInputStatus(id: number): Promise<InputStatus> {
    return this.getDevice(id).getInputStatus();
  }

  async getSettings(id: number): Promise<EncoderSettings> {
    return this.getDevice(id).getSettings();
  }

  async setSettings(
    id: number,
    patch: {
      videoInput?: "SDI" | "HDMI";
      audioInput?: "ANALOG" | "DIGITAL";
      bitrateKbps?: number;
      recordFileName?: string;
    }
  ): Promise<EncoderSettings> {
    return this.getDevice(id).setSettings(patch);
  }

  async setRtmp(id: number, channel: 1 | 2, config: { url: string; streamName: string }): Promise<void> {
    return this.getDevice(id).setRtmp(channel, config);
  }

  close(): void {
    for (const dev of this.encoders.values()) {
      dev.stopPolling();
    }
  }
}
