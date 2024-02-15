import type { Peer } from "@/types";

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
