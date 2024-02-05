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

export const ControlBar = ({
    id,
    isMuted,
    isConnected,
    didScreenShare,
    cameraOn,
}: ControlBarProps) => {
    const [didCopy, setDidCopy] = useState(false);
    const [, copy] = useCopyToClipboard();

    const handleCopy = () => {
        copy(id)
            .then(() => {
                setDidCopy(true);
                console.log("copied!");
            })
            .catch(console.error.bind(console));
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
            {isConnected && (
                <>
                    <div className="flex gap-8">
                        <button
                            className={`btn ${isMuted && "bg-red-500"}`}
                            data-tooltip-id={TS.MUTE}
                            data-tooltip-content={`${isMuted ? "Mute" : "Unmute"} microphone`}
                        >
                            {isMuted ? (
                                <BsMicMute size={28} />
                            ) : (
                                <BsMic size={28} />
                            )}
                        </button>
                        <button
                            className={`btn ${cameraOn && "bg-red-500"}`}
                            data-tooltip-id={TS.CAMERA}
                            data-tooltip-content={`Turn ${cameraOn ? "off" : "on"}`}
                        >
                            {cameraOn ? (
                                <BsCameraVideoOff size={28} />
                            ) : (
                                <BsCameraVideo size={28} />
                            )}
                        </button>
                        <button
                            className={`btn ${didScreenShare && "bg-red-500"}`}
                            data-tooltip-id={TS.SCREENSHARE}
                            data-tooltip-content={`${didScreenShare ? "Stop" : "Start"} screenshare`}
                        >
                            {didScreenShare ? (
                                <LuScreenShareOff size={28} />
                            ) : (
                                <LuScreenShare size={28} />
                            )}
                        </button>
                    </div>
                    <button className="btn bg-red-500">Leave Call</button>
                </>
            )}
        </div>
    );
};
