import type { LogLevel } from "loglayer";
import * as mediasoup from "mediasoup";
import io from "socket.io";

export type Config = {
  roomName: string;
  domain: string;
  logLevel: LogLevel;
  https: {
    listenIp: string;
    listenPort: number;
    tls: {
      cert: string;
      key: string;
    };
  };
  mediasoup: MediasoupConfig;
};

export type MediasoupConfig = {
  numWorkers: number;
  workerSettings: mediasoup.types.WorkerSettings;
  routerOptions: mediasoup.types.RouterOptions;
  webRtcServerOptions: mediasoup.types.WebRtcServerOptions;
  webRtcTransportOptions: mediasoup.types.WebRtcTransportOptions;
  plainTransportOptions: mediasoup.types.PlainTransportOptions;
};


export interface SocketData extends io.Socket {
  sessionID: string;
}

export type Peer = {
  socket: io.Socket;
  room: string;
  transports: string[];
  producers: string[];
  consumers: string[];
  self: {
    socketId: string;
    name: string;
    isAdmin: boolean;
  };
};

type Base = {
  room: string;
  dataChannel: object;
};

export type Consumer = Base & {
  consumer: string;
};

export type Producer = Base & {
  producer: string;
};

export type Transport = Base & {
  consumer: string;
  transport: string;
};
