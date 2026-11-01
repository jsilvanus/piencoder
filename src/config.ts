export interface EncoderUnitConfig {
  id: number;
  name: string;
  host?: string | undefined;
  username?: string | undefined;
  password?: string | undefined;
  https: boolean;
}

export interface AppConfig {
  port: number;
  host: string;
  mode: "production" | "simulation";
  encoders: EncoderUnitConfig[];
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const port = parseInt(env.PORT || env.PIENCODER_PORT || "3104", 10);
  const host = env.HOST || env.PIENCODER_HOST || "0.0.0.0";
  const mode = env.NODE_ENV === "test" || env.PIENCODER_SIMULATION === "true" ? "simulation" : "production";

  const encoders: EncoderUnitConfig[] = [];

  // 1. Primary encoder (compatible with PIGATEWAY_ENCODER_* or PIENCODER_1_*)
  const enc1Host = env.PIENCODER_1_HOST || env.PIENCODER_HOST || env.PIGATEWAY_ENCODER_HOST;
  const enc1User = env.PIENCODER_1_USER || env.PIENCODER_USER || env.PIGATEWAY_ENCODER_USER;
  const enc1Pass = env.PIENCODER_1_PASSWORD || env.PIENCODER_PASSWORD || env.PIGATEWAY_ENCODER_PASSWORD;
  const enc1Https = (env.PIENCODER_1_HTTPS || env.PIENCODER_HTTPS || env.PIGATEWAY_ENCODER_HTTPS) === "true";
  const enc1Name = env.PIENCODER_1_NAME || "Matrox Monarch HDX 1";

  if (Boolean(enc1User) !== Boolean(enc1Pass)) {
    throw new Error("Encoder 1 username and password must be provided together");
  }

  encoders.push({
    id: 1,
    name: enc1Name,
    host: enc1Host,
    username: enc1User,
    password: enc1Pass,
    https: enc1Https
  });

  // 2. Secondary encoder (PIENCODER_2_*)
  const enc2Host = env.PIENCODER_2_HOST;
  if (enc2Host) {
    const enc2User = env.PIENCODER_2_USER;
    const enc2Pass = env.PIENCODER_2_PASSWORD;
    const enc2Https = env.PIENCODER_2_HTTPS === "true";
    const enc2Name = env.PIENCODER_2_NAME || "Matrox Monarch HDX 2";

    if (Boolean(enc2User) !== Boolean(enc2Pass)) {
      throw new Error("Encoder 2 username and password must be provided together");
    }

    encoders.push({
      id: 2,
      name: enc2Name,
      host: enc2Host,
      username: enc2User,
      password: enc2Pass,
      https: enc2Https
    });
  }

  return { port, host, mode, encoders };
}
