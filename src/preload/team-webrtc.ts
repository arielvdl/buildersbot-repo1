import { type IpcRendererEvent, ipcRenderer } from "electron";

ipcRenderer.once("buildersbot-team-webrtc-port", (event: IpcRendererEvent) => {
  const port = event.ports[0];
  if (!port) throw new Error("The Team WebRTC message port is missing.");
  window.postMessage("buildersbot-team-webrtc-port", "*", [port]);
});
