import { Tooltips } from "@/components/Tooltips";
import { useControlState } from "@/contexts/control-state";
import { useState } from "react";
import { ControlBar } from "./components/ControlBar";
import { Participant } from "./components/Participant";
import { Self } from "./components/Self";
import { peer } from "./peer";

function App() {
    // const [callerId, setCallerId] = useState("");
    const [myStream, setMyStream] = useState<MediaProvider | undefined>(
        undefined,
    );
    const { updateId } = useControlState();

    peer.on("open", (id) => {
        updateId(id);

        navigator.mediaDevices
            .getUserMedia({ audio: true, video: true })
            .then((stream) => {
                window.localStream = stream;
                setMyStream(stream);
            })
            .catch(console.error.bind(console));
    });

    // peer.on("error", (err) => {
    //     console.error(err.type);
    // });

    // peer.on("connection", (conn) => {
    //     conn.on("data", (data) => {
    //         console.log(`got data: ${data}`);
    //     });

    //     conn.on("open", () => {
    //         conn.send("hi!");
    //     });
    // });

    // peer.on("call", async (call) => {
    //     try {
    //         const stream = await navigator.mediaDevices.getUserMedia({
    //             video: true,
    //             audio: true,
    //         });
    //         call.answer(stream);
    //         call.on("stream", render);
    //     } catch (err) {
    //         console.error("failed to get local stream", err);
    //     }
    // });

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
            <div className="flex flex-col full justify-around">
                <h1>Cyborg Coffeehouse</h1>
                <Self stream={myStream} />
                <Participant />
                <ControlBar />
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
