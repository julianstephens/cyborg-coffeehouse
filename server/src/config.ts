import { handleError } from "@/logger";
import type { Config } from "@/types";
import fs from "fs";
import { LogLevel } from "loglayer";
import os from "os";
import path from "path";

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
      logTags: [
        "info",
        "ice",
        "dtls",
        "rtp",
        "srtp",
        "rtcp",
        "rtx",
        "bwe",
        "score",
        "simulcast",
        "svc",
        "sctp",
      ],
      dtlsCertificateFile: process.env.WORKER_CERT_FULLCHAIN,
      dtlsPrivateKeyFile: process.env.WORKER_CERT_PRIVKEY,
      rtcMinPort: process.env.MEDIASOUP_MIN_PORT || 40000,
      rtcMaxPort: process.env.MEDIASOUP_MAX_PORT || 49999,
    },
    routerOptions: {
      mediaCodecs: [
        {
          kind: "audio",
          mimeType: "audio/opus",
          clockRate: 48000,
          channels: 2,
        },
        {
          kind: "video",
          mimeType: "video/VP8",
          clockRate: 90000,
          parameters: {
            "x-google-start-bitrate": 1000,
          },
        },
        {
          kind: "video",
          mimeType: "video/VP9",
          clockRate: 90000,
          parameters: {
            "profile-id": 2,
            "x-google-start-bitrate": 1000,
          },
        },
        {
          kind: "video",
          mimeType: "video/h264",
          clockRate: 90000,
          parameters: {
            "packetization-mode": 1,
            "profile-level-id": "4d0032",
            "level-asymmetry-allowed": 1,
            "x-google-start-bitrate": 1000,
          },
        },
        {
          kind: "video",
          mimeType: "video/h264",
          clockRate: 90000,
          parameters: {
            "packetization-mode": 1,
            "profile-level-id": "42e01f",
            "level-asymmetry-allowed": 1,
            "x-google-start-bitrate": 1000,
          },
        },
      ],
    },
    webRtcServerOptions: {
      listenInfos: [
        {
          protocol: "udp",
          ip: process.env.MEDIASOUP_LISTEN_IP || "0.0.0.0",
          announcedIp: process.env.MEDIASOUP_ANNOUNCED_IP || "0.0.0.0",
          port: 44444,
        },
        {
          protocol: "tcp",
          ip: process.env.MEDIASOUP_LISTEN_IP || "0.0.0.0",
          announcedIp: process.env.MEDIASOUP_ANNOUNCED_IP || "0.0.0.0",
          port: 44444,
        },
      ],
    },
    webRtcTransportOptions: {
      listenIps: [
        {
          ip: process.env.MEDIASOUP_LISTEN_IP || "0.0.0.0",
          announcedIp: process.env.MEDIASOUP_ANNOUNCED_IP || "0.0.0.0",
        },
      ],
      initialAvailableOutgoingBitrate: 1000000,
      maxSctpMessageSize: 262144,
    },
    plainTransportOptions: {
      listenIp: {
        ip: process.env.MEDIASOUP_LISTEN_IP || "0.0.0.0",
        announcedIp: process.env.MEDIASOUP_ANNOUNCED_IP || "0.0.0.0",
      },
      maxSctpMessageSize: 262144,
    },
  },
};

export default config;
