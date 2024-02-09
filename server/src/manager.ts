import type { Consumer, Peer, Producer, Transport } from "@/types";

class Manager<T> {
  #data: Record<string, T>;

  constructor() {
    this.#data = {};
  }

  add = (socketId: string, d: T) => {
    this.#data[socketId] = d;
  };

  remove = (socketId: string) => {
    delete this.#data[socketId];
  };
}

export const peerMgr = new Manager<Peer>();
export const transportMgr = new Manager<Transport>();
export const consumerMgr = new Manager<Consumer>();
export const producerMgr = new Manager<Producer>();
