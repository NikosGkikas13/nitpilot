#!/usr/bin/env bash
# Turns the hero-light and hero-dark frames (2x, saved by hero.spec.ts) into the landing page's clip
# (src/routes/Landing/clip/): the chat and its side panel only (the inbox column is cropped off at CHAT_LEFT, in CSS
# pixels, which hero.spec.ts prints), plus a poster of the last frame for people who asked for less motion.
# Run from apps/web after the hero-* projects. The video stays 2x so it's sharp on Retina screens.
set -euo pipefail
CHAT_LEFT=${CHAT_LEFT:-360}
CRF=${CRF:-20}
out=src/routes/Landing/clip
mkdir -p "$out"
for theme in light dark; do
  src=demo/out/hero-$theme
  crop="crop=2880-2*$CHAT_LEFT:1520:2*$CHAT_LEFT:0"
  ffmpeg -y -loglevel error -f concat -i "$src/frames.txt" -vf "$crop" -r 30 -fps_mode cfr -an \
    -c:v libx264 -crf "$CRF" -preset slow -tune animation -pix_fmt yuv420p -movflags +faststart "$out/chat-$theme.mp4"
  ffmpeg -y -loglevel error -i "$(ls "$src"/*.jpg | tail -1)" -vf "$crop" -q:v 3 "$out/chat-$theme.jpg"
done
ls -la "$out"
