import config from "@/config";
import { handleError, log } from "@/logger";
import Bot from "@/services/bot";
import type { AppData, Broadcaster, Device, PeerInfo } from "@/types";
import {
  start as startThrottle,
  stop as stopThrottle,
} from "@sitespeed.io/throttle";
import { EventEmitter } from "events";
import { StatusCodes } from "http-status-codes";
import { types as MS } from "mediasoup";
import { nanoid } from "nanoid";
import protoo from "protoo-server";

type RoomArgs = {
  roomId: string;
  protooRoom: protoo.Room;
  webRtcServer: MS.WebRtcServer<AppData>;
  mediasoupRouter: MS.Router;
  audioLevelObserver: MS.AudioLevelObserver;
  activeSpeakerObserver: MS.ActiveSpeakerObserver;
  consumerReplicas: number;
  bot: Bot;
};

/**
 * Room class.
 *
 * This is not a "mediasoup Room" by itself, by a custom class that holds
 * a protoo Room (for signaling with WebSocket clients) and a mediasoup Router
 * (for sending and receiving media to/from those WebSocket peers).
 */
class Room extends EventEmitter {
  _logger = log.child().withContext({ origin: "room" });
  _roomId: string;
  _closed: boolean;
  _protooRoom: protoo.Room;
  _broadcasters: Map<string, protoo.Peer>;
  _webRtcServer: MS.WebRtcServer<AppData>;
  _mediasoupRouter: MS.Router;
  _audioLevelObserver: MS.AudioLevelObserver;
  _activeSpeakerObserver: MS.ActiveSpeakerObserver;
  _consumerReplicas: number;
  _bot: Bot;
  _networkThrottled: boolean;

  static async create(
    mediasoupWorker: MS.Worker<AppData>,
    consumerReplicas: number
  ) {
    const protooRoom = new protoo.Room();
    const { mediaCodecs } = config.mediasoup.routerOptions;
    if (!mediaCodecs) {
      return handleError("unable to load media codecs. check your config.ts");
    }
    const mediasoupRouter = await mediasoupWorker.createRouter({ mediaCodecs });
    const audioLevelObserver = await mediasoupRouter.createAudioLevelObserver({
      maxEntries: 1,
      threshold: -80,
      interval: 800,
    });
    const activeSpeakerObserver =
      await mediasoupRouter.createActiveSpeakerObserver();
    const bot = await Bot.create(mediasoupRouter);

    return new Room({
      roomId: nanoid(20),
      protooRoom,
      webRtcServer: mediasoupWorker.appData
        .webRtcServer as MS.WebRtcServer<AppData>,
      mediasoupRouter,
      audioLevelObserver,
      activeSpeakerObserver,
      consumerReplicas,
      bot,
    });
  }

  constructor({
    roomId,
    protooRoom,
    webRtcServer,
    mediasoupRouter,
    audioLevelObserver,
    activeSpeakerObserver,
    consumerReplicas,
    bot,
  }: RoomArgs) {
    super();

    this.setMaxListeners(Infinity);

    this._roomId = roomId;
    this._closed = false;
    this._protooRoom = protooRoom;
    this._broadcasters = new Map();
    this._webRtcServer = webRtcServer;
    this._mediasoupRouter = mediasoupRouter;
    this._audioLevelObserver = audioLevelObserver;
    this._activeSpeakerObserver = activeSpeakerObserver;
    this._bot = bot;
    this._consumerReplicas = consumerReplicas || 0;
    this._networkThrottled = false;

    this._handleAudioLevelObserver();
    this._handleActiveSpeakerObserver();

    // For debugging.
    global.audioLevelObserver = this._audioLevelObserver;
    global.activeSpeakerObserver = this._activeSpeakerObserver;
    global.bot = this._bot;
  }

  /** Closes the the protoo Room and the mediasoup Router. */
  close() {
    this._logger.debug("close()");

    this._closed = true;

    // Close the protoo Room.
    this._protooRoom.close();

    // Close the mediasoup Router.
    this._mediasoupRouter.close();

    // Close the Bot.
    this._bot.close();

    // Emit 'close' event.
    this.emit("close");

    // Stop network throttling.
    if (this._networkThrottled) {
      this._logger.debug("close() | stopping network throttle");

      stopThrottle({}).catch((error: Error) => {
        this._logger
          .withError(error)
          .error("could not stop network throttling");
      });
    }
  }

  logStatus() {
    this._logger
      .withMetadata({
        roomId: this._roomId,
        numPeers: this._protooRoom.peers.length,
      })
      .info("room ok");
  }

  handleProtooConnection(
    peerId: string,
    protooWebSocketTransport: protoo.WebSocketTransport,
    consume: boolean = false
  ) {
    const existingPeer = this._protooRoom.getPeer(peerId);

    if (existingPeer) {
      this._logger
        .withMetadata({ peerId })
        .warn("there is already a protoo Peer with same peerId, closing it");

      existingPeer.close();
    }

    try {
      const peer = this._protooRoom.createPeer(
        peerId,
        protooWebSocketTransport
      );
      // Not joined after a custom protoo 'join' request is later received.
      peer.data.consume = consume;
      peer.data.joined = false;
      peer.data.displayName = undefined;
      peer.data.device = undefined;
      peer.data.rtpCapabilities = undefined;
      peer.data.sctpCapabilities = undefined;

      // Have mediasoup related maps ready even before the Peer joins since we
      // allow creating Transports before joining.
      peer.data.transports = new Map();
      peer.data.producers = new Map();
      peer.data.consumers = new Map();
      peer.data.dataProducers = new Map();
      peer.data.dataConsumers = new Map();

      peer.on("request", (request, accept, reject) => {
        this._logger
          .withMetadata({ method: request.method, peerId: peer.id })
          .debug("received protoo peer request");

        this._handleProtooRequest(peer, request, accept, reject).catch(
          (error) => {
            this._logger.withError(error).error("peer request failed");

            reject(error);
          }
        );
      });

      peer.on("close", () => {
        if (this._closed) return;

        this._logger
          .withMetadata({ peerId: peer.id })
          .debug("protoo peer 'close' event");

        // If the Peer was joined, notify all Peers.
        if (peer.data.joined) {
          for (const otherPeer of this._getJoinedPeers(peer)) {
            otherPeer.notify("peerClosed", { peerId: peer.id }).catch(() => {});
          }
        }

        // Iterate and close all mediasoup Transport associated to this Peer, so all
        // its Producers and Consumers will also be closed.
        for (const transport of peer.data.transports.values()) {
          transport.close();
        }

        // If this is the latest Peer in the room, close the room.
        if (this._protooRoom.peers.length === 0) {
          this._logger.info("last Peer in the room left, closing the room");
          this.close();
        }
      });
    } catch (error) {
      this._logger.withError(error).error("failed to create protoo peer");
    }
  }

  getRouterRtpCapabilities() {
    return this._mediasoupRouter.rtpCapabilities;
  }

  async createBroadcaster(
    id: string,
    displayName: string,
    device: Device | null = null,
    rtpCapabilities: MS.RtpCapabilities
  ) {
    if (this._broadcasters.has(id))
      throw new Error(`broadcaster with id "${id}" already exists`);

    const broadcaster: Broadcaster = {
      id,
      data: {
        displayName,
        device: {
          flag: "broadcaster",
          name: device?.name || "Unknown device",
          version: device?.version || "1",
        },
        rtpCapabilities,
        transports: new Map(),
        producers: new Map(),
        consumers: new Map(),
        dataProducers: new Map(),
        dataConsumers: new Map(),
      },
    };

    // Store the Broadcaster into the map.
    this._broadcasters.set(broadcaster.id, broadcaster as protoo.Peer);

    // Notify the new Broadcaster to all Peers.
    for (const otherPeer of this._getJoinedPeers()) {
      otherPeer
        .notify("newPeer", {
          id: broadcaster.id,
          displayName: broadcaster.data.displayName,
          device: broadcaster.data.device,
        })
        .catch(() => {});
    }

    // Reply with the list of Peers and their Producers.
    const peerInfos = [];
    const joinedPeers = this._getJoinedPeers();

    // Just fill the list of Peers if the Broadcaster provided its rtpCapabilities.
    if (rtpCapabilities) {
      for (const joinedPeer of joinedPeers) {
        const peerInfo: PeerInfo = {
          id: joinedPeer.id,
          displayName: joinedPeer.data.displayName,
          device: joinedPeer.data.device,
          producers: [],
        };

        for (const producer of joinedPeer.data.producers.values()) {
          // Ignore Producers that the Broadcaster cannot consume.
          if (
            !this._mediasoupRouter.canConsume({
              producerId: producer.id,
              rtpCapabilities,
            })
          ) {
            continue;
          }

          peerInfo.producers.push({
            id: producer.id,
            kind: producer.kind,
          });
        }

        peerInfos.push(peerInfo);
      }
    }

    return { peers: peerInfos };
  }

  deleteBroadcaster(broadcasterId: string) {
    const broadcaster = this._broadcasters.get(broadcasterId);

    if (!broadcaster)
      throw new Error(`broadcaster with id "${broadcasterId}" does not exist`);

    for (const transport of broadcaster.data.transports.values()) {
      transport.close();
    }

    this._broadcasters.delete(broadcasterId);

    for (const peer of this._getJoinedPeers()) {
      peer.notify("peerClosed", { peerId: broadcasterId }).catch(() => {});
    }
  }

  async createBroadcasterTransport(
    broadcasterId: string,
    type: string,
    rtcpMux = false,
    comedia = true,
    sctpCapabilities: MS.SctpCapabilities
  ) {
    const broadcaster = this._broadcasters.get(broadcasterId);

    if (!broadcaster)
      throw new Error(`broadcaster with id "${broadcasterId}" does not exist`);

    switch (type) {
      case "webrtc": {
        const webRtcTransportOptions = {
          ...config.mediasoup.webRtcTransportOptions,
          enableSctp: Boolean(sctpCapabilities),
          numSctpStreams: (sctpCapabilities || {}).numStreams,
        };

        const transport = await this._mediasoupRouter.createWebRtcTransport({
          ...webRtcTransportOptions,
          webRtcServer: this._webRtcServer,
        } as MS.WebRtcTransportOptions);

        broadcaster.data.transports.set(transport.id, transport);

        return {
          id: transport.id,
          iceParameters: transport.iceParameters,
          iceCandidates: transport.iceCandidates,
          dtlsParameters: transport.dtlsParameters,
          sctpParameters: transport.sctpParameters,
        };
      }

      case "plain": {
        const plainTransportOptions = {
          ...config.mediasoup.plainTransportOptions,
          rtcpMux: rtcpMux,
          comedia: comedia,
        };

        const transport = await this._mediasoupRouter.createPlainTransport(
          plainTransportOptions
        );

        // Store it.
        broadcaster.data.transports.set(transport.id, transport);

        return {
          id: transport.id,
          ip: transport.tuple.localIp,
          port: transport.tuple.localPort,
          rtcpPort: transport.rtcpTuple
            ? transport.rtcpTuple.localPort
            : undefined,
        };
      }

      default: {
        throw new TypeError("invalid type");
      }
    }
  }

  async connectBroadcasterTransport(
    broadcasterId: string,
    transportId: string,
    dtlsParameters: MS.DtlsParameters
  ) {
    const broadcaster = this._broadcasters.get(broadcasterId);

    if (!broadcaster)
      throw new Error(`broadcaster with id "${broadcasterId}" does not exist`);

    const transport = broadcaster.data.transports.get(transportId);

    if (!transport)
      throw new Error(`transport with id "${transportId}" does not exist`);

    if (transport.constructor.name !== "WebRtcTransport") {
      throw new Error(
        `transport with id "${transportId}" is not a WebRtcTransport`
      );
    }

    await transport.connect({ dtlsParameters });
  }

  async createBroadcasterProducer(
    broadcasterId: string,
    transportId: string,
    kind: "audio" | "video",
    rtpParameters: MS.RtpParameters
  ) {
    const broadcaster = this._broadcasters.get(broadcasterId);

    if (!broadcaster)
      throw new Error(`broadcaster with id "${broadcasterId}" does not exist`);

    const transport = broadcaster.data.transports.get(transportId);

    if (!transport)
      throw new Error(`transport with id "${transportId}" does not exist`);

    const producer = await transport.produce({ kind, rtpParameters });

    broadcaster.data.producers.set(producer.id, producer);

    producer.on(
      "videoorientationchange",
      (videoOrientation: MS.ProducerVideoOrientation) => {
        this._logger
          .withMetadata({ videoOrientation, producerId: producer.id })
          .debug('broadcaster producer "videoorientationchange" event');
      }
    );

    // Optimization: Create a server-side Consumer for each Peer.
    for (const peer of this._getJoinedPeers()) {
      this._createConsumer(peer, broadcaster, producer);
    }

    // Add into the AudioLevelObserver and ActiveSpeakerObserver.
    if (producer.kind === "audio") {
      this._audioLevelObserver
        .addProducer({ producerId: producer.id })
        .catch(() => {});

      this._activeSpeakerObserver
        .addProducer({ producerId: producer.id })
        .catch(() => {});
    }

    return { id: producer.id };
  }

  async createBroadcasterConsumer(
    broadcasterId: string,
    transportId: string,
    producerId: string
  ) {
    const broadcaster = this._broadcasters.get(broadcasterId);

    if (!broadcaster)
      throw new Error(`broadcaster with id "${broadcasterId}" does not exist`);

    if (!broadcaster.data.rtpCapabilities)
      throw new Error("broadcaster does not have rtpCapabilities");

    const transport = broadcaster.data.transports.get(transportId);

    if (!transport)
      throw new Error(`transport with id "${transportId}" does not exist`);

    const consumer = await transport.consume({
      producerId,
      rtpCapabilities: broadcaster.data.rtpCapabilities,
    });

    broadcaster.data.consumers.set(consumer.id, consumer);

    consumer.on("transportclose", () => {
      broadcaster.data.consumers.delete(consumer.id);
    });

    consumer.on("producerclose", () => {
      broadcaster.data.consumers.delete(consumer.id);
    });

    return {
      id: consumer.id,
      producerId,
      kind: consumer.kind,
      rtpParameters: consumer.rtpParameters,
      type: consumer.type,
    };
  }

  async createBroadcasterDataConsumer(
    broadcasterId: string,
    transportId: string,
    dataProducerId: string
  ) {
    const broadcaster = this._broadcasters.get(broadcasterId);

    if (!broadcaster)
      throw new Error(`broadcaster with id "${broadcasterId}" does not exist`);

    if (!broadcaster.data.rtpCapabilities)
      throw new Error("broadcaster does not have rtpCapabilities");

    const transport = broadcaster.data.transports.get(transportId);

    if (!transport)
      throw new Error(`transport with id "${transportId}" does not exist`);

    const dataConsumer = await transport.consumeData({
      dataProducerId,
    });

    broadcaster.data.dataConsumers.set(dataConsumer.id, dataConsumer);

    dataConsumer.on("transportclose", () => {
      broadcaster.data.dataConsumers.delete(dataConsumer.id);
    });

    dataConsumer.on("dataproducerclose", () => {
      broadcaster.data.dataConsumers.delete(dataConsumer.id);
    });

    return {
      id: dataConsumer.id,
      streamId: dataConsumer.sctpStreamParameters?.streamId,
    };
  }

  async createBroadcasterDataProducer(
    broadcasterId: string,
    transportId: string,
    label: string,
    protocol: string,
    sctpStreamParameters: MS.SctpStreamParameters,
    appData: AppData
  ) {
    const broadcaster = this._broadcasters.get(broadcasterId);

    if (!broadcaster)
      throw new Error(`broadcaster with id "${broadcasterId}" does not exist`);

    const transport = broadcaster.data.transports.get(transportId);

    if (!transport)
      throw new Error(`transport with id "${transportId}" does not exist`);

    const dataProducer = await transport.produceData({
      sctpStreamParameters,
      label,
      protocol,
      appData,
    });

    broadcaster.data.dataProducers.set(dataProducer.id, dataProducer);
    dataProducer.on("transportclose", () => {
      broadcaster.data.dataProducers.delete(dataProducer.id);
    });

    // // Optimization: Create a server-side Consumer for each Peer.
    // for (const peer of this._getJoinedPeers())
    // {
    // 	this._createDataConsumer(
    // 		{
    // 			dataConsumerPeer : peer,
    // 			dataProducerPeer : broadcaster,
    // 			dataProducer: dataProducer
    // 		});
    // }

    return {
      id: dataProducer.id,
    };
  }

  _handleAudioLevelObserver() {
    this._audioLevelObserver.on("volumes", (volumes) => {
      const v = volumes[0];
      if (!v) return;

      const { producer, volume } = v;

      this._logger
        .withMetadata({
          producerId: v.producer.id,
          volume: v.volume,
        })
        .debug('audioLevelObserver "volumes" event');

      // Notify all Peers.
      for (const peer of this._getJoinedPeers()) {
        peer
          .notify("activeSpeaker", {
            peerId: (producer.appData as AppData).peerId,
            volume: volume,
          })
          .catch(() => {});
      }
    });

    this._audioLevelObserver.on("silence", () => {
      this._logger.debug('audioLevelObserver "silence" event');

      // Notify all Peers.
      for (const peer of this._getJoinedPeers()) {
        peer.notify("activeSpeaker", { peerId: null }).catch(() => {});
      }
    });
  }

  _handleActiveSpeakerObserver() {
    this._activeSpeakerObserver.on("dominantspeaker", (dominantSpeaker) => {
      this._logger
        .withMetadata({ producerId: dominantSpeaker.producer.id })
        .debug('activeSpeakerObserver "dominantspeaker" event');
    });
  }

  async _handleProtooRequest(
    peer: protoo.Peer,
    request: protoo.ProtooRequest,
    accept: protoo.AcceptFn,
    reject: protoo.RejectFn
  ) {
    switch (request.method) {
      case "getRouterRtpCapabilities": {
        accept(this._mediasoupRouter.rtpCapabilities);

        break;
      }

      case "join": {
        // Ensure the Peer is not already joined.
        if (peer.data.joined) throw new Error("Peer already joined");

        const { displayName, device, rtpCapabilities, sctpCapabilities } =
          request.data;

        // Store client data into the protoo Peer data object.
        peer.data.joined = true;
        peer.data.displayName = displayName;
        peer.data.device = device;
        peer.data.rtpCapabilities = rtpCapabilities;
        peer.data.sctpCapabilities = sctpCapabilities;

        // Tell the new Peer about already joined Peers.
        // And also create Consumers for existing Producers.

        const joinedPeers = [
          ...this._getJoinedPeers(),
          ...this._broadcasters.values(),
        ];

        // Reply now the request with the list of joined peers (all but the new one).
        const peerInfos = joinedPeers
          .filter((joinedPeer) => joinedPeer.id !== peer.id)
          .map((joinedPeer) => ({
            id: joinedPeer.id,
            displayName: joinedPeer.data.displayName,
            device: joinedPeer.data.device,
          }));

        accept({ peers: peerInfos });

        // Mark the new Peer as joined.
        peer.data.joined = true;

        for (const joinedPeer of joinedPeers) {
          // Create Consumers for existing Producers.
          for (const producer of joinedPeer.data.producers.values()) {
            this._createConsumer(peer, joinedPeer, producer);
          }

          // Create DataConsumers for existing DataProducers.
          for (const dataProducer of joinedPeer.data.dataProducers.values()) {
            if (dataProducer.label === "bot") continue;

            this._createDataConsumer(peer, joinedPeer, dataProducer);
          }
        }

        // Create DataConsumers for bot DataProducer.
        this._createDataConsumer(
          peer,
          null,
          this._bot.dataProducer as unknown as MS.Producer<AppData>
        );

        // Notify the new Peer to all other Peers.
        for (const otherPeer of this._getJoinedPeers(peer)) {
          otherPeer
            .notify("newPeer", {
              id: peer.id,
              displayName: peer.data.displayName,
              device: peer.data.device,
            })
            .catch(() => {});
        }

        break;
      }

      case "createWebRtcTransport": {
        // NOTE: Don't require that the Peer is joined here, so the client can
        // initiate mediasoup Transports and be ready when he later joins.

        const { forceTcp, producing, consuming, sctpCapabilities } =
          request.data;

        const webRtcTransportOptions = {
          ...config.mediasoup.webRtcTransportOptions,
          enableSctp: Boolean(sctpCapabilities),
          numSctpStreams: (sctpCapabilities || {}).numStreams,
          appData: { producing, consuming },
        };

        if (forceTcp) {
          webRtcTransportOptions.enableUdp = false;
          webRtcTransportOptions.enableTcp = true;
        }

        const transport = await this._mediasoupRouter.createWebRtcTransport({
          ...webRtcTransportOptions,
          webRtcServer: this._webRtcServer,
        } as MS.WebRtcTransportOptions);

        transport.on("sctpstatechange", (sctpState) => {
          this._logger.debug(
            'WebRtcTransport "sctpstatechange" event [sctpState:%s]',
            sctpState
          );
        });

        transport.on("dtlsstatechange", (dtlsState) => {
          if (dtlsState === "failed" || dtlsState === "closed")
            this._logger.warn(
              'WebRtcTransport "dtlsstatechange" event [dtlsState:%s]',
              dtlsState
            );
        });

        // NOTE: For testing.
        // await transport.enableTraceEvent([ 'probation', 'bwe' ]);
        await transport.enableTraceEvent(["bwe"]);

        transport.on("trace", (trace) => {
          this._logger
            .withMetadata({
              transportId: transport.id,
              type: trace.type,
              trace: trace,
            })
            .debug('transport "trace" event');

          if (trace.type === "bwe" && trace.direction === "out") {
            peer
              .notify("downlinkBwe", {
                desiredBitrate: trace.info.desiredBitrate,
                effectiveDesiredBitrate: trace.info.effectiveDesiredBitrate,
                availableBitrate: trace.info.availableBitrate,
              })
              .catch(() => {});
          }
        });

        // Store the WebRtcTransport into the protoo Peer data Object.
        peer.data.transports.set(transport.id, transport);

        accept({
          id: transport.id,
          iceParameters: transport.iceParameters,
          iceCandidates: transport.iceCandidates,
          dtlsParameters: transport.dtlsParameters,
          sctpParameters: transport.sctpParameters,
        });

        //   const { maxIncomingBitrate } = config.mediasoup.webRtcTransportOptions;

        //   // If set, apply max incoming bitrate limit.
        //   if (maxIncomingBitrate) {
        //     try {
        //       await transport.setMaxIncomingBitrate(maxIncomingBitrate);
        //     } catch (error) {}
        //   }

        break;
      }

      case "connectWebRtcTransport": {
        const { transportId, dtlsParameters } = request.data;
        const transport = peer.data.transports.get(transportId);

        if (!transport)
          throw new Error(`transport with id "${transportId}" not found`);

        await transport.connect({ dtlsParameters });

        accept(null);

        break;
      }

      case "restartIce": {
        const { transportId } = request.data;
        const transport = peer.data.transports.get(transportId);

        if (!transport)
          throw new Error(`transport with id "${transportId}" not found`);

        const iceParameters = await transport.restartIce();

        accept(iceParameters);

        break;
      }

      case "produce": {
        // Ensure the Peer is joined.
        if (!peer.data.joined) throw new Error("Peer not yet joined");

        const { transportId, kind, rtpParameters } = request.data;
        let { appData } = request.data;
        const transport = peer.data.transports.get(transportId);

        if (!transport)
          throw new Error(`transport with id "${transportId}" not found`);

        // Add peerId into appData to later get the associated Peer during
        // the 'loudest' event of the audioLevelObserver.
        appData = { ...appData, peerId: peer.id };

        const producer = await transport.produce({
          kind,
          rtpParameters,
          appData,
          // keyFrameRequestDelay: 5000
        });

        // Store the Producer into the protoo Peer data Object.
        peer.data.producers.set(producer.id, producer);

        // Set Producer events.
        producer.on("score", (score: number) => {
          // this._logger.debug(
          // 	'producer "score" event [producerId:%s, score:%o]',
          // 	producer.id, score);

          peer
            .notify("producerScore", { producerId: producer.id, score })
            .catch(() => {});
        });

        producer.on("videoorientationchange", (videoOrientation: object) => {
          this._logger
            .withMetadata({ producerId: producer.id, videoOrientation })
            .debug('producer "videoorientationchange" event');
        });

        // NOTE: For testing.
        // await producer.enableTraceEvent([ 'rtp', 'keyframe', 'nack', 'pli', 'fir' ]);
        // await producer.enableTraceEvent([ 'pli', 'fir' ]);
        // await producer.enableTraceEvent([ 'keyframe' ]);

        producer.on("trace", (trace: MS.ProducerTraceEventData) => {
          this._logger
            .withMetadata({
              producerId: producer.id,
              type: trace.type,
              trace,
            })
            .debug('producer "trace" event');
        });

        accept({ id: producer.id });

        // Optimization: Create a server-side Consumer for each Peer.
        for (const otherPeer of this._getJoinedPeers(peer)) {
          this._createConsumer(otherPeer, peer, producer);
        }

        /* Test rtpjs lib. */

        // const directTransport = await this._mediasoupRouter.createDirectTransport();

        // directTransport.on('rtcp', (buffer) =>
        // {
        // 	const rtcpPacket =
        // 		new rtp.packets.CompoundPacket(rtp.utils.nodeBufferToDataView(buffer));

        // 	this._logger.info('RTCP packet');
        // 	this._logger.info(rtcpPacket.dump());
        // });

        // const directConsumer = await directTransport.consume(
        // 	{
        // 		producerId      : producer.id,
        // 		rtpCapabilities : this._mediasoupRouter.rtpCapabilities
        // 	}
        // );

        // const directProducer = await directTransport.produce(
        // 	{
        // 		kind          : directConsumer.kind,
        // 		rtpParameters : directConsumer.rtpParameters
        // 	});

        // directConsumer.on('rtp', (buffer) =>
        // {
        // 	const rtpPacket =
        // 		new rtp.packets.RtpPacket(rtp.utils.nodeBufferToDataView(buffer));

        // 	// this._logger.info('RTP packet');
        // 	// this._logger.info(rtpPacket.dump());

        // 	directProducer.send(buffer);
        // });

        // Add into the AudioLevelObserver and ActiveSpeakerObserver.
        if (producer.kind === "audio") {
          this._audioLevelObserver
            .addProducer({ producerId: producer.id })
            .catch(() => {});

          this._activeSpeakerObserver
            .addProducer({ producerId: producer.id })
            .catch(() => {});
        }

        break;
      }

      case "closeProducer": {
        // Ensure the Peer is joined.
        if (!peer.data.joined) throw new Error("Peer not yet joined");

        const { producerId } = request.data;
        const producer = peer.data.producers.get(producerId);

        if (!producer)
          throw new Error(`producer with id "${producerId}" not found`);

        producer.close();

        // Remove from its map.
        peer.data.producers.delete(producer.id);

        accept(null);

        break;
      }

      case "pauseProducer": {
        // Ensure the Peer is joined.
        if (!peer.data.joined) throw new Error("Peer not yet joined");

        const { producerId } = request.data;
        const producer = peer.data.producers.get(producerId);

        if (!producer)
          throw new Error(`producer with id "${producerId}" not found`);

        await producer.pause();

        accept(null);

        break;
      }

      case "resumeProducer": {
        // Ensure the Peer is joined.
        if (!peer.data.joined) throw new Error("Peer not yet joined");

        const { producerId } = request.data;
        const producer = peer.data.producers.get(producerId);

        if (!producer)
          throw new Error(`producer with id "${producerId}" not found`);

        await producer.resume();

        accept(null);

        break;
      }

      case "pauseConsumer": {
        // Ensure the Peer is joined.
        if (!peer.data.joined) throw new Error("Peer not yet joined");

        const { consumerId } = request.data;
        const consumer = peer.data.consumers.get(consumerId);

        if (!consumer)
          throw new Error(`consumer with id "${consumerId}" not found`);

        await consumer.pause();

        accept(null);

        break;
      }

      case "resumeConsumer": {
        // Ensure the Peer is joined.
        if (!peer.data.joined) throw new Error("Peer not yet joined");

        const { consumerId } = request.data;
        const consumer = peer.data.consumers.get(consumerId);

        if (!consumer)
          throw new Error(`consumer with id "${consumerId}" not found`);

        await consumer.resume();

        accept(null);

        break;
      }

      case "setConsumerPreferredLayers": {
        // Ensure the Peer is joined.
        if (!peer.data.joined) throw new Error("Peer not yet joined");

        const { consumerId, spatialLayer, temporalLayer } = request.data;
        const consumer = peer.data.consumers.get(consumerId);

        if (!consumer)
          throw new Error(`consumer with id "${consumerId}" not found`);

        await consumer.setPreferredLayers({ spatialLayer, temporalLayer });

        accept(null);

        break;
      }

      case "setConsumerPriority": {
        // Ensure the Peer is joined.
        if (!peer.data.joined) throw new Error("Peer not yet joined");

        const { consumerId, priority } = request.data;
        const consumer = peer.data.consumers.get(consumerId);

        if (!consumer)
          throw new Error(`consumer with id "${consumerId}" not found`);

        await consumer.setPriority(priority);

        accept(null);

        break;
      }

      case "requestConsumerKeyFrame": {
        // Ensure the Peer is joined.
        if (!peer.data.joined) throw new Error("Peer not yet joined");

        const { consumerId } = request.data;
        const consumer = peer.data.consumers.get(consumerId);

        if (!consumer)
          throw new Error(`consumer with id "${consumerId}" not found`);

        await consumer.requestKeyFrame();

        accept(null);

        break;
      }

      case "produceData": {
        // Ensure the Peer is joined.
        if (!peer.data.joined) throw new Error("Peer not yet joined");

        const { transportId, sctpStreamParameters, label, protocol, appData } =
          request.data;

        const transport = peer.data.transports.get(transportId);

        if (!transport)
          throw new Error(`transport with id "${transportId}" not found`);

        const dataProducer = await transport.produceData({
          sctpStreamParameters,
          label,
          protocol,
          appData,
        });

        // Store the Producer into the protoo Peer data Object.
        peer.data.dataProducers.set(dataProducer.id, dataProducer);

        accept({ id: dataProducer.id });

        switch (dataProducer.label) {
          case "chat": {
            // Create a server-side DataConsumer for each Peer.
            for (const otherPeer of this._getJoinedPeers(peer)) {
              this._createDataConsumer(otherPeer, peer, dataProducer);
            }

            break;
          }

          case "bot": {
            // Pass it to the bot.
            this._bot.handlePeerDataProducer(
              dataProducer.id,
              peer as unknown as MS.DataConsumer<AppData>
            );
            break;
          }
        }

        break;
      }

      case "changeDisplayName": {
        // Ensure the Peer is joined.
        if (!peer.data.joined) throw new Error("Peer not yet joined");

        const { displayName } = request.data;
        const oldDisplayName = peer.data.displayName;

        // Store the display name into the custom data Object of the protoo
        // Peer.
        peer.data.displayName = displayName;

        // Notify other joined Peers.
        for (const otherPeer of this._getJoinedPeers(peer)) {
          otherPeer
            .notify("peerDisplayNameChanged", {
              peerId: peer.id,
              displayName,
              oldDisplayName,
            })
            .catch(() => {});
        }

        accept(null);

        break;
      }

      case "getTransportStats": {
        const { transportId } = request.data;
        const transport = peer.data.transports.get(transportId);

        if (!transport)
          throw new Error(`transport with id "${transportId}" not found`);

        const stats = await transport.getStats();

        accept(stats);

        break;
      }

      case "getProducerStats": {
        const { producerId } = request.data;
        const producer = peer.data.producers.get(producerId);

        if (!producer)
          throw new Error(`producer with id "${producerId}" not found`);

        const stats = await producer.getStats();

        accept(stats);

        break;
      }

      case "getConsumerStats": {
        const { consumerId } = request.data;
        const consumer = peer.data.consumers.get(consumerId);

        if (!consumer)
          throw new Error(`consumer with id "${consumerId}" not found`);

        const stats = await consumer.getStats();

        accept(stats);

        break;
      }

      case "getDataProducerStats": {
        const { dataProducerId } = request.data;
        const dataProducer = peer.data.dataProducers.get(dataProducerId);

        if (!dataProducer)
          throw new Error(`dataProducer with id "${dataProducerId}" not found`);

        const stats = await dataProducer.getStats();

        accept(stats);

        break;
      }

      case "getDataConsumerStats": {
        const { dataConsumerId } = request.data;
        const dataConsumer = peer.data.dataConsumers.get(dataConsumerId);

        if (!dataConsumer)
          throw new Error(`dataConsumer with id "${dataConsumerId}" not found`);

        const stats = await dataConsumer.getStats();

        accept(stats);

        break;
      }

      case "applyNetworkThrottle": {
        const DefaultUplink = 1000000;
        const DefaultDownlink = 1000000;
        const DefaultRtt = 0;
        const DefaultPacketLoss = 0;

        const { secret, uplink, downlink, rtt, packetLoss } = request.data;

        if (!secret || secret !== process.env.NETWORK_THROTTLE_SECRET) {
          reject(StatusCodes.FORBIDDEN, "operation NOT allowed, modda fuckaa");

          return;
        }

        try {
          this._networkThrottled = true;

          await startThrottle({
            up: uplink || DefaultUplink,
            down: downlink || DefaultDownlink,
            rtt: rtt || DefaultRtt,
            packetLoss: packetLoss || DefaultPacketLoss,
          });

          this._logger
            .withMetadata({
              uplink: uplink || DefaultUplink,
              downlink: downlink || DefaultDownlink,
              rtt: rtt || DefaultRtt,
              packetLoss: packetLoss || DefaultPacketLoss,
            })
            .warn("network throttle set");

          accept(null);
        } catch (error) {
          this._logger.withError(error).error("network throttle apply failed");

          reject(
            StatusCodes.INTERNAL_SERVER_ERROR,
            (error as Error).toString()
          );
        }

        break;
      }

      case "resetNetworkThrottle": {
        const { secret } = request.data;

        if (!secret || secret !== process.env.NETWORK_THROTTLE_SECRET) {
          reject(StatusCodes.FORBIDDEN, "operation NOT allowed, modda fuckaa");

          return;
        }

        try {
          await stopThrottle({});

          this._logger.warn("network throttle stopped");

          accept(null);
        } catch (error) {
          this._logger.withError(error).error("network throttle stop failed");

          reject(
            StatusCodes.INTERNAL_SERVER_ERROR,
            (error as Error).toString()
          );
        }

        break;
      }

      default: {
        this._logger.error(`unknown request.method ${request.method}`);

        reject(
          StatusCodes.INTERNAL_SERVER_ERROR,
          `unknown request.method "${request.method}"`
        );
      }
    }
  }

  /**
   * Helper to get the list of joined protoo peers.
   */
  _getJoinedPeers(excludePeer?: protoo.Peer) {
    return this._protooRoom.peers.filter(
      (peer) => peer.data.joined && peer !== excludePeer
    );
  }

  /**
   * Creates a mediasoup Consumer for the given mediasoup Producer.
   *
   * @async
   */
  async _createConsumer(
    consumerPeer: protoo.Peer,
    producerPeer: protoo.Peer,
    producer: MS.Producer
  ) {
    // Optimization:
    // - Create the server-side Consumer in paused mode.
    // - Tell its Peer about it and wait for its response.
    // - Upon receipt of the response, resume the server-side Consumer.
    // - If video, this will mean a single key frame requested by the
    //   server-side Consumer (when resuming it).
    // - If audio (or video), it will avoid that RTP packets are received by the
    //   remote endpoint *before* the Consumer is locally created in the endpoint
    //   (and before the local SDP O/A procedure ends). If that happens (RTP
    //   packets are received before the SDP O/A is done) the PeerConnection may
    //   fail to associate the RTP stream.

    // NOTE: Don't create the Consumer if the remote Peer cannot consume it.
    if (
      !consumerPeer.data.rtpCapabilities ||
      !this._mediasoupRouter.canConsume({
        producerId: producer.id,
        rtpCapabilities: consumerPeer.data.rtpCapabilities,
      })
    ) {
      return;
    }

    // Must take the Transport the remote Peer is using for consuming.
    const transport = Array.from(consumerPeer.data.transports.values()).find(
      (t) => (t as MS.Transport<AppData>).appData.consuming
    );

    // This should not happen.
    if (!transport) {
      this._logger.warn(
        "_createConsumer() | Transport for consuming not found"
      );

      return;
    }

    const promises = [];

    const consumerCount = 1 + this._consumerReplicas;

    for (let i = 0; i < consumerCount; i++) {
      promises.push(
        (async () => {
          // Create the Consumer in paused mode.
          try {
            const consumer = await (transport as MS.WebRtcTransport).consume({
              producerId: producer.id,
              rtpCapabilities: consumerPeer.data.rtpCapabilities,
              // Enable NACK for OPUS.
              enableRtx: true,
              paused: true,
            });

            consumerPeer.data.consumers.set(consumer.id, consumer);
            consumer.on("transportclose", () => {
              consumerPeer.data.consumers.delete(consumer.id);
            });

            consumer.on("producerclose", () => {
              consumerPeer.data.consumers.delete(consumer.id);
              consumerPeer
                .notify("consumerClosed", { consumerId: consumer.id })
                .catch(() => {});
            });

            consumer.on("producerpause", () => {
              consumerPeer
                .notify("consumerPaused", { consumerId: consumer.id })
                .catch(() => {});
            });

            consumer.on("producerresume", () => {
              consumerPeer
                .notify("consumerResumed", { consumerId: consumer.id })
                .catch(() => {});
            });

            consumer.on("score", (score) => {
              // this._logger.debug(
              //	 'consumer "score" event [consumerId:%s, score:%o]',
              //	 consumer.id, score);

              consumerPeer
                .notify("consumerScore", { consumerId: consumer.id, score })
                .catch(() => {});
            });

            consumer.on("layerschange", (layers) => {
              consumerPeer
                .notify("consumerLayersChanged", {
                  consumerId: consumer.id,
                  spatialLayer: layers ? layers.spatialLayer : null,
                  temporalLayer: layers ? layers.temporalLayer : null,
                })
                .catch(() => {});
            });

            // NOTE: For testing.
            // await consumer.enableTraceEvent([ 'rtp', 'keyframe', 'nack', 'pli', 'fir' ]);
            // await consumer.enableTraceEvent([ 'pli', 'fir' ]);
            // await consumer.enableTraceEvent([ 'keyframe' ]);

            consumer.on("trace", (trace) => {
              this._logger
                .withMetadata({
                  consumerId: consumer.id,
                  type: trace.type,
                  trace,
                })
                .debug('consumer "trace" event');
            });

            // Send a protoo request to the remote Peer with Consumer parameters.
            try {
              await consumerPeer.request("newConsumer", {
                peerId: producerPeer.id,
                producerId: producer.id,
                id: consumer.id,
                kind: consumer.kind,
                rtpParameters: consumer.rtpParameters,
                type: consumer.type,
                appData: producer.appData,
                producerPaused: consumer.producerPaused,
              });

              // Now that we got the positive response from the remote endpoint, resume
              // the Consumer so the remote endpoint will receive the a first RTP packet
              // of this new stream once its PeerConnection is already ready to process
              // and associate it.
              await consumer.resume();

              consumerPeer
                .notify("consumerScore", {
                  consumerId: consumer.id,
                  score: consumer.score,
                })
                .catch(() => {});
            } catch (error) {
              this._logger.withError(error).error("_createConsumer() | failed");
            }
          } catch (error) {
            this._logger
              .withError(error)
              .warn("_createConsumer() | transport.consume()");
            return;
          }
        })()
      );
    }

    try {
      await Promise.all(promises);
    } catch (error) {
      this._logger.withError(error).error("_createConsumer() | failed");
    }
  }

  /**
   * Creates a mediasoup DataConsumer for the given mediasoup DataProducer.
   *
   * @async
   */
  async _createDataConsumer(
    dataConsumerPeer: protoo.Peer,
    dataProducerPeer: protoo.Peer | null = null, // This is null for the bot DataProducer.
    dataProducer: MS.Producer
  ) {
    // NOTE: Don't create the DataConsumer if the remote Peer cannot consume it.
    if (!dataConsumerPeer.data.sctpCapabilities) return;

    // Must take the Transport the remote Peer is using for consuming.
    const transport = Array.from(
      dataConsumerPeer.data.transports.values()
    ).find((t) => (t as MS.Transport<AppData>).appData.consuming);

    // This should not happen.
    if (!transport) {
      this._logger.warn(
        "_createDataConsumer() | Transport for consuming not found"
      );

      return;
    }

    try {
      const dataConsumer = await (transport as MS.Transport).consumeData({
        dataProducerId: dataProducer.id,
      });
      // Store the DataConsumer into the protoo dataConsumerPeer data Object.
      dataConsumerPeer.data.dataConsumers.set(dataConsumer.id, dataConsumer);

      // Set DataConsumer events.
      dataConsumer.on("transportclose", () => {
        // Remove from its map.
        dataConsumerPeer.data.dataConsumers.delete(dataConsumer.id);
      });

      dataConsumer.on("dataproducerclose", () => {
        // Remove from its map.
        dataConsumerPeer.data.dataConsumers.delete(dataConsumer.id);

        dataConsumerPeer
          .notify("dataConsumerClosed", { dataConsumerId: dataConsumer.id })
          .catch(() => {});
      });

      // Send a protoo request to the remote Peer with Consumer parameters.
      try {
        await dataConsumerPeer.request("newDataConsumer", {
          // This is null for bot DataProducer.
          peerId: dataProducerPeer ? dataProducerPeer.id : null,
          dataProducerId: dataProducer.id,
          id: dataConsumer.id,
          sctpStreamParameters: dataConsumer.sctpStreamParameters,
          label: dataConsumer.label,
          protocol: dataConsumer.protocol,
          appData: dataProducer.appData,
        });
      } catch (error) {
        this._logger.withError(error).error("failed to create data consumer");
      }
    } catch (error) {
      this._logger.withError(error).error("transport.consumeData()");

      return;
    }
  }
}

export default Room;
