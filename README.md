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
- **⏱️ Length slider** — drag to pick the track length in minutes (0:30 – 6:00).
- **▶ Built-in player** — play / pause, scrub, GSAP-driven spinning vinyl and
  tonearm.
- **⬇ Download WAV** — the track is rendered offline and encoded to a 16-bit WAV
  you can keep.

Rendering is **near-instant at any length**: one 8-bar loop is rendered once,
then tiled to the requested duration with overlap-add so reverb tails stay
seamless — so a 6-minute track renders as fast as a 30-second one.

Keyboard shortcuts: `G` to generate, `Space` to play/pause.

## Running

Go to [Sarwesv.github.io/Lofi](https://sarwesv.github.io/Lofi)

## 🧠 How it works

`app.js` builds a deterministic composition plan from a random seed
(`composeTrack`), schedules synthesized voices — electric-piano-style keys,
sub bass, kick/snare/hats — for one loop cycle into an `OfflineAudioContext`
(`renderLoop`) through a lo-fi master chain (lowpass "warmth" filter,
compression, convolution reverb). `assembleTrack` then tiles that loop to the
requested length with overlap-add and lays down continuous tape hiss + vinyl
crackle, and `audioBufferToWav` encodes the result to a downloadable WAV.

Animations (page entrance, the spinning record, tonearm drop, drifting stars,
and interaction feedback) are driven by **GSAP** (`gsap.min.js`, vendored
locally so the site stays self-contained).

Made for chilling. 🌙
