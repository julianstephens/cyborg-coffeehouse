import { nanoid } from "nanoid";
import Peer from "peerjs";

export const peer = new Peer(nanoid());
