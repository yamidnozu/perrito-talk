/** Future bridge contract: normalize each 10–15 second MP4 segment and POST
 * {lang, source:"camera", context, media} to /api/analyze. Keep credentials on LAN.
 * Workers cannot consume RTSP directly. No stream connection is opened here.
 */
export interface CameraStreamPlan {
  status: "not_implemented";
  plan: string;
}
export const streamPlan: CameraStreamPlan = {
  status: "not_implemented",
  plan: "Workers cannot consume RTSP directly. A local bridge (ffmpeg on a LAN device/Raspberry Pi) pulls rtsp://user:pass@cam/stream, cuts 10–15 s MP4 segments on motion or every N minutes, normalizes and POSTs them to /api/analyze with source:camera. Optional Muse realtime later. See docs/camera-bridge.md.",
};
