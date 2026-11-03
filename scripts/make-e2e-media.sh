#!/usr/bin/env bash
set -euo pipefail
# Engineering smoke fixture: 30 s sleeping (08), then 15 s howling (07).
clips="${CLIPS_DIR:-$(cd "$(dirname "$0")/../../hack/clips" && pwd)}"
out="${E2E_MEDIA_DIR:-/tmp/lt}"
mkdir -p "$out"
ffmpeg -hide_banner -loglevel error -y -stream_loop -1 -i "$clips/08-sleeping-rem.mp4" -stream_loop -1 -i "$clips/07-howling-husky.mp4" \
  -filter_complex '[0:v]trim=duration=30,setpts=PTS-STARTPTS,scale=640:360:force_original_aspect_ratio=decrease,pad=640:360:(ow-iw)/2:(oh-ih)/2,fps=15,setsar=1[v0];[1:v]trim=duration=15,setpts=PTS-STARTPTS,scale=640:360:force_original_aspect_ratio=decrease,pad=640:360:(ow-iw)/2:(oh-ih)/2,fps=15,setsar=1[v1];[v0][v1]concat=n=2:v=1:a=0[v]' \
  -map '[v]' -pix_fmt yuv420p -f yuv4mpegpipe "$out/seq0807.y4m"
ffmpeg -hide_banner -loglevel error -y -stream_loop -1 -i "$clips/08-sleeping-rem.mp4" -stream_loop -1 -i "$clips/07-howling-husky.mp4" \
  -filter_complex '[0:a]atrim=duration=30,asetpts=PTS-STARTPTS,aresample=48000,aformat=sample_fmts=s16:channel_layouts=mono[a0];[1:a]atrim=duration=15,asetpts=PTS-STARTPTS,aresample=48000,aformat=sample_fmts=s16:channel_layouts=mono[a1];[a0][a1]concat=n=2:v=0:a=1[a]' \
  -map '[a]' -ar 48000 -ac 1 -c:a pcm_s16le "$out/seq0807.wav"
printf 'Fixtures: %s/seq0807.{y4m,wav}\n' "$out"
