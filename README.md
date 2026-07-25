# 🎧 Lo-Fi Generator

Randomly generate a lo-fi hip-hop track right in your browser — jazzy chords, a
lazy bassline, dusty boom-bap drums and vinyl crackle — then download it as a
WAV. Everything runs **100% client-side** with the Web Audio API. No servers,
no uploads, no dependencies.

## ✨ Features

- **🎲 Random generation** — every press composes a new track from a seeded
  random arrangement (chord progression, tempo, key, drum pattern, humanized
  swing).
- **🎛️ Moods** — Chill, Sleepy, Jazzy, and Rainy, each with its own tempo range,
  brightness, and crackle amount.
- **⏱️ Adjustable length** — 8 / 16 / 24 / 32 bars.
- **▶ Built-in player** — play / pause, scrub, spinning-vinyl animation.
- **⬇ Download WAV** — the track is rendered offline and encoded to a 16-bit WAV
  you can keep.

## Running

Go to Sarwesv.github.io/Lofi
## 🧠 How it works

`app.js` builds a deterministic composition plan from a random seed
(`composeTrack`), schedules synthesized voices — electric-piano-style keys,
sub bass, kick/snare/hats — into an `OfflineAudioContext` (`renderTrack`),
runs it through a lo-fi master chain (lowpass "warmth" filter, compression,
convolution reverb, tape hiss + vinyl crackle), then encodes the rendered
`AudioBuffer` to a WAV blob (`audioBufferToWav`).

Made for chilling. 🌙
