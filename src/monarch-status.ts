export interface ChannelStatus {
  mode: string;
  state: string;
}

export interface ParsedStatus {
  encoder1: ChannelStatus;
  encoder2: ChannelStatus;
  name?: string;
}

const PACKED = /ENC1:([^,;]*)[,;]([^,;]*)[,;]ENC2:([^,;]*)[,;]([^,;]*)(?:[,;]NAME:(.*))?$/;

/**
 * The Monarch answers GetStatus as "ENC1:RTMP,ON,ENC2:RECORD,READY,NAME:MonarchHDX". The control
 * library splits on ';' and so puts the whole string into encoder1.mode. Returns the parsed
 * channels when the packed string is found in `status`, otherwise the input unchanged.
 */
export function normalizeStatus<T extends { encoder1?: { mode?: string; state?: string } | undefined; encoder2?: unknown; name?: string }>(
  status: T
): T | (Omit<T, "encoder1" | "encoder2" | "name"> & ParsedStatus) {
  const packed = status.encoder1?.mode;
  const m = typeof packed === "string" ? PACKED.exec(packed.trim()) : null;
  if (!m) return status;
  return {
    ...status,
    encoder1: { mode: m[1]!.trim(), state: m[2]!.trim() },
    encoder2: { mode: m[3]!.trim(), state: m[4]!.trim() },
    name: m[5]?.trim() || status.name || ""
  };
}
