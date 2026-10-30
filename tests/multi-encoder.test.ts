import test from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.js";
import type { MonarchDevice } from "../src/encoder-device.js";
import { loadConfig } from "../src/config.js";

function makeFakeMonarch(id: number, initialCalls: string[] = []): { device: MonarchDevice; calls: string[] } {
  const calls = initialCalls;
  let state = "READY";
  const device: MonarchDevice = {
    async getStatus() {
      return {
        encoder1: { mode: "RTMP", state },
        encoder2: { mode: "RECORD", state: "READY" },
        name: `Monarch Unit ${id}`
      } as any;
    },
    async startEncoder(n) {
      calls.push(`unit${id}_start${n}`);
      state = "ON";
      return {};
    },
    async stopEncoder(n) {
      calls.push(`unit${id}_stop${n}`);
      state = "READY";
      return {};
    },
    async startBothEncoders() {
      calls.push(`unit${id}_startBoth`);
      state = "ON";
      return {};
    },
    async stopBothEncoders() {
      calls.push(`unit${id}_stopBoth`);
      state = "READY";
      return {};
    },
    async getInputStatus() {
      return { video: "SDI", audio: "ANALOG", locked: true } as any;
    },
    async getVideoInput() {
      return "SDI";
    },
    async setVideoInput(input) {
      calls.push(`unit${id}_setVideoInput:${input}`);
      return {};
    },
    async getAudioInput() {
      return "ANALOG";
    },
    async setAudioInput(input) {
      calls.push(`unit${id}_setAudioInput:${input}`);
      return {};
    },
    async getStreamingVideoDataRate() {
      return 4500;
    },
    async setStreamingVideoDataRate(kbps) {
      calls.push(`unit${id}_setBitrate:${kbps}`);
      return {};
    },
    async getRecordFileName() {
      return "service.mp4";
    },
    async setRecordFileName(name) {
      calls.push(`unit${id}_setFileName:${name}`);
      return {};
    },
    async getEncoderRTMP(ch) {
      return { url: `rtmp://stream/live${ch}`, streamName: "key", username: "u" };
    },
    async setEncoderRTMP(ch, config) {
      calls.push(`unit${id}_setRtmp:ch${ch}:${config.url}`);
      return {};
    }
  };
  return { device, calls };
}

test("MultiEncoderService manages multiple encoders and routes correctly", async () => {
  const calls: string[] = [];
  const fake1 = makeFakeMonarch(1, calls);
  const fake2 = makeFakeMonarch(2, calls);

  const devices = new Map<number, MonarchDevice>();
  devices.set(1, fake1.device);
  devices.set(2, fake2.device);

  const config = loadConfig({
    PIENCODER_1_HOST: "10.0.0.1",
    PIENCODER_1_NAME: "Primary Encoder",
    PIENCODER_2_HOST: "10.0.0.2",
    PIENCODER_2_NAME: "Backup Encoder"
  });

  const { app, encoderService } = buildApp({
    config,
    devices,
    busyDelayMs: 1
  });

  try {
    // 1. GET /api/v1/encoder without number lists all and includes items
    const listRes = await app.inject({ method: "GET", url: "/api/v1/encoder" });
    assert.equal(listRes.statusCode, 200);
    const listJson = listRes.json();
    assert.ok(Array.isArray(listJson.items));
    assert.equal(listJson.items.length, 2);
    assert.equal(listJson.items[0].id, 1);
    assert.equal(listJson.items[0].name, "Primary Encoder");
    assert.equal(listJson.items[1].id, 2);
    assert.equal(listJson.items[1].name, "Backup Encoder");
    // backward compat fields on root
    assert.equal(listJson.id, 1);
    assert.equal(listJson.name, "Primary Encoder");

    // 2. GET /api/v1/encoder/1: single encoder 1
    const enc1Res = await app.inject({ method: "GET", url: "/api/v1/encoder/1" });
    assert.equal(enc1Res.statusCode, 200);
    assert.equal(enc1Res.json().id, 1);
    assert.equal(enc1Res.json().name, "Primary Encoder");

    // 3. GET /api/v1/encoder/2: single encoder 2
    const enc2Res = await app.inject({ method: "GET", url: "/api/v1/encoder/2" });
    assert.equal(enc2Res.statusCode, 200);
    assert.equal(enc2Res.json().id, 2);
    assert.equal(enc2Res.json().name, "Backup Encoder");

    // 4. GET /api/v1/encoder/99: not found
    const notFoundRes = await app.inject({ method: "GET", url: "/api/v1/encoder/99" });
    assert.equal(notFoundRes.statusCode, 404);

    // 5. POST /api/v1/encoder/1/start: starts unit 1
    const start1Res = await app.inject({
      method: "POST",
      url: "/api/v1/encoder/1/start",
      payload: { channel: 1 }
    });
    assert.equal(start1Res.statusCode, 200);
    assert.ok(calls.includes("unit1_start1"));

    // 6. POST /api/v1/encoder/2/start: starts unit 2
    const start2Res = await app.inject({
      method: "POST",
      url: "/api/v1/encoder/2/start",
      payload: { channel: "both" }
    });
    assert.equal(start2Res.statusCode, 200);
    assert.ok(calls.includes("unit2_startBoth"));

    // 7. Backward-compatible un-numbered POST /api/v1/encoder/stop defaults to unit 1
    const stopLegacyRes = await app.inject({
      method: "POST",
      url: "/api/v1/encoder/stop",
      payload: { encoder: 1 }
    });
    assert.equal(stopLegacyRes.statusCode, 200);
    assert.ok(calls.includes("unit1_stop1"));

    // 8. Settings for unit 2
    const settings2Res = await app.inject({
      method: "PUT",
      url: "/api/v1/encoder/2/settings",
      payload: { bitrateKbps: 6000 }
    });
    assert.equal(settings2Res.statusCode, 200);
    assert.ok(calls.includes("unit2_setBitrate:6000"));

    // 9. RTMP update for unit 2 channel 1
    const rtmp2Res = await app.inject({
      method: "PUT",
      url: "/api/v1/encoder/2/rtmp/1",
      payload: { url: "rtmp://backup/stream", streamName: "key2" }
    });
    assert.equal(rtmp2Res.statusCode, 204);
    assert.ok(calls.includes("unit2_setRtmp:ch1:rtmp://backup/stream"));

  } finally {
    encoderService.close();
    await app.close();
  }
});
