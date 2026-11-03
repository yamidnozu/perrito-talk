import { PARAMETERS } from "./evidence-config.js";
import { sensitivityScale } from "./state.js";
const CDN = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.0";
const MODEL =
  "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/int8/1/efficientdet_lite0.tflite";

// Shared by worker and main-thread fallback. Motion/centroid are raw measurements.
export function createVisionEngine({
  sensitivity = "medium",
  config = PARAMETERS,
} = {}) {
  const canvas =
    typeof OffscreenCanvas === "function"
      ? new OffscreenCanvas(96, 54)
      : Object.assign(document.createElement("canvas"), {
          width: 96,
          height: 54,
        });
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  let detector,
    previous,
    previousCenter,
    failure,
    stopped = false;
  const ready = (async () => {
    try {
      const { FilesetResolver, ObjectDetector } = await import(
        `${CDN}/vision_bundle.mjs`
      );
      const files = await FilesetResolver.forVisionTasks(`${CDN}/wasm`, true);
      const loaded = await ObjectDetector.createFromOptions(files, {
        baseOptions: { modelAssetPath: MODEL },
        runningMode: "VIDEO",
        categoryAllowlist: ["dog"],
        scoreThreshold:
          config.presence.detectorScore * sensitivityScale(sensitivity, config),
        maxResults: 1,
      });
      if (stopped) loaded.close();
      else detector = loaded;
    } catch (e) {
      failure = e.message; /* Motion-only mode remains available. */
    }
  })();
  return {
    ready,
    measure(frame, t) {
      let detection;
      try {
        detection = detector
          ?.detectForVideo(frame, t)
          .detections.find((d) =>
            d.categories.some((c) => c.categoryName === "dog"),
          );
      } catch (e) {
        failure = e.message;
        detector?.close();
        detector = null;
      }
      const width = frame.videoWidth || frame.width,
        height = frame.videoHeight || frame.height;
      const box = detection?.boundingBox;
      const clamp = (n) => Math.max(0, Math.min(1, n));
      const bbox = box
        ? [
            clamp(box.originX / width),
            clamp(box.originY / height),
            clamp(box.width / width),
            clamp(box.height / height),
          ]
        : null;
      const center = bbox
        ? [bbox[0] + bbox[2] / 2, bbox[1] + bbox[3] / 2]
        : null;
      const centroidShift =
        center && previousCenter
          ? Math.hypot(
              (center[0] - previousCenter[0]) * width,
              (center[1] - previousCenter[1]) * height,
            ) / Math.hypot(width, height)
          : 0;
      previousCenter = center;
      ctx.drawImage(frame, 0, 0, 96, 54);
      const pixels = ctx.getImageData(0, 0, 96, 54).data;
      const [x, y, w, h] = bbox || [0, 0, 1, 1];
      let sum = 0,
        count = 0;
      // Compare the same pixel positions in both frames, within the current ROI.
      if (previous)
        for (
          let row = Math.floor(y * 54);
          row < Math.min(54, Math.ceil((y + h) * 54));
          row++
        ) {
          for (
            let col = Math.floor(x * 96);
            col < Math.min(96, Math.ceil((x + w) * 96));
            col++
          ) {
            const i = (row * 96 + col) * 4;
            sum +=
              Math.abs(pixels[i] - previous[i]) +
              Math.abs(pixels[i + 1] - previous[i + 1]) +
              Math.abs(pixels[i + 2] - previous[i + 2]);
            count += 3;
          }
        }
      previous = pixels;
      return {
        motion: count ? sum / (count * 255) : 0,
        centroidShift,
        bbox,
        dogPresent: detector ? !!bbox : null,
        dogScore: detection?.categories[0]?.score || 0,
        visionStatus: detector ? "mediapipe" : "fallback",
        visionError: failure,
      };
    },
    stop() {
      stopped = true;
      detector?.close();
      previous = null;
    },
    reset() {
      previous = null;
      previousCenter = null;
    },
  };
}

export function startVision({
  video,
  onFeatures,
  sensitivity,
  config = PARAMETERS,
  fps = 3,
}) {
  let worker,
    engine,
    timer,
    stopped = false,
    busy = false,
    lowBattery = false,
    epoch = 0;
  navigator
    .getBattery?.()
    .then((battery) => {
      lowBattery = !battery.charging && battery.level < 0.2;
    })
    .catch(() => {});
  const main = () => {
    if (!engine && !stopped)
      engine = createVisionEngine({ sensitivity, config });
  };
  if (
    typeof Worker === "function" &&
    typeof OffscreenCanvas === "function" &&
    typeof createImageBitmap === "function"
  ) {
    try {
      worker = new Worker(new URL("./vision-worker.js", import.meta.url), {
        type: "module",
      });
      worker.onmessage = ({ data }) => {
        busy = false;
        if (!stopped && data.epoch === epoch) onFeatures(data.features);
      };
      worker.onerror = () => {
        worker.terminate();
        worker = null;
        busy = false;
        main();
      };
      worker.postMessage({ type: "init", sensitivity, config });
    } catch {
      worker?.terminate();
      worker = null;
      main();
    }
  } else main();
  async function tick() {
    if (stopped) return;
    const currentEpoch = epoch;
    if (!busy && video.readyState >= 2) {
      busy = true;
      try {
        if (worker) {
          const bitmap = await createImageBitmap(video);
          if (stopped || currentEpoch !== epoch || !worker) {
            bitmap.close();
            busy = false;
          } else
            worker.postMessage(
              { type: "frame", bitmap, t: performance.now(), epoch },
              [bitmap],
            );
        } else {
          onFeatures(engine.measure(video, performance.now()));
          busy = false;
        }
      } catch {
        busy = false;
      }
    }
    if (!stopped)
      timer = setTimeout(
        tick,
        1000 /
          (document.hidden
            ? 1
            : lowBattery
              ? 2
              : Math.max(2, Math.min(5, fps))),
      );
  }
  void tick();
  return {
    reset() {
      epoch++;
      engine?.reset();
      worker?.postMessage({ type: "reset" });
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
      worker?.terminate();
      engine?.stop();
    },
  };
}
