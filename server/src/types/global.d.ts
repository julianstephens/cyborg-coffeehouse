declare global {
  namespace NodeJS {
    interface ProcessEnv {
      readonly NODE_ENV: "development" | "production";
      readonly DOMAIN?: string;
      readonly SOCKETIO_LISTEN_PORT: number;
      readonly MEDIASOUP_LISTEN_PORT?: number;
      readonly MEDIASOUP_LISTEN_ADDR?: string;
      readonly MEDIASOUP_MIN_PORT: number;
      readonly MEDIASOUP_MAX_PORT: number;
      readonly LOG_LEVEL?: string;
    }
  }
  interface ResponseError extends Error {
    status?: number;
  }
}

export {};
