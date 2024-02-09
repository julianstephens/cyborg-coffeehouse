import { consumerMgr, peerMgr, producerMgr, transportMgr } from "@/manager";
import type { Peer, SocketData } from "@/types";
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import fs from "fs";
import { StatusCodes } from "http-status-codes";
import https from "https";
import { nanoid } from "nanoid";
import { Server } from "socket.io";
import config from "./config";
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

export const createSocketServer = async (httpsServer: https.Server) => {
  const socketServer = new Server<{}, {}, {}, SocketData>(httpsServer, {
    serveClient: false,
    path: "/server",
  });

  socketServer.use((socket, next) => {
    const sessionId = socket.handshake.auth["sessionID"];
    if (sessionId) {
      socket.data.sessionID = sessionId;
      return next();
    }

    socket.data.sessionID = nanoid(20);
  });

  socketServer.on("connection", (socket) => {
    const p: Peer = {
      socket,
      room: config.roomName,
      transports: [],
      producers: [],
      consumers: [],
      self: { socketId: socket.data.sessionID, name: "", isAdmin: false },
    };
    peerMgr.add(socket.data.sessionID, p);

    log.withMetadata(p.self).info("client connected");

    socket.on("disconnect", () => {
      log.info(`client disconnected id = ${socket.data.sessionID}`);
      consumerMgr.remove(socket.data.sessionID);
      transportMgr.remove(socket.data.sessionID);
      producerMgr.remove(socket.data.sessionID);
    });

    socket.on("error", (err) => {
      log
        .withError(err)
        .error("something went wrong with the socket.io server");
    });
  });
};
