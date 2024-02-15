import type { types as MS } from "mediasoup";

export interface AppData extends MS.AppData {
  displayName: string;
  webRtcServer: MS.WebRtcServer;
  peerId: string;
  consuming: boolean;
}

export type Device = {
  name: string;
  version: string;
  flag: string;
};

export type PeerInfo = {
  id: string;
  displayName: string;
  device: Device;
  producers: {
    id: string;
    kind: string;
  }[];
};

export type Broadcaster = {
  id: string;
  data: {
    displayName: string;
    device: Device;
    rtpCapabilities: MS.RtpCapabilities;
    transports: Map<string, MS.Transport>;
    producers: Map<string, MS.Producer>;
    consumers: Map<string, MS.Consumer>;
    dataProducers: Map<string, MS.DataProducer>;
    dataConsumers: Map<string, MS.DataConsumer>;
  };
};
