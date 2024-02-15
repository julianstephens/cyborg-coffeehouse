import config from "@/config";
import type { Primitive } from "@/types";
import { LogLayer, LogLevel, LoggerType } from "loglayer";
import pino, { type P } from "pino";

class Log {
  _p: P.BaseLogger;
  logger: LogLayer;

  constructor(
    level: LogLevel = LogLevel.info,
    context?: Record<string, Primitive>
  ) {
    this._p = pino({
      level,
      ...(process.env.NODE_ENV === "development"
        ? {
            transport: {
              target: "pino-pretty",
              options: {
                colorize: true,
              },
            },
          }
        : {}),
    });

    this.logger = new LogLayer<P.Logger>({
      logger: {
        instance: this._p,
        type: LoggerType.PINO,
      },
    });

    if (context) this.logger.withContext(context);
  }
}

export const log = new Log(config.logLevel).logger;
export const handleError = (message: string, error?: Error) => {
  const err = error ?? Error(message);
  log.withError(err).withError(message);
  throw err;
};
