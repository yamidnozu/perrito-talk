import { PARAMETERS } from "./evidence-config.js";
import { sensitivityScale } from "./state.js";
const CDN = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.0";
const MODEL_BASE =
  "https://storage.googleapis.com/mediapipe-models/object_detector";
// Measured on our clips (AUDIT.md): Lite2 (448 px input) finds small/far dogs that
// Lite0 (320 px) misses, at ~3x the cost; slow devices drop back to Lite0.
export const MODELS = {
  lite2: `${MODEL_BASE}/efficientdet_lite2/int8/1/efficientdet_lite2.tflite`,
  lite0: `${MODEL_BASE}/efficientdet_lite0/int8/1/efficientdet_lite0.tflite`,
};
const MODEL = MODELS.lite2;

let warmed = false;
// Lazy warm-up when the Live tab opens: start the large downloads in parallel so
// the HTTP cache (shared with the worker) is hot before the user presses Start.
export function prewarmModels(extra = []) {
  if (warmed || typeof fetch !== "function") return;
  warmed = true;
  for (const url of [
    `${CDN}/wasm/vision_wasm_module_internal.wasm`,
    MODEL,
    ...extra,
  ])
    fetch(url, { mode: "cors", priority: "low" }).catch(() => {});
}

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
  const makeCanvas = () =>
    typeof OffscreenCanvas === "function"
      ? new OffscreenCanvas(1, 1)
      : document.createElement("canvas");
  const crop = makeCanvas(),
    cropCtx = crop.getContext("2d");
  const P = config.presence;
  let tileIndex = 0,
    lastT = -Infinity;
  let detector,
    previous,
    previousCenter,
    failure,
    stopped = false;
  const animals = config.presence.animalClasses || ["dog"];
  const status = {
    state: "loading",
    delegate: null,
    ms: null,
    error: null,
    model: P.model || "lite2",
  };
  let slowMs = null,
    samples = 0,
    swapping = false;
  const t0 = typeof performance === "object" ? performance.now() : 0;
  let createCpu = null;
  const ready = (async () => {
    try {
      const { FilesetResolver, ObjectDetector } = await import(
        `${CDN}/vision_bundle.mjs`
      );
      const files = await FilesetResolver.forVisionTasks(`${CDN}/wasm`, true);
      createCpu = () => ObjectDetector.createFromOptions(files, options("CPU"));
      const options = (delegate, model = status.model) => ({
        baseOptions: { modelAssetPath: MODELS[model] || MODEL, delegate },
        runningMode: "VIDEO",
        scoreThreshold: Math.min(
          0.9,
          config.presence.detectorScore * sensitivityScale(sensitivity, config),
        ),
        maxResults: 5,
      });
      let loaded;
      // GPU first when available; any delegate failure falls back to CPU (XNNPACK).
      try {
        // Measured: in headless/SwiftShader the GPU delegate loads but returns no detections,
        // so CPU (XNNPACK, ~60 ms/frame at 3 fps) is the default; GPU is opt-in via config.
        if (config.presence.delegate !== "GPU") throw new Error("cpu-default");
        loaded = await ObjectDetector.createFromOptions(files, options("GPU"));
        status.delegate = "GPU";
      } catch {
        loaded = await createCpu();
        status.delegate = "CPU";
      }
      status.state = "ready";
      status.ms = Math.round(performance.now() - t0);
      if (stopped) loaded.close();
      else detector = loaded;
    } catch (e) {
      failure = e.message; /* Motion-only mode remains available. */
      status.state = "failed";
      status.error = e.message;
    }
    return status;
  })();
  return {
    ready,
    measure(frame, t) {
      let detection;
      const width = frame.videoWidth || frame.width,
        height = frame.videoHeight || frame.height;
      ctx.drawImage(frame, 0, 0, 96, 54);
      const pixels = ctx.getImageData(0, 0, 96, 54).data;
      let luma = 0;
      for (let i = 0; i < pixels.length; i += 4)
        luma +=
          0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
      luma /= (pixels.length / 4) * 255;
      const dark = luma < (P.darkLuma ?? 0);
      // VIDEO mode needs strictly increasing timestamps; tiles reuse the frame.
      const stamp = () => (lastT = Math.max(t, lastT + 1));
      const find = (source) =>
        detector
          ?.detectForVideo(source, stamp())
          .detections.find((d) =>
            animals.includes(d.categories[0]?.categoryName),
          );
      // Draw a region (fractions) with an optional low-light boost; returns the canvas.
      const region = ([x, y, w, h]) => {
        crop.width = Math.round(w * width);
        crop.height = Math.round(h * height);
        cropCtx.filter = dark ? P.darkFilter || "none" : "none";
        cropCtx.drawImage(
          frame,
          x * width,
          y * height,
          w * width,
          h * height,
          0,
          0,
          crop.width,
          crop.height,
        );
        return crop;
      };
      const t1 = performance.now();
      try {
        detection = find(dark ? region([0, 0, 1, 1]) : frame);
        // Small/far dogs shrink below EfficientDet's 320 px input: when the full
        // frame finds nothing, check one overlapping tile per frame (rotating).
        const tiles = P.tiles || [];
        if (!detection && detector && tiles.length) {
          const tile = tiles[tileIndex % tiles.length];
          const hit = find(region(tile));
          // Stay on the tile that found the dog; otherwise rotate.
          if (!hit) tileIndex++;
          if (hit) {
            const b = hit.boundingBox,
              sx = (tile[2] * width) / crop.width,
              sy = (tile[3] * height) / crop.height;
            detection = {
              ...hit,
              tile: true,
              boundingBox: {
                originX: tile[0] * width + b.originX * sx,
                originY: tile[1] * height + b.originY * sy,
                width: b.width * sx,
                height: b.height * sy,
              },
            };
          }
        }
      } catch (e) {
        failure = e.message;
        detector?.close();
        detector = null;
        // A GPU delegate can fail only at inference time (mobile WebGL); retry once on CPU.
        if (status.delegate === "GPU" && createCpu) {
          status.delegate = "CPU";
          status.state = "loading";
          createCpu()
            .then((cpu) => {
              if (stopped) return cpu.close();
              detector = cpu;
              failure = undefined;
              status.state = "ready";
            })
            .catch((err) => {
              status.state = "failed";
              status.error = err.message;
            });
        } else status.state = "failed";
      }
      const detectMs = performance.now() - t1;
      // Engineering: if the larger detector is too slow on this device, swap to Lite0.
      if (detector) {
        samples++;
        slowMs = slowMs == null ? detectMs : 0.8 * slowMs + 0.2 * detectMs;
        if (
          status.model !== "lite0" &&
          !swapping &&
          samples >= 5 &&
          slowMs > (P.maxDetectMs ?? Infinity)
        ) {
          swapping = true;
          // setOptions reuses the loaded WASM graph (a second createFromOptions in the
          // same worker fails with "ModuleFactory not set").
          detector
            .setOptions({ baseOptions: { modelAssetPath: MODELS.lite0 } })
            .then(() => {
              status.model = "lite0";
            })
            .catch((e) => (status.swapError = e.message));
        }
      }
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
        dogLabel: detection?.categories[0]?.categoryName || null,
        visionStatus: detector ? "mediapipe" : "fallback",
        lowLight: dark,
        detectMs: Math.round(detectMs),
        detectorModel: status.model,
        dogVia: detection ? (detection.tile ? "tile" : "frame") : null,
        modelStatus: { ...status },
        visionError: failure || status.swapError,
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
