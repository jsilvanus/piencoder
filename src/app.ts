import Fastify, { type FastifyInstance } from "fastify";
import type { AppConfig } from "./config.js";
import { EncoderEventBroker } from "./events.js";
import { MultiEncoderService, type MultiEncoderServiceOptions } from "./encoder-service.js";
import { registerEncoderRoutes } from "./encoder-routes.js";
import type { MonarchDevice } from "./encoder-device.js";

export interface BuildAppOptions {
  config: AppConfig;
  devices?: Map<number, MonarchDevice>;
  busyDelayMs?: number;
  pollMs?: number;
}

export interface BuildAppResult {
  app: FastifyInstance;
  encoderService: MultiEncoderService;
  eventBroker: EncoderEventBroker;
}

export function buildApp(options: BuildAppOptions): BuildAppResult {
  const app = Fastify({
    logger: {
      level: process.env["NODE_ENV"] === "test" ? "silent" : "info"
    }
  });

  const eventBroker = new EncoderEventBroker();

  const encoderService = new MultiEncoderService({
    config: options.config,
    eventBroker,
    devices: options.devices,
    busyDelayMs: options.busyDelayMs,
    pollMs: options.pollMs
  });

  registerEncoderRoutes(app, encoderService, eventBroker);

  return { app, encoderService, eventBroker };
}
