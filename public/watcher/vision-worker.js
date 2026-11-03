import { createVisionEngine } from "./vision.js";
let engine;
self.onmessage = ({ data }) => {
  if (data.type === "init") engine = createVisionEngine(data);
  if (data.type === "reset") engine?.reset();
  if (data.type === "frame") {
    try {
      self.postMessage({
        features: engine.measure(data.bitmap, data.t),
        epoch: data.epoch,
      });
    } finally {
      data.bitmap.close();
    }
  }
};
