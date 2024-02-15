import { log } from "@/logger";
import type { AppData } from "@/types";
import type { types as MS } from "mediasoup";

class Bot {
  _logger = log.child().withContext({ origin: "bot" });
  _transport: MS.Transport;
  _dataProducer: MS.DataProducer;

  static async create(mediasoupRouter: MS.Router) {
    // Create a DirectTransport for connecting the bot.
    const transport = await mediasoupRouter.createDirectTransport({
      maxMessageSize: 512,
    });
    // Create DataProducer to send messages to peers.
    const dataProducer = await transport.produceData({ label: "bot" });
    // Create the Bot instance.
    const bot = new Bot(transport, dataProducer);
    return bot;
  }

  constructor(transport: MS.Transport, dataProducer: MS.DataProducer) {
    // mediasoup DirectTransport.
    this._transport = transport;
    // mediasoup DataProducer.
    this._dataProducer = dataProducer;
  }

  get dataProducer() {
    return this._dataProducer;
  }

  close() {}

  async handlePeerDataProducer(
    dataProducerId: string,
    peer: MS.DataConsumer<AppData>
  ) {
    // Create a DataConsumer on the DirectTransport for each Peer.
    const dataConsumer = await this._transport.consumeData({
      dataProducerId,
    });

    dataConsumer.on("message", (message, ppid) => {
      // Ensure it's a WebRTC DataChannel string.
      if (ppid !== 51) {
        this._logger.warn("ignoring non string messagee from a Peer");
        return;
      }

      const text = message.toString("utf8");
      this._logger
        .withMetadata({ peerId: peer.id, "content-length": message.byteLength })
        .debug("SCTP message received");

      // Create a message to send it back to all Peers in behalf of the sending
      // Peer.
      const messageBack = `${peer.appData.displayName} said me: "${text}"`;
      this._dataProducer.send(messageBack);
    });
  }
}

export default Bot;
