export const render = (stream: MediaStream) => {
    const videoEl = document.querySelector("#remoteVideo");
    if (!videoEl) return;

    (videoEl as HTMLVideoElement).srcObject = stream;
};
