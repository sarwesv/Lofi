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

Keyboard shortcuts: `G` to generate, `Space` to play/pause.

## 🚀 Run locally

It's just static files — open `index.html`, or serve the folder:

```bash
python3 -m http.server 8000
# then visit http://localhost:8000
```

## 🌐 Deploy to GitHub Pages

This repo ships with a workflow (`.github/workflows/deploy.yml`) that publishes
the site on every push to the default branch. To enable it:

1. Go to **Settings → Pages**.
2. Under **Build and deployment → Source**, choose **GitHub Actions**.

That's it — your site will be live at `https://<user>.github.io/<repo>/`.

Alternatively, use the classic method: **Settings → Pages → Deploy from a
branch**, pick your branch and the `/ (root)` folder.

## 🧠 How it works

`app.js` builds a deterministic composition plan from a random seed
(`composeTrack`), schedules synthesized voices — electric-piano-style keys,
sub bass, kick/snare/hats — into an `OfflineAudioContext` (`renderTrack`),
runs it through a lo-fi master chain (lowpass "warmth" filter, compression,
convolution reverb, tape hiss + vinyl crackle), then encodes the rendered
`AudioBuffer` to a WAV blob (`audioBufferToWav`).

Made for chilling. 🌙
