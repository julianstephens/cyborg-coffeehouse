import { createExpressApp, createWebServer } from "@/server";
import { StatusCodes } from "http-status-codes";

import { log } from "@/logger";
import { context } from "@/services/context";
import { AwaitQueue } from "awaitqueue";
import protoo from "protoo-server";

const queue = new AwaitQueue();

const bootstrap = async () => {
  const expressApp = await createExpressApp();
  const webServer = await createWebServer(expressApp);

  const protooServer = new protoo.WebSocketServer(webServer, {
    maxReceivedFrameSize: 960000, // 960 KBytes.
    maxReceivedMessageSize: 960000,
    fragmentOutgoingMessages: true,
    fragmentationThreshold: 960000,
  });

  protooServer.on("connectionrequest", (info, accept, reject) => {
    if (!info.request?.url) {
      reject(
        StatusCodes.INTERNAL_SERVER_ERROR,
        "something went wrong parsing the request url"
      );
      return;
    }
    const u = new URL(info.request.url);
    const peerId = u.searchParams.get("peerId");

    if (!peerId) {
      reject(StatusCodes.BAD_REQUEST, "connection request without peerId");
      return;
    }

    const consumerReplicas =
      Number(u.searchParams.get("consumerReplicas")) || 0;

    log
      .withMetadata({
        peerId,
        address: info.socket.remoteAddress,
        origin: info.origin,
      })
      .info("protoo connection request");

    queue
      .push(async () => {
        const room = await context.getRoom(consumerReplicas);
        const protooWebSocketTransport = accept();
        room.handleProtooConnection(peerId, protooWebSocketTransport);
      })
      .catch((err) => {
        log.withError(err).error("room creation or room joining failed");
        reject(err);
      });
  });

  setInterval(() => {
    if (context.room) {
      context.room.logStatus();
    }
  }, 120000);
};

(async () => {
  await bootstrap();
})();
