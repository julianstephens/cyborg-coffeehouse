import { useControlState } from "@/contexts/control-state";
import { useEffect, useRef } from "react";
import { RiUserLine } from "react-icons/ri";

export const Self = ({ stream }: { stream?: MediaProvider }) => {
    const { updateSelf } = useControlState();
    const selfRef = useRef<HTMLVideoElement>(null);

    useEffect(() => {
        updateSelf(selfRef);
    }, [selfRef]);

    useEffect(() => {
        const selfView = document.getElementById("selfView");
        if (!selfView) return;

        (selfView as HTMLVideoElement).srcObject = stream ?? null;
    }, [stream]);

    return (
        <div className="absolute bottom-80 right-32 bg-gray-800 rounded-md w-60 h-40">
            {stream ? (
                <video
                    ref={selfRef}
                    className="rounded-md"
                    id="selfView"
                    autoPlay
                 />
            ) : (
                <div>
                    <RiUserLine />
                </div>
            )}
        </div>
    );
};
