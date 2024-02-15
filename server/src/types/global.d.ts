import type Bot from "@/services/bot";
import type { types as MS } from "mediasoup";

declare global {
  namespace NodeJS {
    interface ProcessEnv {
      readonly NODE_ENV: "development" | "production";
      readonly DOMAIN?: string;
      readonly SOCKETIO_LISTEN_PORT: number;
      readonly MEDIASOUP_LISTEN_IP?: string;
      readonly MEDIASOUP_ANNOUNCED_IP?: string;
      readonly MEDIASOUP_LISTEN_PORT?: number;
      readonly MEDIASOUP_LISTEN_ADDR?: string;
      readonly MEDIASOUP_MIN_PORT: number;
      readonly MEDIASOUP_MAX_PORT: number;
      readonly NETWORK_THROTTLE_SECRET: string;
      readonly WORKER_CERT_FULLCHAIN: string;
      readonly WORKER_CERT_PRIVKEY: string;
      readonly LOG_LEVEL?: string;
    }
  }
  interface ResponseError extends Error {
    status?: number;
  }

  var audioLevelObserver: MS.AudioLevelObserver;
  var activeSpeakerObserver: MS.ActiveSpeakerObserver;
  var bot: Bot;
}

export {};
