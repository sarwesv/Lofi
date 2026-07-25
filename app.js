/* =========================================================================
   Lo-Fi Generator — procedural lo-fi track generation with the Web Audio API.
   Everything runs client-side: we compose a random arrangement, render it
   offline into an AudioBuffer, then play it back and/or encode it to a WAV.
   ========================================================================= */

"use strict";

/* ----------------------------- Music theory ----------------------------- */

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

// Convert a scientific note (e.g. "A2", "C#4") to a frequency in Hz.
function noteToFreq(note) {
  const m = /^([A-G]#?)(-?\d)$/.exec(note);
  const semitone = NOTE_NAMES.indexOf(m[1]);
  const octave = parseInt(m[2], 10);
  const midi = semitone + (octave + 1) * 12; // MIDI note number
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// Chord interval templates (semitones from root).
const CHORDS = {
  maj7:  [0, 4, 7, 11],
  min7:  [0, 3, 7, 10],
  dom7:  [0, 4, 7, 10],
  min9:  [0, 3, 7, 10, 14],
  maj9:  [0, 4, 7, 11, 14],
  min7b5:[0, 3, 6, 10],
  add9:  [0, 4, 7, 14],
};

// Common jazzy lo-fi progressions, expressed as [scale-degree, quality].
// Scale degrees are semitone offsets from the key root.
const PROGRESSIONS = [
  [[0, "maj7"], [9, "min7"], [5, "maj7"], [7, "dom7"]],        // I - vi - IV - V
  [[2, "min7"], [7, "dom7"], [0, "maj7"], [0, "maj7"]],        // ii - V - I
  [[9, "min7"], [5, "maj7"], [2, "min7"], [7, "dom7"]],        // vi - IV - ii - V
  [[0, "maj9"], [5, "maj7"], [9, "min9"], [7, "dom7"]],        // I - IV - vi - V
  [[2, "min9"], [7, "dom7"], [0, "maj9"], [5, "maj7"]],        // ii - V - I - IV
  [[9, "min7"], [2, "min7"], [7, "dom7"], [0, "maj7"]],        // vi - ii - V - I
  [[0, "maj7"], [4, "min7"], [9, "min7"], [5, "maj7"]],        // I - iii - vi - IV
];

const MOODS = {
  chill:  { bpm: [78, 88], octave: 4, waveMix: "rhodes",  swing: 0.14, crackle: 0.5,  brightness: 2200 },
  sleepy: { bpm: [66, 74], octave: 4, waveMix: "pad",     swing: 0.12, crackle: 0.4,  brightness: 1500 },
  jazzy:  { bpm: [84, 94], octave: 4, waveMix: "rhodes",  swing: 0.2,  crackle: 0.45, brightness: 2600 },
  rainy:  { bpm: [70, 80], octave: 4, waveMix: "pad",     swing: 0.13, crackle: 0.7,  brightness: 1800 },
};

/* ------------------------------- Seeded RNG ------------------------------ */

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ADJ = ["Dusty", "Midnight", "Velvet", "Rainy", "Faded", "Golden", "Lazy", "Neon",
  "Cassette", "Foggy", "Sleepy", "Amber", "Muted", "Drifting", "Quiet", "Warm"];
const NOUN = ["Window", "Coffee", "Tape", "Memory", "Avenue", "Rooftop", "Static", "Dream",
  "Sundown", "Commute", "Study", "Nostalgia", "Vinyl", "Skyline", "Reverie", "Haze"];

function makeTitle(rng) {
  return `${ADJ[Math.floor(rng() * ADJ.length)]} ${NOUN[Math.floor(rng() * NOUN.length)]}`;
}

function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }

/* --------------------------- Composition model --------------------------- */

// Build a plan describing the whole track: tempo, key, chords per bar, and
// which drum hits land where. This is deterministic given the seed.
// `targetMinutes` sets the desired length; bars are derived from the tempo
// and rounded to a whole number of progression loops so it always ends clean.
function composeTrack(seed, moodName, targetMinutes) {
  const rng = mulberry32(seed);
  const mood = MOODS[moodName];

  const bpm = Math.round(mood.bpm[0] + rng() * (mood.bpm[1] - mood.bpm[0]));
  const rootSemitone = Math.floor(rng() * 12);
  const rootName = NOTE_NAMES[rootSemitone];
  const progression = pick(rng, PROGRESSIONS);

  const secPerBeat = 60 / bpm;
  const secPerBar = secPerBeat * 4;

  // We render a short internal loop (two full progression cycles) once, then
  // tile it to reach the requested length. Lofi is loop-based, so this keeps
  // render time constant no matter how many minutes the user asks for.
  const loopBars = progression.length * 2; // e.g. 8 bars
  const loopBody = secPerBar * loopBars;    // seconds of one loop cycle
  const tail = 2.4;                         // reverb/release tail per loop

  const targetSec = Math.max(15, targetMinutes * 60);
  const numLoops = Math.max(1, Math.round(targetSec / loopBody));
  const totalBody = loopBody * numLoops;
  const duration = totalBody + tail;

  // Chords for the bars inside one loop cycle (the progression loops within it).
  const chordBars = [];
  for (let b = 0; b < loopBars; b++) {
    const [degree, quality] = progression[b % progression.length];
    const chordRoot = (rootSemitone + degree) % 12;
    chordBars.push({ rootPc: chordRoot, quality, degree });
  }

  return {
    seed, moodName, mood, bpm,
    loopBars, loopBody, tail, numLoops, totalBody,
    totalBars: loopBars * numLoops,
    rootName, rootSemitone, progression, chordBars,
    secPerBeat, secPerBar,
    duration,
    title: makeTitle(rng),
    rng,
  };
}

/* ---------------------------- Synth voices ------------------------------- */

// A soft electric-piano-ish tone (stacked detuned oscillators + fast decay
// bell partial) with a gentle amplitude envelope.
function playKeys(ctx, dest, freq, t, dur, gainVal, mood) {
  t = Math.max(0, t);
  const out = ctx.createGain();
  out.gain.value = 0;
  out.connect(dest);

  const partials = mood.waveMix === "pad"
    ? [{ type: "triangle", ratio: 1, g: 1 }, { type: "sine", ratio: 2, g: 0.25 }]
    : [{ type: "sine", ratio: 1, g: 1 }, { type: "sine", ratio: 2, g: 0.5 }, { type: "triangle", ratio: 1, g: 0.4 }];

  partials.forEach((p, i) => {
    const osc = ctx.createOscillator();
    osc.type = p.type;
    osc.frequency.value = freq * p.ratio;
    osc.detune.value = (i - 1) * 4; // slight chorus-y spread
    const g = ctx.createGain();
    g.gain.value = p.g;
    osc.connect(g).connect(out);
    osc.start(t);
    osc.stop(t + dur + 0.3);
  });

  const attack = mood.waveMix === "pad" ? 0.08 : 0.012;
  out.gain.setValueAtTime(0, t);
  out.gain.linearRampToValueAtTime(gainVal, t + attack);
  out.gain.exponentialRampToValueAtTime(gainVal * 0.5, t + dur * 0.5);
  out.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.25);
}

function playBass(ctx, dest, freq, t, dur, gainVal) {
  t = Math.max(0, t);
  const osc = ctx.createOscillator();
  const osc2 = ctx.createOscillator();
  osc.type = "sine";
  osc2.type = "triangle";
  osc.frequency.value = freq;
  osc2.frequency.value = freq;
  osc2.detune.value = 6;
  const g = ctx.createGain();
  g.gain.value = 0;
  const g2 = ctx.createGain();
  g2.gain.value = 0.3;
  osc.connect(g);
  osc2.connect(g2).connect(g);
  g.connect(dest);

  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gainVal, t + 0.02);
  g.gain.setValueAtTime(gainVal, t + dur * 0.7);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.start(t); osc2.start(t);
  osc.stop(t + dur + 0.05); osc2.stop(t + dur + 0.05);
}

function makeNoiseBuffer(ctx, seconds) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

function playKick(ctx, dest, t, gainVal) {
  t = Math.max(0, t);
  const osc = ctx.createOscillator();
  osc.type = "sine";
  const g = ctx.createGain();
  osc.connect(g).connect(dest);
  osc.frequency.setValueAtTime(140, t);
  osc.frequency.exponentialRampToValueAtTime(48, t + 0.12);
  g.gain.setValueAtTime(gainVal, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
  osc.start(t); osc.stop(t + 0.3);
}

function playSnare(ctx, dest, noiseBuf, t, gainVal) {
  t = Math.max(0, t);
  const noise = ctx.createBufferSource();
  noise.buffer = noiseBuf;
  const nf = ctx.createBiquadFilter();
  nf.type = "highpass"; nf.frequency.value = 1400;
  const ng = ctx.createGain();
  noise.connect(nf).connect(ng).connect(dest);
  ng.gain.setValueAtTime(gainVal, t);
  ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);

  // Body tone for a softer, dustier snare.
  const osc = ctx.createOscillator();
  osc.type = "triangle"; osc.frequency.value = 190;
  const og = ctx.createGain();
  osc.connect(og).connect(dest);
  og.gain.setValueAtTime(gainVal * 0.5, t);
  og.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);

  noise.start(t); noise.stop(t + 0.2);
  osc.start(t); osc.stop(t + 0.14);
}

function playHat(ctx, dest, noiseBuf, t, gainVal, open) {
  t = Math.max(0, t);
  const noise = ctx.createBufferSource();
  noise.buffer = noiseBuf;
  const hf = ctx.createBiquadFilter();
  hf.type = "highpass"; hf.frequency.value = 7000;
  const g = ctx.createGain();
  noise.connect(hf).connect(g).connect(dest);
  const dur = open ? 0.18 : 0.045;
  g.gain.setValueAtTime(gainVal, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  noise.start(t); noise.stop(t + dur + 0.02);
}

/* --------------------------- Offline rendering --------------------------- */

// Render one loop cycle (plan.loopBars) plus a reverb/release tail. The tail
// lets us overlap-add successive loops so seams are seamless.
async function renderLoop(plan) {
  const sampleRate = 44100;
  const ctx = new OfflineAudioContext(2, Math.ceil((plan.loopBody + plan.tail) * sampleRate), sampleRate);
  const rng = mulberry32(plan.seed ^ 0x9e3779b9);

  // --- master chain: gentle lo-fi lowpass + soft compression + reverb send.
  const master = ctx.createGain();
  master.gain.value = 0.9;

  const lopass = ctx.createBiquadFilter();
  lopass.type = "lowpass";
  lopass.frequency.value = plan.mood.brightness;
  lopass.Q.value = 0.4;

  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -18; comp.knee.value = 24;
  comp.ratio.value = 3; comp.attack.value = 0.01; comp.release.value = 0.25;

  master.connect(lopass).connect(comp).connect(ctx.destination);

  // Simple algorithmic reverb via a generated impulse response.
  const convolver = ctx.createConvolver();
  convolver.buffer = makeImpulseResponse(ctx, 2.2, 2.6);
  const reverbSend = ctx.createGain();
  reverbSend.gain.value = 0.22;
  const reverbReturn = ctx.createGain();
  reverbReturn.gain.value = 0.5;
  reverbSend.connect(convolver).connect(reverbReturn).connect(lopass);

  // Buses
  const musicBus = ctx.createGain();
  musicBus.connect(master);
  musicBus.connect(reverbSend);
  const drumBus = ctx.createGain();
  drumBus.gain.value = 0.9;
  drumBus.connect(master);

  const noiseBuf = makeNoiseBuffer(ctx, 1);

  // --- schedule every bar ---
  const swing = plan.mood.swing;
  const beat = plan.secPerBeat;

  for (let b = 0; b < plan.loopBars; b++) {
    const barStart = b * plan.secPerBar;
    const chord = plan.chordBars[b];
    const intervals = CHORDS[chord.quality];

    // Chord voicing (keys) — hold across the bar, occasionally re-strum mid-bar.
    const strums = rng() < 0.45 ? [0, 2] : [0]; // beat offsets to strum on
    strums.forEach((strumBeat) => {
      const t = barStart + strumBeat * beat + (rng() - 0.5) * 0.01;
      const holdBeats = strums.length > 1 ? 2 : 4;
      intervals.forEach((iv, i) => {
        const midi = chord.rootPc + iv + (plan.mood.octave + 1) * 12;
        const freq = 440 * Math.pow(2, (midi - 69) / 12);
        // Slight arpeggio spread on the strum for a hand-played feel.
        const spread = i * 0.018 * (0.5 + rng());
        playKeys(ctx, musicBus, freq, t + spread, holdBeats * beat, 0.14, plan.mood);
      });
    });

    // Bassline — root on beat 1, plus a passing note (root/fifth/octave).
    const bassMidi = chord.rootPc + (plan.mood.octave - 2 + 1) * 12; // ~2 octaves down
    const bassFreq = 440 * Math.pow(2, (bassMidi - 69) / 12);
    playBass(ctx, musicBus, bassFreq, barStart, beat * 1.5, 0.34);
    if (rng() < 0.7) {
      const passIv = pick(rng, [7, 12, 5]);
      const pf = 440 * Math.pow(2, (bassMidi + passIv - 69) / 12);
      playBass(ctx, musicBus, pf, barStart + beat * 2.5, beat * 1.2, 0.28);
    }

    // --- Drums: classic lo-fi boom-bap with swing on the off-8ths. ---
    // Kick on 1 and the "and" of 2 / beat 3 area (varied).
    playKick(ctx, drumBus, barStart, 0.9);
    if (rng() < 0.85) playKick(ctx, drumBus, barStart + beat * 2.5, 0.75);
    if (rng() < 0.3) playKick(ctx, drumBus, barStart + beat * 3.5, 0.6);

    // Snare on 2 and 4.
    playSnare(ctx, drumBus, noiseBuf, barStart + beat * 1, 0.5);
    playSnare(ctx, drumBus, noiseBuf, barStart + beat * 3, 0.5);

    // Hats on every 8th with swing + humanized velocity; occasional open hat.
    for (let eighth = 0; eighth < 8; eighth++) {
      const isOff = eighth % 2 === 1;
      const swingOffset = isOff ? swing * beta(beat) : 0;
      const t = barStart + eighth * (beat / 2) + swingOffset + (rng() - 0.5) * 0.006;
      const vel = 0.18 * (0.6 + rng() * 0.5) * (isOff ? 0.8 : 1);
      const open = rng() < 0.08 && isOff;
      playHat(ctx, drumBus, noiseBuf, t, vel, open);
    }
  }

  return await ctx.startRendering();
}

// Tile the rendered loop to the requested length using overlap-add so the
// reverb/release tail of each loop flows into the next, then lay continuous
// (non-repeating) tape hiss and vinyl crackle over the whole thing.
function assembleTrack(plan, loopBuf) {
  const sr = loopBuf.sampleRate;
  const totalSamples = Math.ceil(plan.duration * sr);
  const hop = Math.round(plan.loopBody * sr); // advance per loop (body only)
  const chans = [new Float32Array(totalSamples), new Float32Array(totalSamples)];

  for (let k = 0; k < plan.numLoops; k++) {
    const off = k * hop;
    for (let ch = 0; ch < 2; ch++) {
      const src = loopBuf.getChannelData(ch);
      const dst = chans[ch];
      const n = Math.min(src.length, totalSamples - off);
      for (let i = 0; i < n; i++) dst[off + i] += src[i];
    }
  }

  addVinylTexture(chans, sr, plan.mood.crackle);

  // Soft-clip to keep any overlap peaks in bounds, then build the AudioBuffer.
  for (let ch = 0; ch < 2; ch++) {
    const d = chans[ch];
    for (let i = 0; i < d.length; i++) d[i] = Math.tanh(d[i] * 1.05) * 0.96;
  }

  const out = new AudioBuffer({ length: totalSamples, sampleRate: sr, numberOfChannels: 2 });
  out.copyToChannel(chans[0], 0);
  out.copyToChannel(chans[1], 1);
  return out;
}

// JS-generated tape hiss + random vinyl pops written straight into the mix.
// Done in JS (not audio nodes) so it's cheap and never repeats across loops.
function addVinylTexture(chans, sr, amount) {
  const n = chans[0].length;
  const hissGain = 0.006 * amount;
  const popDensity = 0.00035 * amount;
  let lp0 = 0, lp1 = 0; // one-pole smoothing for a warmer hiss
  for (let i = 0; i < n; i++) {
    const h0 = (Math.random() * 2 - 1);
    const h1 = (Math.random() * 2 - 1);
    lp0 += 0.15 * (h0 - lp0);
    lp1 += 0.15 * (h1 - lp1);
    chans[0][i] += lp0 * hissGain;
    chans[1][i] += lp1 * hissGain;

    if (Math.random() < popDensity) {
      // short decaying click across a handful of samples
      const amp = (0.25 + Math.random() * 0.6) * amount * (Math.random() < 0.5 ? -1 : 1);
      const len = 20 + (Math.random() * 60) | 0;
      for (let j = 0; j < len && i + j < n; j++) {
        const env = amp * Math.pow(1 - j / len, 3);
        chans[0][i + j] += env;
        chans[1][i + j] += env * (0.7 + Math.random() * 0.6);
      }
    }
  }
}

// swing helper — proportion of an eighth note to delay off-beats by.
function beta(beatSec) { return beatSec / 2; }

function makeImpulseResponse(ctx, seconds, decay) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const ir = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = ir.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
  }
  return ir;
}

/* ------------------------------ WAV encoder ------------------------------ */

function audioBufferToWav(buffer) {
  const numCh = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const numFrames = buffer.length;
  const bytesPerSample = 2;
  const blockAlign = numCh * bytesPerSample;
  const dataSize = numFrames * blockAlign;
  const bufferSize = 44 + dataSize;

  const arr = new ArrayBuffer(bufferSize);
  const view = new DataView(arr);
  let p = 0;
  const writeStr = (s) => { for (let i = 0; i < s.length; i++) view.setUint8(p++, s.charCodeAt(i)); };
  const writeU32 = (v) => { view.setUint32(p, v, true); p += 4; };
  const writeU16 = (v) => { view.setUint16(p, v, true); p += 2; };

  writeStr("RIFF"); writeU32(36 + dataSize); writeStr("WAVE");
  writeStr("fmt "); writeU32(16); writeU16(1); writeU16(numCh);
  writeU32(sampleRate); writeU32(sampleRate * blockAlign);
  writeU16(blockAlign); writeU16(16);
  writeStr("data"); writeU32(dataSize);

  const channels = [];
  for (let c = 0; c < numCh; c++) channels.push(buffer.getChannelData(c));
  for (let i = 0; i < numFrames; i++) {
    for (let c = 0; c < numCh; c++) {
      let s = Math.max(-1, Math.min(1, channels[c][i]));
      view.setInt16(p, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      p += 2;
    }
  }
  return new Blob([arr], { type: "audio/wav" });
}

/* ------------------------------- UI wiring ------------------------------- */

const els = {
  generate: document.getElementById("generateBtn"),
  play: document.getElementById("playBtn"),
  playIco: document.getElementById("playIco"),
  playLabel: document.getElementById("playLabel"),
  download: document.getElementById("downloadBtn"),
  status: document.getElementById("status"),
  title: document.getElementById("trackTitle"),
  meta: document.getElementById("trackMeta"),
  mood: document.getElementById("moodSelect"),
  length: document.getElementById("lengthRange"),
  lenLabel: document.getElementById("lenLabel"),
  vinyl: document.getElementById("vinyl"),
  progressWrap: document.getElementById("progressWrap"),
  progressBar: document.getElementById("progressBar"),
  curTime: document.getElementById("curTime"),
  totTime: document.getElementById("totTime"),
};

let state = {
  buffer: null,      // rendered AudioBuffer
  plan: null,
  playCtx: null,     // live AudioContext for playback
  source: null,      // BufferSourceNode currently playing
  startedAt: 0,
  offset: 0,
  playing: false,
  rafId: 0,
};

/* ------------------------------ GSAP anims ------------------------------- */
// All motion is driven by GSAP: page entrance, the continuously spinning
// record, the tonearm drop, drifting stars, and interaction feedback.

const anim = {
  spin: null,   // infinite disc-rotation tween (paused when not playing)
  drift: null,  // background star drift
};

function initAnimations() {
  gsap.set(".vinyl-disc", { transformOrigin: "50% 50%" });

  // Record spins forever once started; we play/pause it with playback.
  anim.spin = gsap.to(".vinyl-disc", {
    rotation: 360, duration: 4, ease: "none", repeat: -1,
  });
  anim.spin.pause();

  // Slow parallax drift for the starfield.
  anim.drift = gsap.to(".stars", {
    yPercent: 12, duration: 24, ease: "sine.inOut", repeat: -1, yoyo: true,
  });

  // Entrance timeline.
  gsap.timeline({ defaults: { ease: "power3.out" } })
    .from(".badge", { y: -18, opacity: 0, duration: 0.6 })
    .from("h1", { y: 24, opacity: 0, duration: 0.7 }, "-=0.3")
    .from(".tagline", { y: 18, opacity: 0, duration: 0.6 }, "-=0.4")
    .from(".vinyl", { scale: 0.85, opacity: 0, duration: 0.7, ease: "back.out(1.6)" }, "-=0.3")
    .from(".panel > *", { y: 20, opacity: 0, duration: 0.5, stagger: 0.07 }, "-=0.4");
}

function armDown() {
  gsap.to(".vinyl-arm", { rotation: -8, duration: 0.5, ease: "power2.out" });
}
function armUp() {
  gsap.to(".vinyl-arm", { rotation: -28, duration: 0.5, ease: "power2.inOut" });
}
function spinStart() { anim.spin.play(); armDown(); }
function spinStop() { anim.spin.pause(); armUp(); }

// A quick tactile bounce for the record + a status pop when generating.
function generatePulse() {
  gsap.fromTo(".vinyl", { scale: 0.94 }, { scale: 1, duration: 0.6, ease: "elastic.out(1, 0.5)" });
}
function revealTrack() {
  gsap.fromTo(".now-playing", { opacity: 0.3, y: 8 }, { opacity: 1, y: 0, duration: 0.5, ease: "power2.out" });
}

function fmtTime(s) {
  s = Math.max(0, s);
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function setStatus(msg, cls = "") {
  els.status.textContent = msg;
  els.status.className = "status" + (cls ? " " + cls : "");
}

async function generate() {
  stopPlayback();
  els.generate.disabled = true;
  els.play.disabled = true;
  els.download.disabled = true;
  setStatus("Composing & rendering… 🎛️", "working");
  generatePulse();

  const seed = (Math.random() * 0xffffffff) >>> 0;
  const mood = els.mood.value;
  const minutes = parseFloat(els.length.value);

  // Let the UI paint the "working" state before the heavy render.
  await new Promise((r) => setTimeout(r, 30));

  try {
    const plan = composeTrack(seed, mood, minutes);
    const loopBuf = await renderLoop(plan);
    const buffer = assembleTrack(plan, loopBuf);
    state.buffer = buffer;
    state.plan = plan;
    state.offset = 0;

    els.title.textContent = plan.title;
    els.meta.textContent =
      `${plan.rootName} · ${moodLabel(mood)} · ${plan.bpm} BPM · ${plan.totalBars} bars`;
    els.totTime.textContent = fmtTime(buffer.duration);
    els.curTime.textContent = "0:00";
    els.progressBar.style.width = "0%";

    els.play.disabled = false;
    els.download.disabled = false;
    setStatus("Fresh beat ready — hit play or download. ✨", "done");
    revealTrack();
  } catch (err) {
    console.error(err);
    setStatus("Something went wrong while rendering. Check the console.", "");
  } finally {
    els.generate.disabled = false;
  }
}

function moodLabel(m) { return m.charAt(0).toUpperCase() + m.slice(1); }

function ensurePlayCtx() {
  if (!state.playCtx) {
    state.playCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return state.playCtx;
}

function startPlayback(fromOffset) {
  const ctx = ensurePlayCtx();
  if (ctx.state === "suspended") ctx.resume();
  const src = ctx.createBufferSource();
  src.buffer = state.buffer;
  src.connect(ctx.destination);
  src.onended = () => {
    if (state.source === src && state.playing) {
      // reached the natural end
      stopPlayback();
      els.progressBar.style.width = "100%";
      els.curTime.textContent = fmtTime(state.buffer.duration);
    }
  };
  src.start(0, fromOffset);
  state.source = src;
  state.startedAt = ctx.currentTime - fromOffset;
  state.playing = true;
  els.playIco.textContent = "⏸";
  els.playLabel.textContent = "Pause";
  spinStart();
  tick();
}

function stopPlayback() {
  if (state.source) {
    try { state.source.onended = null; state.source.stop(); } catch (e) {}
    state.source = null;
  }
  state.playing = false;
  els.playIco.textContent = "▶";
  els.playLabel.textContent = "Play";
  spinStop();
  cancelAnimationFrame(state.rafId);
}

function togglePlay() {
  if (!state.buffer) return;
  if (state.playing) {
    // pause: remember offset
    const ctx = state.playCtx;
    state.offset = ctx.currentTime - state.startedAt;
    stopPlayback();
  } else {
    if (state.offset >= state.buffer.duration) state.offset = 0;
    startPlayback(state.offset);
  }
}

function tick() {
  if (!state.playing) return;
  const ctx = state.playCtx;
  const cur = ctx.currentTime - state.startedAt;
  const dur = state.buffer.duration;
  els.progressBar.style.width = `${Math.min(100, (cur / dur) * 100)}%`;
  els.curTime.textContent = fmtTime(cur);
  state.rafId = requestAnimationFrame(tick);
}

function seek(clientX) {
  if (!state.buffer) return;
  const rect = els.progressWrap.getBoundingClientRect();
  const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  const target = ratio * state.buffer.duration;
  state.offset = target;
  els.progressBar.style.width = `${ratio * 100}%`;
  els.curTime.textContent = fmtTime(target);
  if (state.playing) {
    stopPlayback();
    startPlayback(target);
  }
}

function download() {
  if (!state.buffer) return;
  setStatus("Encoding WAV…", "working");
  // Defer so the status paints before the (sync) encode.
  setTimeout(() => {
    const blob = audioBufferToWav(state.buffer);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const safe = state.plan.title.replace(/\s+/g, "_");
    a.href = url;
    a.download = `lofi_${safe}_${state.plan.bpm}bpm.wav`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus("Downloaded! 🎉 Enjoy the vibes.", "done");
  }, 30);
}

/* ------------------------------- Events ---------------------------------- */

function updateLenLabel() {
  els.lenLabel.textContent = fmtTime(parseFloat(els.length.value) * 60);
}
els.length.addEventListener("input", updateLenLabel);
updateLenLabel();

els.generate.addEventListener("click", generate);
els.play.addEventListener("click", togglePlay);
els.download.addEventListener("click", download);
els.progressWrap.addEventListener("click", (e) => seek(e.clientX));

document.addEventListener("keydown", (e) => {
  if (e.code === "Space" && state.buffer) { e.preventDefault(); togglePlay(); }
  if (e.code === "KeyG") generate();
});

// Kick off GSAP animations once everything is parsed.
if (window.gsap) {
  initAnimations();
} else {
  window.addEventListener("load", () => window.gsap && initAnimations());
}
