import { EventEmitter } from "node:events";

export interface EncoderUnitState {
  id: number;
  name: string;
  configured: boolean;
  connected: boolean;
  encoder1: { mode: string; state: string };
  encoder2: { mode: string; state: string };
  error?: string | undefined;
}

export type EncoderEvent =
  | { type: "encoder"; data: EncoderUnitState }
  | { type: "ready"; data: { status: string; time: string } };

export class EncoderEventBroker {
  private readonly emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(100);
  }

  emit(event: EncoderEvent): void {
    this.emitter.emit("event", event);
  }

  subscribe(listener: (event: EncoderEvent) => void): () => void {
    this.emitter.on("event", listener);
    return () => {
      this.emitter.off("event", listener);
    };
  }

  listenerCount(): number {
    return this.emitter.listenerCount("event");
  }
}
