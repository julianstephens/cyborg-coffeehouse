import type { ControlState} from "@/contexts/control-state";
import { useControlState } from "@/contexts/control-state";
import { Tooltips as TS } from "@/utils";
import { useEffect, useState } from "react";
import {
    BsCameraVideo,
    BsCameraVideoOff,
    BsMic,
    BsMicMute,
} from "react-icons/bs";
import { LuScreenShare, LuScreenShareOff } from "react-icons/lu";
import { RxCheckCircled, RxCopy } from "react-icons/rx";
import { Tooltip } from "react-tooltip";
import { useCopyToClipboard } from "usehooks-ts";

const delay = (ms: number) => Promise.resolve((res) => setTimeout(res, ms));

export type ControlBarProps = {
    id: string;
    isMuted: boolean;
    didScreenShare: boolean;
    cameraOn: boolean;
    isConnected: boolean;
};

export const ControlBar = () => {
    const { id, state, updateState } = useControlState();
    const [didCopy, setDidCopy] = useState(false);
    const [, copy] = useCopyToClipboard();

    const disabledStyles = () =>
        `${state.isConnected ? "visible cursor-pointer" : "invisible disabled cursor-default"}`;

    const handleCopy = () => {
        copy(id)
            .then(() => {
                setDidCopy(true);
                console.log("copied!");
            })
            .catch(console.error.bind(console));
    };

    const toggle = (key: keyof ControlState) => {
        updateState({ [key]: !state[key] });
    };

    useEffect(() => {
        if (didCopy) {
            delay(3000).then(() => {
                setDidCopy(false);
            });
        }
    }, [didCopy]);

    return (
        <div className="flex justify-between w-full">
            {id && (
                <div className="centered bg-gray-800 w-fit p-2.5 rounded-md">
                    <span className="border-r mr-2 pr-2 border-e-gray-300 ">
                        {id}
                    </span>
                    <button
                        onClick={handleCopy}
                        data-tooltip-id="copy-id"
                        data-tooltip-content={
                            didCopy ? "Copied!" : "Copy my peer ID"
                        }
                    >
                        {didCopy ? (
                            <RxCheckCircled size={18} />
                        ) : (
                            <RxCopy size={18} />
                        )}
                    </button>
                    <Tooltip id="copy-id" />
                </div>
            )}
            <div className="flex gap-8">
                <button
                    onClick={() => toggle("isMuted")}
                    className={`btn ${!state.isMuted && "bg-red-500"}`}
                    data-tooltip-id={TS.MUTE}
                    data-tooltip-content={`${state.isMuted ? "Unmute" : "Mute"} microphone`}
                >
                    {state.isMuted ? (
                        <BsMicMute size={28} />
                    ) : (
                        <BsMic size={28} />
                    )}
                </button>
                <button
                    onClick={() => toggle("cameraOn")}
                    className={`btn ${state.cameraOn && "bg-red-500"}`}
                    data-tooltip-id={TS.CAMERA}
                    data-tooltip-content={`Turn ${state.cameraOn ? "off" : "on"}`}
                >
                    {state.cameraOn ? (
                        <BsCameraVideo size={28} />
                    ) : (
                        <BsCameraVideoOff size={28} />
                    )}
                </button>
                <button
                    onClick={() => toggle("didScreenShare")}
                    className={`btn ${state.didScreenShare && "bg-red-500"} ${disabledStyles()}`}
                    data-tooltip-id={TS.SCREENSHARE}
                    data-tooltip-content={`${state.didScreenShare ? "Stop" : "Start"} screenshare`}
                >
                    {state.didScreenShare ? (
                        <LuScreenShareOff size={28} />
                    ) : (
                        <LuScreenShare size={28} />
                    )}
                </button>
            </div>
            <button
                className={`btn bg-red-500 ${disabledStyles()}`}
                onClick={() => toggle("isConnected")}
            >
                Leave Call
            </button>
        </div>
    );
};
