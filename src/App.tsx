import { Tooltips } from "@/components/Tooltips";
import { useState } from "react";
import { ControlBar } from "./components/ControlBar";
import { peer } from "./peer";
import { render } from "./video-helpers";

function App() {
    // const [callerId, setCallerId] = useState("");
    const [myId, setMyId] = useState("");

    peer.on("open", (id) => {
        setMyId(id);
    });

    peer.on("error", (err) => {
        console.error(err.type);
    });

    peer.on("connection", (conn) => {
        conn.on("data", (data) => {
            console.log(`got data: ${data}`);
        });

        conn.on("open", () => {
            conn.send("hi!");
        });
    });

    peer.on("call", async (call) => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: true,
                audio: true,
            });
            call.answer(stream);
            call.on("stream", render);
        } catch (err) {
            console.error("failed to get local stream", err);
        }
    });

    // const connectToPeer = async (event: React.FormEvent) => {
    //     event.preventDefault();
    //     console.log(`connecting to ${callerId}...`);
    //     const conn = peer.connect(callerId);
    //     conn.on("data", (data) => {
    //         console.log(`got data: ${data}`);
    //     });

    //     conn.on("open", () => {
    //         conn.send("hello!");
    //     });

    //     try {
    //         const stream = await navigator.mediaDevices.getUserMedia({
    //             video: true,
    //             audio: true,
    //         });
    //         const call = peer.call(callerId, stream);
    //         call.on("stream", render);
    //     } catch (err) {
    //         console.error(`failed to get local stream`, err);
    //     }
    // };

    return (
        <>
            <Tooltips />
            <div className="flex flex-col full justify-end">
                <ControlBar
                    id={myId}
                    isMuted
                    isConnected
                    didScreenShare={false}
                    cameraOn={true}
                />
            </div>
            {/* <video id="remoteVideo" autoPlay /> */}
            {/* <hr /> */}
            {/* <form onSubmit={connectToPeer}> */}
            {/*     <input */}
            {/*         type="text" */}
            {/*         onChange={(e) => setCallerId(e.target.value)} */}
            {/*         required */}
            {/*     /> */}
            {/*     <button type="submit">Connect</button> */}
            {/* </form> */}
            {/* <hr /> */}
            {/* <h3>My Peer ID: {myId}</h3> */}
        </>
    );
}

export default App;
