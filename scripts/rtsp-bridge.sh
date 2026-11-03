#!/usr/bin/env bash
# Requires bash, ffmpeg, python3 and curl. Never enable shell tracing.
set +x
set -euo pipefail
: "${CAM_RTSP_URL:?Set CAM_RTSP_URL privately}"
: "${PERRITO_URL:?Set PERRITO_URL to your HTTPS PerritoTalk origin}"
[[ "$PERRITO_URL" == https://* ]] || { echo 'PERRITO_URL must use HTTPS.' >&2; exit 1; }
CAM_INTERVAL_SECONDS="${CAM_INTERVAL_SECONDS:-300}"
CAM_LANG="${CAM_LANG:-en}"
[[ "$CAM_INTERVAL_SECONDS" =~ ^[1-9][0-9]*$ ]] || exit 1
[[ "$CAM_LANG" == en || "$CAM_LANG" == es ]] || exit 1
bridge_tmp=$(mktemp -d)
trap 'rm -rf "$bridge_tmp"' EXIT
while true; do
  # Suppress ffmpeg stderr: it may echo the RTSP URL and embedded credentials.
  if ! ffmpeg -nostdin -hide_banner -loglevel quiet -rtsp_transport tcp \
    -i "$CAM_RTSP_URL" -t 12 -map 0:v:0 -map '0:a:0?' \
    -vf 'scale=768:768:force_original_aspect_ratio=decrease' \
    -c:v libx264 -preset veryfast -b:v 900k -maxrate 1200k -bufsize 2400k \
    -c:a aac -b:a 64k -movflags +faststart -y "$bridge_tmp/clip.mp4" 2>/dev/null; then
    echo 'Camera capture failed; check LAN access and model configuration.' >&2
    exit 1
  fi
  python3 - "$bridge_tmp/clip.mp4" "$bridge_tmp/request.json" "$CAM_LANG" <<'PY'
import base64, json, pathlib, sys
clip = pathlib.Path(sys.argv[1]).read_bytes()
if len(clip) > 12 * 1024 * 1024:
    raise SystemExit('Segment exceeds 12 MB; reduce bitrate or duration.')
body = dict(lang=sys.argv[3], source='camera', context={'situation': 'Scheduled LAN camera segment; dog may be alone.'}, media=[dict(kind='video', mime='video/mp4', data_b64=base64.b64encode(clip).decode())])
pathlib.Path(sys.argv[2]).write_text(json.dumps(body))
PY
  # Response goes to a local private temporary file, never stdout/logs.
  curl --silent --fail --max-time 105 --request POST \
    --header 'Content-Type: application/json' --data-binary "@$bridge_tmp/request.json" \
    --output "$bridge_tmp/reading.json" "${PERRITO_URL%/}/api/analyze"
  rm -f "$bridge_tmp/clip.mp4" "$bridge_tmp/request.json" "$bridge_tmp/reading.json"
  sleep "$CAM_INTERVAL_SECONDS"
done
