import { handleError, log } from "@/logger";
import Room from "@/services/room";
import type { AppData } from "@/types";
import type { types as MS } from "mediasoup";

class Context {
  room: Room | null = null;
  mediasoupWorkers: MS.Worker<AppData>[] = [];
  nextMediasoupWorkerIdx: number = 0;

  getMediasoupWorker = (): MS.Worker<AppData> => {
    const worker = this.mediasoupWorkers[this.nextMediasoupWorkerIdx];

    if (++this.nextMediasoupWorkerIdx === this.mediasoupWorkers.length)
      this.nextMediasoupWorkerIdx = 0;

    if (!worker) {
      return handleError("unable to get mediasoup worker");
    }

    return worker;
  };

  getRoom = async (consumerReplicas: number) => {
    if (!this.room) {
      log.info("creating cyborg coffeehouse room");
      this.room = await this.#createRoom(consumerReplicas);
    }

    return this.room;
  };

  #createRoom = async (consumerReplicas: number) => {
    const worker = this.getMediasoupWorker();
    // const protooRoom = new protoo.Room();

    // const { mediaCodecs } = config.mediasoup.routerOptions;
    // const mediasoupRouter = await worker.createRouter({});
    // const audioLevelObserver = await mediasoupRouter.createAudioLevelObserver({
    //   maxEntries: 1,
    //   threshold: -80,
    //   interval: 800,
    // });
    // const activeSpeakerObserver = await mediasoupRouter.createActiveSpeakerObserver();

    // const bot = await Bot.create(mediasoupRouter);

    const room = await Room.create(worker, consumerReplicas);
    room.on("close", () => {
      this.room = null;
    });

    return room;
  };
}

export const context = new Context();
