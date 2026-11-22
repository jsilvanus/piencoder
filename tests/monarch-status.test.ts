import assert from "node:assert/strict";
import test from "node:test";
import { normalizeStatus } from "../src/monarch-status.js";

test("parses the packed GetStatus string the library leaves in encoder1.mode", () => {
  const r = normalizeStatus({ encoder1: { mode: "ENC1:RTMP,ON,ENC2:RECORD,READY,NAME:MonarchHDX" }, encoder2: {} } as never) as never as {
    encoder1: unknown; encoder2: unknown; name: string;
  };
  assert.deepEqual(r.encoder1, { mode: "RTMP", state: "ON" });
  assert.deepEqual(r.encoder2, { mode: "RECORD", state: "READY" });
  assert.equal(r.name, "MonarchHDX");
});

test("leaves an already parsed status alone", () => {
  const s = { encoder1: { mode: "RTMP", state: "ON" }, encoder2: { mode: "RECORD", state: "READY" }, name: "x" };
  assert.equal(normalizeStatus(s), s);
});
