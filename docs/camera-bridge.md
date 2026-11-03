# Camera bridge (prepared; streaming is not implemented)

`POST /api/camera/stream` returns HTTP 501 with `{status:"not_implemented", plan}`.
Workers cannot consume RTSP directly. A LAN device or Raspberry Pi must pull the
camera stream, capture 10–15 second MP4 segments on motion or every N minutes,
and POST normalized media to `/api/analyze` with `source:"camera"`. Optional Muse
realtime support is a later step.

Some Steren camera models commonly expose RTSP / ONVIF, **unverified—check your
specific model**, firmware and vendor documentation. ONVIF availability does not
establish a particular RTSP URL. Do not expose the camera to the internet.

Set `CAM_RTSP_URL` privately (the model-specific URL can contain credentials),
`PERRITO_URL` to the HTTPS application origin, optionally `CAM_LANG=en|es` and
`CAM_INTERVAL_SECONDS=300`. Never commit credentials, enable shell tracing or
publish process listings. Local ffmpeg arguments can be visible to local users.

Example capture command (credentials come from the environment):

```bash
ffmpeg -nostdin -hide_banner -loglevel quiet -rtsp_transport tcp \
  -i "$CAM_RTSP_URL" -t 12 -map 0:v:0 -map '0:a:0?' \
  -vf 'scale=768:768:force_original_aspect_ratio=decrease' \
  -c:v libx264 -b:v 900k -maxrate 1200k -bufsize 2400k \
  -c:a aac -b:a 64k -movflags +faststart clip.mp4 2>/dev/null
```

Run `bash scripts/rtsp-bridge.sh` with those environment variables. Requires
ffmpeg with libx264, curl and Python 3. The sample captures periodically, verifies
the 12 MB MP4 budget, builds the existing base64 JSON contract and sends clips
sequentially. Temporary media and responses are removed; it does not retain a
diary or aggregate summaries. Connect motion events and persist compact readings
with capture timestamps before adding automatic summary calls. The wait interval
starts after capture and analysis, so it is not an exact wall-clock schedule.
