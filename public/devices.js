/**
 * Camera and microphone pickers shared by live mode and "Read my dog".
 * Values: "facing:user" / "facing:environment" (mobile quick options) or a
 * deviceId (used with `exact`). Microphone "" means the system default.
 * Choices persist in localStorage and lists refresh on `devicechange`.
 */
const KEYS = { cam: "perrito-camera", mic: "perrito-mic" };
const isMobile = () =>
  /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ||
  (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));

/** Raw microphone: browser voice processing filters out barks and howls. */
export const RAW_AUDIO = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
};
const HD = { width: { ideal: 1280 }, height: { ideal: 720 } };

/** Pure: getUserMedia video constraints for a picker value. */
export function videoConstraints(value, fallbackFacing = "user") {
  if (!value) return { facingMode: fallbackFacing, ...HD };
  if (value.startsWith("facing:"))
    return { facingMode: { ideal: value.slice(7) }, ...HD };
  return { deviceId: { exact: value }, ...HD };
}
/** Pure: getUserMedia audio constraints (always raw) for a picker value. */
export function audioConstraints(value) {
  return value
    ? { ...RAW_AUDIO, deviceId: { exact: value } }
    : { ...RAW_AUDIO };
}

const load = (k) => {
  try {
    return localStorage.getItem(KEYS[k]) || "";
  } catch {
    return "";
  }
};
const save = (k, v) => {
  try {
    localStorage.setItem(KEYS[k], v);
  } catch {}
};
export const savedCamera = () => load("cam");
export const savedMic = () => load("mic");

const pickers = new Set();
let labelsRequested = false;

async function list() {
  try {
    return await navigator.mediaDevices.enumerateDevices();
  } catch {
    return [];
  }
}

/** Ask briefly for permission so device names become visible, then stop. */
async function unlockLabels() {
  if (labelsRequested) return;
  labelsRequested = true;
  try {
    const s = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true,
    });
    s.getTracks().forEach((t) => t.stop());
  } catch {}
  await refreshDevicePickers();
}

/** Re-render every mounted picker (after permission, devicechange, language). */
export async function refreshDevicePickers() {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  const devices = await list();
  for (const p of pickers) p.render(devices);
}

/**
 * Fills `camSelect` / `micSelect`. `getLang` returns "en" | "es";
 * `defaultFacing` is used for the default option ("user" or "environment").
 * `onCamera(value)` fires when the user changes camera (for hot swap).
 */
export function mountDevicePicker({
  camSelect,
  micSelect,
  getLang,
  defaultFacing = "user",
  onCamera,
}) {
  const tr = (en, es) => (getLang() === "es" ? es : en);
  const option = (value, text) => {
    const o = document.createElement("option");
    o.value = value;
    o.textContent = text;
    return o;
  };
  const picker = {
    render(devices) {
      const cams = devices.filter((d) => d.kind === "videoinput");
      const mics = devices.filter((d) => d.kind === "audioinput");
      const want = load("cam") || camSelect.value;
      const cOpts = [];
      if (isMobile() || !cams.length) {
        cOpts.push(option("facing:user", tr("Front", "Frontal")));
        cOpts.push(option("facing:environment", tr("Back", "Trasera")));
      } else
        cOpts.push(option("", tr("Default camera", "Cámara predeterminada")));
      cams.forEach((d, i) =>
        cOpts.push(
          option(d.deviceId, d.label || `${tr("Camera", "Cámara")} ${i + 1}`),
        ),
      );
      camSelect.replaceChildren(...cOpts);
      const fallback = isMobile() ? `facing:${defaultFacing}` : "";
      camSelect.value = [...camSelect.options].some((o) => o.value === want)
        ? want
        : fallback;
      if (micSelect) {
        const wantMic = load("mic") || micSelect.value;
        micSelect.replaceChildren(
          option("", tr("Default microphone", "Micrófono predeterminado")),
          ...mics
            .filter((d) => d.deviceId && d.deviceId !== "default")
            .map((d, i) =>
              option(
                d.deviceId,
                d.label || `${tr("Microphone", "Micrófono")} ${i + 1}`,
              ),
            ),
        );
        micSelect.value = [...micSelect.options].some(
          (o) => o.value === wantMic,
        )
          ? wantMic
          : "";
      }
      // Names are empty until permission is granted: ask once on first use.
      picker.needsLabels = [...cams, ...mics].some((d) => !d.label);
    },
  };
  pickers.add(picker);
  const unlock = () => {
    if (picker.needsLabels) void unlockLabels();
  };
  for (const el of [camSelect, micSelect].filter(Boolean)) {
    el.addEventListener("pointerdown", unlock);
    el.addEventListener("focus", unlock);
  }
  camSelect.addEventListener("change", () => {
    save("cam", camSelect.value);
    onCamera?.(camSelect.value);
  });
  micSelect?.addEventListener("change", () => save("mic", micSelect.value));
  document.addEventListener("live-language", () => void refreshDevicePickers());
  void refreshDevicePickers();
  return picker;
}

if (navigator.mediaDevices?.addEventListener)
  navigator.mediaDevices.addEventListener(
    "devicechange",
    () => void refreshDevicePickers(),
  );

/**
 * getUserMedia with the picked devices; if a saved deviceId is gone, falls
 * back to the default facing camera / default mic.
 */
export async function openMedia({ camera, mic, video = true, defaultFacing }) {
  const audio = audioConstraints(mic);
  try {
    return await navigator.mediaDevices.getUserMedia({
      video: video ? videoConstraints(camera, defaultFacing) : false,
      audio,
    });
  } catch (e) {
    if (!["OverconstrainedError", "NotFoundError"].includes(e.name)) throw e;
    return navigator.mediaDevices.getUserMedia({
      video: video ? { facingMode: defaultFacing || "user", ...HD } : false,
      audio: { ...RAW_AUDIO },
    });
  } finally {
    void refreshDevicePickers();
  }
}
