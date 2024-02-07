import type { ChildrenProps } from "@/types";
import type { RefObject } from "react";
import { createContext, useEffect, useState } from "react";

export type ControlState = {
    isMuted: boolean;
    didScreenShare: boolean;
    cameraOn: boolean;
    isConnected: boolean;
};

export type ControlStateContext = {
    id: string;
    state: ControlState;
    selfRef: RefObject<HTMLVideoElement> | null;
    updateSelf: (ref: RefObject<HTMLVideoElement>) => void;
    updateId: (id: string) => void;
    updateState: (updatedState: Partial<ControlState>) => void;
};

const ControlContext = createContext<ControlStateContext | undefined>(
    undefined,
);

const ControlStateProvider = ({ children }: ChildrenProps) => {
    const [id, setId] = useState("");
    const [selfRef, setSelfRef] = useState<RefObject<HTMLVideoElement> | null>(
        null,
    );
    const [isMuted, setIsMuted] = useState(true);
    const [didScreenShare, setDidScreenShare] = useState(false);
    const [cameraOn, setCameraOn] = useState(false);
    const [isConnected, setIsConnected] = useState(false);

    const updateId = (newId: string) => {
        setId(newId);
    };

    const updateState = (state: Partial<ControlState>) => {
        Object.entries(state).forEach(([k, v]) => {
            if (k === "isMuted") {
                setIsMuted(v);
            }
            if (k === "didScreenShare") {
                setDidScreenShare(v);
            }
            if (k === "cameraOn") {
                if (!v && selfRef?.current?.srcObject) {
                    for (const t of (
                        selfRef.current.srcObject as MediaStream
                    )?.getVideoTracks()) {
                        t.enabled = false;
                        t.stop();
                        t.kind;
                    }
                    selfRef.current.srcObject = null;
                } else {
                    if (selfRef?.current?.srcObject) {
                        selfRef.current.srcObject = window.localStream;
                        for (const t of (
                            selfRef.current.srcObject as MediaStream
                        )?.getVideoTracks()) {
                            t.enabled = true;
                        }
                    }
                }
                setCameraOn(v);
            }
            if (k === "isConnected") {
                setIsConnected(v);
            }
        });
    };

    const updateSelf = (newSelf: RefObject<HTMLVideoElement>) => {
        setSelfRef(newSelf);
    };

    useEffect(() => {
        if (window.localStream) {
            if (
                (selfRef?.current?.srcObject as MediaStream).getVideoTracks()
                    .length > 0 &&
                !cameraOn
            ) {
                setCameraOn(true);
            }
            if (
                (selfRef?.current?.srcObject as MediaStream).getAudioTracks()
                    .length > 0 &&
                !isMuted
            ) {
                setIsMuted(true);
            }
        }
    }, [window.localStream]);

    return (
        <ControlContext.Provider
            value={{
                id,
                selfRef,
                state: {
                    isMuted,
                    didScreenShare,
                    cameraOn,
                    isConnected,
                },
                updateId,
                updateState,
                updateSelf,
            }}
        >
            {children}
        </ControlContext.Provider>
    );
};

export { ControlContext, ControlStateProvider };
