import config from "@/config";
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import fs from "fs";
import { StatusCodes } from "http-status-codes";
import https from "https";
import { log } from "./logger";

export const createExpressApp = async () => {
  const app = express();
  app.use(express.json());
  app.use(express.static(__dirname + "/public"));

  app.use(
    (error: ResponseError, req: Request, res: Response, next: NextFunction) => {
      if (error) {
        log.errorOnly(error);

        error.status =
          error.status ||
          (error.name === "TypeError"
            ? StatusCodes.BAD_REQUEST
            : StatusCodes.INTERNAL_SERVER_ERROR);

        res.statusMessage = error.message;
        res.status(error.status).send(String(error));
      } else {
        next();
      }
    }
  );

  return app;
};

export const createWebServer = async (
  expressApp: express.Application
): Promise<https.Server> => {
  const tls = {
    cert: fs.readFileSync(config.https.tls.cert),
    key: fs.readFileSync(config.https.tls.key),
  };

  const webServer = https.createServer(tls, expressApp);
  webServer.on("error", (err) => {
    log.withError(err).error("unable to initialize server");
  });

  return await new Promise((resolve) => {
    webServer.listen(
      Number(config.https.listenPort),
      config.https.listenIp,
      undefined,
      resolve as () => void
    );
  });
};
