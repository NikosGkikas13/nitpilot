#!/usr/bin/env bash
# Turns the hero-light and hero-dark recordings into the landing page's clip (src/routes/Landing/clip/): the chat and its side
# panel only (the inbox column is cropped off at CHAT_LEFT, which hero.spec.ts prints), the page load trimmed, plus a
# poster of the last frame for people who asked for less motion. Run from apps/web after the hero-* projects.
set -euo pipefail
CHAT_LEFT=${CHAT_LEFT:-358}
out=src/routes/Landing/clip
mkdir -p "$out"
for theme in light dark; do
  src=demo/out/hero-hero-clip-hero-$theme/video.webm
  crop="crop=1440-$CHAT_LEFT:760:$CHAT_LEFT:0"
  ffmpeg -y -loglevel error -ss 0.8 -i "$src" -vf "$crop" -an -c:v libx264 -crf 26 -preset slow -pix_fmt yuv420p -movflags +faststart "$out/chat-$theme.mp4"
  ffmpeg -y -loglevel error -sseof -1 -i "$src" -vf "$crop" -frames:v 1 -q:v 3 "$out/chat-$theme.jpg"
done
ls -la "$out"
