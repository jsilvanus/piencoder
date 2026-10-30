import type { FastifyInstance, FastifyReply } from "fastify";
import { EncoderError, type EncoderTarget } from "./encoder-device.js";
import type { MultiEncoderService } from "./encoder-service.js";
import type { EncoderEventBroker } from "./events.js";

const STATUS: Record<EncoderError["code"], number> = {
  ENCODER_NOT_CONFIGURED: 503,
  ENCODER_UNREACHABLE: 502,
  ENCODER_BUSY: 503,
  ENCODER_REFUSED: 409
};

function fail(reply: FastifyReply, error: unknown): FastifyReply {
  if (error instanceof EncoderError) {
    return reply.code(STATUS[error.code] ?? 500).send({ error: { code: error.code, message: error.message } });
  }
  throw error;
}

function invalid(reply: FastifyReply, message: string): FastifyReply {
  return reply.code(422).send({ error: { code: "INVALID_INPUT", message } });
}

function parseTarget(value: unknown): EncoderTarget | null {
  if (value === undefined || value === "both") return "both";
  const n = Number(value);
  return n === 1 || n === 2 ? n : null;
}

export function registerEncoderRoutes(
  app: FastifyInstance,
  encoderService: MultiEncoderService,
  eventBroker?: EncoderEventBroker
): void {
  // Health
  app.get("/health", async () => ({ status: "ok", service: "piencoder" }));
  app.get("/api/v1/health", async () => ({ status: "ok", service: "piencoder" }));

  // SSE Events
  if (eventBroker) {
    const sseHandler = (request: any, reply: any) => {
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive"
      });
      const send = (data: unknown) => {
        reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
      };
      send({ type: "ready", data: { status: "connected", time: new Date().toISOString() } });
      const unsubscribe = eventBroker.subscribe((event) => send(event));
      request.raw.on("close", () => unsubscribe());
    };

    app.get("/events", sseHandler);
    app.get("/api/v1/events", sseHandler);
  }

  // 1. List all encoders
  const listHandler = async () => {
    const items = encoderService.list();
    const primary = items.find((i) => i.id === 1) ?? items[0];
    return {
      ...(primary ?? {}),
      items
    };
  };

  app.get("/api/v1/encoders", listHandler);
  app.get("/api/v1/encoder", listHandler);

  // 2. Backward-compatible un-numbered actions defaulting to encoder #1
  for (const action of ["start", "stop"] as const) {
    app.post<{ Body: { encoder?: unknown; channel?: unknown } | undefined }>(
      `/api/v1/encoder/${action}`,
      async (request, reply) => {
        const target = parseTarget(request.body?.channel ?? request.body?.encoder);
        if (target === null) return invalid(reply, 'encoder channel must be 1, 2 or "both"');
        try {
          return await (action === "start"
            ? encoderService.startEncoder(1, target)
            : encoderService.stopEncoder(1, target));
        } catch (error) {
          return fail(reply, error);
        }
      }
    );
  }

  app.get("/api/v1/encoder/input", async (_request, reply) => {
    try {
      return await encoderService.getInputStatus(1);
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.get("/api/v1/encoder/settings", async (_request, reply) => {
    try {
      return await encoderService.getSettings(1);
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.put<{ Body: Record<string, unknown> | undefined }>("/api/v1/encoder/settings", async (request, reply) => {
    return handleSettingsPut(1, request, reply);
  });

  // 3. Numbered encoder routes: /api/v1/encoder/:number/*
  app.get<{ Params: { number: string } }>("/api/v1/encoder/:number", async (request, reply) => {
    const id = Number(request.params.number);
    if (!Number.isInteger(id) || id < 1) {
      return reply.code(404).send({ error: { code: "ENCODER_NOT_FOUND", message: `Invalid encoder: ${request.params.number}` } });
    }
    const enc = encoderService.get(id);
    if (!enc) {
      return reply.code(404).send({ error: { code: "ENCODER_NOT_FOUND", message: `Encoder ${id} not found` } });
    }
    return enc;
  });

  for (const action of ["start", "stop"] as const) {
    app.post<{ Params: { number: string }; Body: { encoder?: unknown; channel?: unknown } | undefined }>(
      `/api/v1/encoder/:number/${action}`,
      async (request, reply) => {
        const id = Number(request.params.number);
        if (!Number.isInteger(id) || id < 1) {
          return reply.code(404).send({ error: { code: "ENCODER_NOT_FOUND", message: `Invalid encoder: ${request.params.number}` } });
        }
        const target = parseTarget(request.body?.channel ?? request.body?.encoder);
        if (target === null) return invalid(reply, 'channel must be 1, 2 or "both"');
        try {
          return await (action === "start"
            ? encoderService.startEncoder(id, target)
            : encoderService.stopEncoder(id, target));
        } catch (error) {
          return fail(reply, error);
        }
      }
    );
  }

  app.get<{ Params: { number: string } }>("/api/v1/encoder/:number/input", async (request, reply) => {
    const id = Number(request.params.number);
    if (!Number.isInteger(id) || id < 1) return reply.code(404).send({ error: { code: "ENCODER_NOT_FOUND" } });
    try {
      return await encoderService.getInputStatus(id);
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.get<{ Params: { number: string } }>("/api/v1/encoder/:number/settings", async (request, reply) => {
    const id = Number(request.params.number);
    if (!Number.isInteger(id) || id < 1) return reply.code(404).send({ error: { code: "ENCODER_NOT_FOUND" } });
    try {
      return await encoderService.getSettings(id);
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.put<{ Params: { number: string }; Body: Record<string, unknown> | undefined }>(
    "/api/v1/encoder/:number/settings",
    async (request, reply) => {
      const id = Number(request.params.number);
      if (!Number.isInteger(id) || id < 1) return reply.code(404).send({ error: { code: "ENCODER_NOT_FOUND" } });
      return handleSettingsPut(id, request, reply);
    }
  );

  async function handleSettingsPut(id: number, request: any, reply: FastifyReply) {
    const body = request.body ?? {};
    const { videoInput, audioInput, bitrateKbps, recordFileName } = body;
    if (videoInput !== undefined && videoInput !== "SDI" && videoInput !== "HDMI") return invalid(reply, "videoInput must be SDI or HDMI");
    if (audioInput !== undefined && audioInput !== "ANALOG" && audioInput !== "DIGITAL") return invalid(reply, "audioInput must be ANALOG or DIGITAL");
    if (bitrateKbps !== undefined && (!Number.isInteger(bitrateKbps) || (bitrateKbps as number) < 1)) return invalid(reply, "bitrateKbps must be a positive integer");
    if (recordFileName !== undefined && (typeof recordFileName !== "string" || !recordFileName.trim() || /[;\\/]/.test(recordFileName))) {
      return invalid(reply, "recordFileName must be a plain file name");
    }
    if (videoInput === undefined && audioInput === undefined && bitrateKbps === undefined && recordFileName === undefined) {
      return invalid(reply, "Give at least one of videoInput, audioInput, bitrateKbps, recordFileName");
    }
    try {
      return await encoderService.setSettings(id, {
        ...(videoInput !== undefined && { videoInput: videoInput as "SDI" | "HDMI" }),
        ...(audioInput !== undefined && { audioInput: audioInput as "ANALOG" | "DIGITAL" }),
        ...(bitrateKbps !== undefined && { bitrateKbps: bitrateKbps as number }),
        ...(recordFileName !== undefined && { recordFileName: (recordFileName as string).trim() })
      });
    } catch (error) {
      return fail(reply, error);
    }
  }

  // 4. RTMP configuration
  // /api/v1/encoder/:number/rtmp/:channel
  app.put<{ Params: { number: string; channel: string }; Body: { url?: unknown; streamName?: unknown } | undefined }>(
    "/api/v1/encoder/:number/rtmp/:channel",
    async (request, reply) => {
      const id = Number(request.params.number);
      const ch = Number(request.params.channel);
      if (!Number.isInteger(id) || id < 1) return reply.code(404).send({ error: { code: "ENCODER_NOT_FOUND" } });
      if (ch !== 1 && ch !== 2) return invalid(reply, "channel must be 1 or 2");
      return handleRtmpPut(id, ch, request, reply);
    }
  );

  // /api/v1/encoder/:number/rtmp (supports backward compatibility for unit 1 when :number is 1 or 2)
  app.put<{ Params: { number: string }; Body: { url?: unknown; streamName?: unknown; channel?: unknown } | undefined }>(
    "/api/v1/encoder/:number/rtmp",
    async (request, reply) => {
      const paramNum = Number(request.params.number);
      // If body has explicit channel or unit
      const bodyChannel = Number(request.body?.channel);
      let unitId = 1;
      let channelId: 1 | 2 = 1;

      if (paramNum === 1 || paramNum === 2) {
        if (bodyChannel === 1 || bodyChannel === 2) {
          unitId = paramNum;
          channelId = bodyChannel as 1 | 2;
        } else {
          // Legacy behavior: :number was channel 1 or 2 on unit 1
          unitId = 1;
          channelId = paramNum as 1 | 2;
        }
      } else {
        unitId = paramNum;
        channelId = (bodyChannel === 2 ? 2 : 1);
      }

      return handleRtmpPut(unitId, channelId, request, reply);
    }
  );

  async function handleRtmpPut(unitId: number, ch: 1 | 2, request: any, reply: FastifyReply) {
    const { url, streamName } = request.body ?? {};
    if (typeof url !== "string" || !/^rtmps?:\/\/[^;\s]+$/.test(url)) return invalid(reply, "url must be an rtmp:// or rtmps:// URL");
    if (typeof streamName !== "string" || !streamName || /[;\s]/.test(streamName)) return invalid(reply, "streamName is required and cannot contain ; or spaces");
    try {
      await encoderService.setRtmp(unitId, ch, { url, streamName });
      return reply.code(204).send();
    } catch (error) {
      return fail(reply, error);
    }
  }
}
