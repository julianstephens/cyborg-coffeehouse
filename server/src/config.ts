import type { Config } from "@/types";
import fs from "fs";
import { LogLevel } from "loglayer";
import os from "os";
import path from "path";
import { handleError } from "./logger";

const ensureFile = (path: string) => {
  if (!fs.existsSync(path)) {
    handleError("unable to load SSL files. check your config.ts file");
  }

  return path;
};

const config: Config = {
  roomName: "Cyborg Coffeehouse",
  domain: process.env.DOMAIN || "localhost",
  logLevel: (process.env.LOG_LEVEL as LogLevel) || LogLevel.info,
  https: {
    listenIp: process.env.MEDIASOUP_LISTEN_ADDR || "0.0.0.0",
    listenPort: process.env.MEDIASOUP_LISTEN_PORT || 4443,
    tls: {
      cert: ensureFile(path.join(os.homedir(), "certs", "cyborg.dev.pem")),
      key: ensureFile(path.join(os.homedir(), "certs", "cyborg.dev-key.pem")),
    },
  },
  mediasoup: {
    numWorkers: Object.keys(os.cpus()).length,
    workerSettings: {
      logLevel: "warn",
    },
  },
};

export default config;
