import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const { app, encoderService } = buildApp({ config });

  const shutdown = async () => {
    app.log.info("Shutting down piencoder...");
    encoderService.close();
    await app.close();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());

  try {
    await app.listen({ port: config.port, host: config.host });
    app.log.info({ port: config.port, host: config.host, encoders: config.encoders.length }, "piencoder listening");
  } catch (err) {
    app.log.error(err, "Failed to start piencoder");
    process.exit(1);
  }
}

void main();
