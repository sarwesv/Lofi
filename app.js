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
function buildSections(totalBars) {
  const sections = [];
  const introBars = totalBars >= 16 ? 4 : 2;
  const outroBars = totalBars >= 16 ? 4 : 2;

  for (let b = 0; b < totalBars; b++) {
    if (b < introBars) {
      sections.push("intro");
    } else if (b >= totalBars - outroBars) {
      sections.push("outro");
    } else {
      const bodyIndex = b - introBars;
      const cycle = bodyIndex % 16;
      if (cycle < 4) {
        sections.push("groove");
      } else if (cycle < 8) {
        sections.push("variation");
      } else if (cycle < 12) {
        sections.push("breakdown");
      } else {
        sections.push("peak");
      }
    }
  }
  return sections;
}

function composeTrack(seed, moodName, targetMinutes) {
  const rng = mulberry32(seed);
  const mood = MOODS[moodName];

  const bpm = Math.round(mood.bpm[0] + rng() * (mood.bpm[1] - mood.bpm[0]));
  const rootSemitone = Math.floor(rng() * 12);
  const rootName = NOTE_NAMES[rootSemitone];
  const progression = pick(rng, PROGRESSIONS);

  const secPerBeat = 60 / bpm;
  const secPerBar = secPerBeat * 4;

  const targetSec = Math.max(15, targetMinutes * 60);
  const totalBars = Math.max(8, Math.ceil(targetSec / secPerBar));
  const totalBody = totalBars * secPerBar;
  const tail = 3.0;
  const duration = totalBody + tail;

  const chordBars = [];
  for (let b = 0; b < totalBars; b++) {
    const [degree, quality] = progression[b % progression.length];
    const chordRoot = (rootSemitone + degree) % 12;
    chordBars.push({ rootPc: chordRoot, quality, degree, barIndex: b });
  }

  const sections = buildSections(totalBars);

  return {
    seed, moodName, mood, bpm,
    totalBars, totalBody, tail, duration,
    rootName, rootSemitone, progression, chordBars, sections,
    secPerBeat, secPerBar,
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

// Render the entire track performance dynamically across sections with human
// micro-timing, J Dilla snare layback, ghost snares, turnaround drum fills,
// pentatonic keys embellishments, and analog tape pitch wobble.
async function renderFullTrack(plan) {
  const sampleRate = 44100;
  const totalSamples = Math.ceil(plan.duration * sampleRate);
  const ctx = new OfflineAudioContext(2, totalSamples, sampleRate);
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

  // Algorithmic reverb
  const convolver = ctx.createConvolver();
  convolver.buffer = makeImpulseResponse(ctx, 2.2, 2.6);
  const reverbSend = ctx.createGain();
  reverbSend.gain.value = 0.24;
  const reverbReturn = ctx.createGain();
  reverbReturn.gain.value = 0.5;
  reverbSend.connect(convolver).connect(reverbReturn).connect(lopass);

  // Analog Tape Wow & Flutter (subtle vibrato on music bus)
  const delayNode = ctx.createDelay(0.05);
  delayNode.delayTime.value = 0.005;
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.38 + rng() * 0.12;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 0.00032; // ~0.12% pitch drift
  lfo.connect(lfoGain).connect(delayNode.delayTime);
  lfo.start(0);

  // Buses
  const musicBus = ctx.createGain();
  musicBus.connect(delayNode).connect(master);
  musicBus.connect(reverbSend);

  const drumBus = ctx.createGain();
  drumBus.gain.value = 0.92;
  drumBus.connect(master);

  const noiseBuf = makeNoiseBuffer(ctx, 1);
  const swing = plan.mood.swing;
  const beat = plan.secPerBeat;
  const pentatonicScale = [0, 2, 4, 7, 9, 12, 14];

  for (let b = 0; b < plan.totalBars; b++) {
    const barStart = b * plan.secPerBar;
    const chord = plan.chordBars[b];
    const section = plan.sections[b];
    const intervals = CHORDS[chord.quality];

    // --- KEYS & HARMONY ---
    const strums = (section === "intro" || section === "outro")
      ? [0]
      : (rng() < 0.4 ? [0, 2] : [0]);

    strums.forEach((strumBeat) => {
      const t = barStart + strumBeat * beat + (rng() - 0.5) * 0.012;
      const holdBeats = strums.length > 1 ? 2 : 4;
      intervals.forEach((iv, i) => {
        const midi = chord.rootPc + iv + (plan.mood.octave + 1) * 12;
        const freq = 440 * Math.pow(2, (midi - 69) / 12);
        const spread = i * 0.015 * (0.6 + rng() * 0.8);
        const gainMult = (section === "intro" || section === "outro") ? 0.11 : 0.14;
        playKeys(ctx, musicBus, freq, t + spread, holdBeats * beat, gainMult, plan.mood);
      });
    });

    // Soft melody grace notes on keys in variation/peak sections
    if ((section === "variation" || section === "peak") && rng() < 0.4) {
      const melBeat = pick(rng, [1.5, 2.5, 3.25]);
      const melDegree = pick(rng, pentatonicScale);
      const melMidi = chord.rootPc + melDegree + (plan.mood.octave + 2) * 12;
      const melFreq = 440 * Math.pow(2, (melMidi - 69) / 12);
      const melTime = barStart + melBeat * beat + (rng() - 0.5) * 0.01;
      playKeys(ctx, musicBus, melFreq, melTime, beat * 0.8, 0.09, plan.mood);
    }

    // --- SUB BASS ---
    const bassMidi = chord.rootPc + (plan.mood.octave - 2 + 1) * 12;
    const bassFreq = 440 * Math.pow(2, (bassMidi - 69) / 12);
    const bassVol = (section === "intro" || section === "outro") ? 0.24 : 0.35;
    playBass(ctx, musicBus, bassFreq, barStart + (rng() - 0.5) * 0.005, beat * 1.6, bassVol);

    if (section !== "intro" && section !== "outro" && rng() < 0.65) {
      const passIv = pick(rng, [7, 12, 5]);
      const pf = 440 * Math.pow(2, (bassMidi + passIv - 69) / 12);
      const passTime = barStart + beat * (rng() < 0.5 ? 2.5 : 3.5) + (rng() - 0.5) * 0.008;
      playBass(ctx, musicBus, pf, passTime, beat * 1.1, 0.26);
    }

    // --- DRUMS (Boom-Bap with J Dilla Layback & Dynamic Variation) ---
    const hasDrums = section !== "intro" && section !== "outro";
    if (hasDrums) {
      const isBreakdown = section === "breakdown";
      const isPeak = section === "peak";

      // 1. Kick Drums
      const kickVol = isBreakdown ? 0.6 : 0.9;
      playKick(ctx, drumBus, barStart + (rng() - 0.5) * 0.005, kickVol);

      if (!isBreakdown) {
        if (rng() < 0.82) {
          const syncKickT = barStart + beat * 2.5 + (rng() < 0.5 ? 0.010 : -0.006) + (rng() - 0.5) * 0.006;
          playKick(ctx, drumBus, syncKickT, 0.76);
        }
        if (rng() < 0.32) {
          const syncKick2T = barStart + beat * 3.5 + (rng() - 0.5) * 0.008;
          playKick(ctx, drumBus, syncKick2T, 0.62);
        }
      }

      // 2. Snares (Beat 2 & 4 with J Dilla Layback + Ghost Snares)
      const snareLayback = 0.014 + (rng() - 0.5) * 0.006; // 11ms to 17ms behind grid
      const snare1Vel = 0.45 + (rng() - 0.5) * 0.08;
      const snare2Vel = 0.48 + (rng() - 0.5) * 0.08;

      playSnare(ctx, drumBus, noiseBuf, barStart + beat * 1 + snareLayback, snare1Vel);
      playSnare(ctx, drumBus, noiseBuf, barStart + beat * 3 + snareLayback, snare2Vel);

      // Ghost Snares (soft offbeat taps)
      if ((section === "variation" || isPeak || rng() < 0.3) && rng() < 0.5) {
        const ghostPositions = pick(rng, [[1.75], [3.75], [1.75, 3.75]]);
        ghostPositions.forEach((gBeat) => {
          const gt = barStart + gBeat * beat + (rng() - 0.5) * 0.008;
          const gVel = 0.09 + rng() * 0.08;
          playSnare(ctx, drumBus, noiseBuf, gt, gVel);
        });
      }

      // 3. Hi-Hats (Swing + Hand Accent Curve + Micro-jitter)
      const hatBaseVol = isBreakdown ? 0.11 : 0.18;
      const accentCurve = [1.0, 0.5, 0.8, 0.45, 0.9, 0.55, 0.75, 0.4];

      for (let eighth = 0; eighth < 8; eighth++) {
        const isOff = eighth % 2 === 1;
        const swingOffset = isOff ? swing * beta(beat) : 0;
        const microJitter = (rng() - 0.5) * 0.008;
        const t = barStart + eighth * (beat / 2) + swingOffset + microJitter;
        const vel = hatBaseVol * accentCurve[eighth] * (0.8 + rng() * 0.4);
        const open = rng() < 0.07 && isOff && !isBreakdown;
        playHat(ctx, drumBus, noiseBuf, t, vel, open);
      }

      // Turnaround Drum Fills on bar 4/8/12...
      const isTurnaround = (b + 1) % 4 === 0;
      if (isTurnaround && rng() < 0.65 && !isBreakdown) {
        const fillType = pick(rng, ["hatRoll", "doubleKick", "ghostSnare"]);
        if (fillType === "hatRoll") {
          [3.25, 3.5, 3.75].forEach((hBeat, idx) => {
            const ht = barStart + hBeat * beat + (rng() - 0.5) * 0.004;
            playHat(ctx, drumBus, noiseBuf, ht, 0.10 + idx * 0.03, false);
          });
        } else if (fillType === "doubleKick") {
          playKick(ctx, drumBus, barStart + beat * 3.75, 0.65);
        } else if (fillType === "ghostSnare") {
          playSnare(ctx, drumBus, noiseBuf, barStart + beat * 3.75, 0.20);
        }
      }
    } else if (section === "intro" || section === "outro") {
      // Gentle soft hat in intro/outro for subtle pulse
      for (let eighth = 0; eighth < 8; eighth += 2) {
        const t = barStart + eighth * (beat / 2) + (rng() - 0.5) * 0.008;
        playHat(ctx, drumBus, noiseBuf, t, 0.06 + rng() * 0.03, false);
      }
    }
  }

  return await ctx.startRendering();
}

function assembleTrack(plan, rawBuf) {
  const sr = rawBuf.sampleRate;
  const totalSamples = rawBuf.length;
  const chans = [new Float32Array(totalSamples), new Float32Array(totalSamples)];

  for (let ch = 0; ch < 2; ch++) {
    const src = rawBuf.getChannelData(ch);
    const dst = chans[ch];
    for (let i = 0; i < totalSamples; i++) dst[i] = src[i];
  }

  addVinylTexture(chans, sr, plan.mood.crackle);

  // Soft-clip output
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
  const scratch = new Float32Array(n); // reused per channel for the click layer

  // Density scales a little with sample rate so the crackle rate is consistent.
  const k = sr / 44100;
  const fineDensity = 0.0022 * amount * k;  // constant fizz of tiny clicks
  const popDensity  = 0.00004 * amount * k; // rare, louder dust pops

  // Each channel gets its own click layer so the crackle spreads across the
  // stereo field like a real record instead of sitting dead-center.
  for (let ch = 0; ch < 2; ch++) {
    const dst = chans[ch];
    scratch.fill(0);

    for (let i = 0; i < n; i++) {
      // Fine crackle: many tiny, very short events -> a gentle continuous bed.
      if (Math.random() < fineDensity) {
        const r = Math.random();
        const amp = r * r * 0.05 * (Math.random() < 0.5 ? -1 : 1); // mostly tiny
        const len = 2 + (Math.random() * 5 | 0);
        for (let j = 0; j < len && i + j < n; j++) scratch[i + j] += amp * (1 - j / len);
      }
      // Dust pops: sparse, a bit longer and louder, but still short (~ms).
      if (Math.random() < popDensity) {
        const amp = (0.06 + Math.random() * 0.16) * (Math.random() < 0.5 ? -1 : 1);
        const len = 5 + (Math.random() * 14 | 0);
        for (let j = 0; j < len && i + j < n; j++) {
          const t = 1 - j / len;
          scratch[i + j] += amp * t * t;
        }
      }
    }

    // One-pole high-pass (~280 Hz): turns each little step into a crisp,
    // DC-free bipolar click and strips the low-frequency thump that made the
    // old pops sound like knocks rather than surface noise.
    let y = 0, xPrev = 0;
    for (let i = 0; i < n; i++) {
      const x = scratch[i];
      y = 0.96 * (y + x - xPrev);
      xPrev = x;
      dst[i] += y;
    }
  }

  // Surface hiss: white noise high-passed for an airy floor (not the muffled
  // rumble a low-pass produced before), independent per channel.
  const hissGain = 0.004 * amount;
  let yL = 0, xL = 0, yR = 0, xR = 0;
  for (let i = 0; i < n; i++) {
    const wL = Math.random() * 2 - 1;
    const wR = Math.random() * 2 - 1;
    yL = 0.85 * (yL + wL - xL); xL = wL;
    yR = 0.85 * (yR + wR - xR); xR = wR;
    chans[0][i] += yL * hissGain;
    chans[1][i] += yR * hissGain;
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
  moodDropdown: document.getElementById("moodDropdown"),
  moodTrigger: document.getElementById("moodTrigger"),
  moodMenu: document.getElementById("moodMenu"),
  moodCurrent: document.getElementById("moodCurrent"),
  minInput: document.getElementById("minInput"),
  secInput: document.getElementById("secInput"),
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
  startLegoAnimationLoop();

  const seed = (Math.random() * 0xffffffff) >>> 0;
  const mood = els.moodDropdown.dataset.value;
  const minutes = getRequestedMinutes();

  // Let the UI paint the "working" state before the heavy render.
  await new Promise((r) => setTimeout(r, 60));

  try {
    const plan = composeTrack(seed, mood, minutes);
    const rawBuf = await renderFullTrack(plan);
    const buffer = assembleTrack(plan, rawBuf);
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
    stopLegoAnimationLoop();
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

/* ------------------------------- Time Inputs ----------------------------- */

function getRequestedMinutes() {
  let mins = parseInt(els.minInput.value, 10);
  let secs = parseInt(els.secInput.value, 10);
  if (isNaN(mins) || mins < 0) mins = 0;
  if (isNaN(secs) || secs < 0) secs = 0;

  if (secs >= 60) {
    mins += Math.floor(secs / 60);
    secs = secs % 60;
    els.minInput.value = mins;
    els.secInput.value = secs.toString().padStart(2, "0");
  }

  const totalSec = mins * 60 + secs;
  const clampedSec = Math.max(15, Math.min(3600, totalSec));
  return clampedSec / 60;
}

function sanitizeTimeInputs() {
  let mins = parseInt(els.minInput.value, 10);
  let secs = parseInt(els.secInput.value, 10);

  if (isNaN(mins) || mins < 0) mins = 0;
  if (mins > 60) mins = 60;

  if (isNaN(secs) || secs < 0) secs = 0;
  if (secs >= 60) {
    mins += Math.floor(secs / 60);
    secs = secs % 60;
    if (mins > 60) mins = 60;
  }

  els.minInput.value = mins;
  els.secInput.value = secs.toString().padStart(2, "0");
}

els.minInput.addEventListener("blur", sanitizeTimeInputs);
els.secInput.addEventListener("blur", sanitizeTimeInputs);

/* ---------------------- Custom themed mood dropdown ---------------------- */

function openMood() {
  els.moodDropdown.classList.add("open");
  els.moodTrigger.setAttribute("aria-expanded", "true");
}
function closeMood() {
  els.moodDropdown.classList.remove("open");
  els.moodTrigger.setAttribute("aria-expanded", "false");
}
function selectMood(value, label) {
  els.moodDropdown.dataset.value = value;
  els.moodCurrent.textContent = label;
  els.moodMenu.querySelectorAll(".dd-opt").forEach((o) =>
    o.classList.toggle("selected", o.dataset.value === value));
}

els.moodTrigger.addEventListener("click", (e) => {
  e.stopPropagation();
  els.moodDropdown.classList.contains("open") ? closeMood() : openMood();
});
els.moodMenu.querySelectorAll(".dd-opt").forEach((opt) => {
  opt.addEventListener("click", () => {
    selectMood(opt.dataset.value, opt.textContent);
    closeMood();
  });
});
document.addEventListener("click", (e) => {
  if (!els.moodDropdown.contains(e.target)) closeMood();
});

els.generate.addEventListener("click", generate);
els.play.addEventListener("click", togglePlay);
els.download.addEventListener("click", download);
els.progressWrap.addEventListener("click", (e) => seek(e.clientX));

document.addEventListener("keydown", (e) => {
  if (e.code === "Escape") closeMood();
  if (e.code === "Space" && state.buffer) { e.preventDefault(); togglePlay(); }
  if (e.code === "KeyG") generate();
});

// Kick off GSAP animations once everything is parsed.
if (window.gsap) {
  initAnimations();
} else {
  window.addEventListener("load", () => window.gsap && initAnimations());
}

/* ---------------- 2x2 Isometric Lego Wave Terrain Renderer -------------- */

const LEGO_PALETTES = {
  blue:   { name: "blue",   top: "#0055BF", left: "#004099", right: "#002E73", studTop: "#2B7FFF", studSide: "#004099" },
  yellow: { name: "yellow", top: "#FFD700", left: "#D4B200", right: "#A88E00", studTop: "#FFE44D", studSide: "#D4B200" },
  red:    { name: "red",    top: "#E3000B", left: "#B80008", right: "#8C0005", studTop: "#FF2E36", studSide: "#B80008" },
};

const legoState = {
  active: false,
  canvas: null,
  ctx: null,
  bricks: [],
  noiseTime: 0,
  rafId: 0,
  timeline: null,
};

function initLegoCanvas() {
  legoState.canvas = document.getElementById("legoCanvas");
  if (legoState.canvas) {
    legoState.ctx = legoState.canvas.getContext("2d");
  }
}

// Render a 2.5D Isometric 2x2 Lego Brick with 4 studs
function draw2x2LegoBrick(ctx, x, y, size, brickH, palette, scale = 1, alpha = 1) {
  if (alpha <= 0.01 || scale <= 0.01) return;

  // Guard against missing palette
  const pal = (palette && palette.top) ? palette : LEGO_PALETTES.blue;

  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.globalAlpha = alpha;

  const w = size;
  const h = size * 0.5;
  const bh = brickH;

  // Top Face (Rhombus)
  ctx.beginPath();
  ctx.moveTo(0, -h);
  ctx.lineTo(w, 0);
  ctx.lineTo(0, h);
  ctx.lineTo(-w, 0);
  ctx.closePath();
  ctx.fillStyle = pal.top;
  ctx.fill();
  ctx.strokeStyle = "rgba(0, 0, 0, 0.06)";
  ctx.lineWidth = 0.8;
  ctx.stroke();

  // Left Face
  ctx.beginPath();
  ctx.moveTo(-w, 0);
  ctx.lineTo(0, h);
  ctx.lineTo(0, h + bh);
  ctx.lineTo(-w, bh);
  ctx.closePath();
  ctx.fillStyle = pal.left;
  ctx.fill();
  ctx.stroke();

  // Right Face
  ctx.beginPath();
  ctx.moveTo(0, h);
  ctx.lineTo(w, 0);
  ctx.lineTo(w, bh);
  ctx.lineTo(0, h + bh);
  ctx.closePath();
  ctx.fillStyle = pal.right;
  ctx.fill();
  ctx.stroke();

  // Draw 4 Studs on top of 2x2 Brick
  const studR = w * 0.22;
  const studH = 4;
  const studOffsets = [
    { x: 0,        y: -h * 0.48 }, // top
    { x: -w * 0.48, y: 0 },        // left
    { x: w * 0.48,  y: 0 },        // right
    { x: 0,        y: h * 0.48 },  // bottom
  ];

  studOffsets.forEach((off) => {
    const sx = off.x;
    const sy = off.y - h * 0.08;

    // Stud Side Cylinder
    ctx.beginPath();
    ctx.ellipse(sx, sy, studR, studR * 0.5, 0, 0, Math.PI);
    ctx.lineTo(sx - studR, sy - studH);
    ctx.ellipse(sx, sy - studH, studR, studR * 0.5, 0, Math.PI, 0, true);
    ctx.closePath();
    ctx.fillStyle = pal.studSide;
    ctx.fill();

    // Stud Top Cap
    ctx.beginPath();
    ctx.ellipse(sx, sy - studH, studR, studR * 0.5, 0, 0, Math.PI * 2);
    ctx.fillStyle = pal.studTop;
    ctx.fill();

    // Stud Highlight Ring
    ctx.beginPath();
    ctx.ellipse(sx, sy - studH, studR * 0.65, studR * 0.32, 0, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.4)";
    ctx.lineWidth = 0.8;
    ctx.stroke();
  });

  ctx.restore();
}

// Map layer elevation height to classic Lego color strata (Blue -> Yellow -> Red)
function getStrataPalette(l) {
  if (l <= 1) return LEGO_PALETTES.blue;
  if (l <= 3) return LEGO_PALETTES.yellow;
  return LEGO_PALETTES.red;
}

// Generate smooth Perlin-guided wave terrain grid
function generateLegoWaveGrid(noiseOffset) {
  const targets = [];
  const gridW = 12;
  const gridH = 12;
  const tileW = 16;
  const tileH = 8;
  const brickH = 11;

  for (let gx = 0; gx < gridW; gx++) {
    for (let gy = 0; gy < gridH; gy++) {
      let n = 0;
      if (window.Perlin) {
        n = window.Perlin.noise3D(gx * 0.18, gy * 0.18, noiseOffset);
      } else {
        n = Math.sin(gx * 0.4 + noiseOffset) * Math.cos(gy * 0.4 + noiseOffset);
      }

      // Smooth height levels (1 to 5 layers) creating continuous wave curves
      const height = Math.floor((n + 1) * 0.5 * 4.5) + 1;

      for (let l = 0; l < height; l++) {
        const isoX = (gx - gy) * tileW;
        const isoY = (gx + gy) * tileH - l * (brickH - 1.5);
        const pal = getStrataPalette(l);

        targets.push({
          id: `${gx}_${gy}_${l}`,
          gx, gy, l,
          targetIsoX: isoX,
          targetIsoY: isoY,
          palette: pal,
        });
      }
    }
  }

  return targets;
}

function startLegoAnimationLoop() {
  if (!legoState.canvas) initLegoCanvas();
  if (!legoState.ctx) return;

  legoState.active = true;
  document.body.classList.add("lego-loading");
  const overlay = document.getElementById("legoOverlay");
  if (overlay) overlay.classList.add("active");

  const canvas = legoState.canvas;
  const ctx = legoState.ctx;
  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2 + 40;

  legoState.noiseTime = Math.random() * 100;
  const targets = generateLegoWaveGrid(legoState.noiseTime);

  legoState.bricks = targets.map((t) => {
    return {
      id: t.id,
      gx: t.gx,
      gy: t.gy,
      l: t.l,
      isoX: t.targetIsoX,
      isoY: t.targetIsoY - 260 - Math.random() * 100,
      targetIsoX: t.targetIsoX,
      targetIsoY: t.targetIsoY,
      palette: t.palette,
      scale: 0.1,
      alpha: 0,
    };
  });

  if (window.gsap) {
    legoState.timeline = gsap.timeline();
    legoState.bricks.forEach((b, i) => {
      legoState.timeline.to(b, {
        isoY: b.targetIsoY,
        scale: 1,
        alpha: 1,
        duration: 0.65 + Math.random() * 0.2,
        ease: "back.out(1.4)",
      }, (b.gx + b.gy) * 0.03 + b.l * 0.04);
    });

    legoState.timeline.add(() => {
      if (legoState.active) {
        morphLegoStructure();
      }
    }, "+=1.0");
  }

  function renderFrame() {
    if (!legoState.active) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Sort bricks strictly back-to-front and bottom-to-top
    const sorted = [...legoState.bricks].sort((a, b) => {
      if (a.l !== b.l) return a.l - b.l;
      return (a.gx + a.gy) - (b.gx + b.gy);
    });

    sorted.forEach((b) => {
      draw2x2LegoBrick(ctx, centerX + b.isoX, centerY + b.isoY, 16, 11, b.palette, b.scale, b.alpha);
    });

    legoState.rafId = requestAnimationFrame(renderFrame);
  }

  renderFrame();
}

function morphLegoStructure() {
  if (!legoState.active || !window.gsap) return;

  legoState.noiseTime += 0.5;
  const newTargets = generateLegoWaveGrid(legoState.noiseTime);
  const targetMap = new Map(newTargets.map(t => [t.id, t]));

  const morphTl = gsap.timeline();

  legoState.bricks.forEach((b) => {
    const nt = targetMap.get(b.id);
    if (nt) {
      morphTl.to(b, {
        isoY: nt.targetIsoY,
        duration: 0.9 + Math.random() * 0.3,
        ease: "sine.inOut",
      }, (b.gx + b.gy) * 0.02);
    } else {
      // Brick recedes if height shrank
      morphTl.to(b, {
        alpha: 0,
        scale: 0.2,
        duration: 0.4,
        ease: "power2.in",
      }, 0);
    }
  });

  // Spawn new bricks for columns that grew
  newTargets.forEach((nt) => {
    if (!legoState.bricks.some(b => b.id === nt.id)) {
      const newB = {
        id: nt.id,
        gx: nt.gx,
        gy: nt.gy,
        l: nt.l,
        isoX: nt.targetIsoX,
        isoY: nt.targetIsoY - 40,
        targetIsoX: nt.targetIsoX,
        targetIsoY: nt.targetIsoY,
        palette: nt.palette,
        scale: 0.2,
        alpha: 0,
      };
      legoState.bricks.push(newB);
      morphTl.to(newB, {
        isoY: nt.targetIsoY,
        scale: 1,
        alpha: 1,
        duration: 0.6,
        ease: "back.out(1.5)",
      }, (nt.gx + nt.gy) * 0.02);
    }
  });

  morphTl.add(() => {
    if (legoState.active) {
      setTimeout(morphLegoStructure, 1200);
    }
  }, "+=0.4");
}

function stopLegoAnimationLoop() {
  legoState.active = false;
  if (legoState.timeline) legoState.timeline.kill();

  if (window.gsap && legoState.bricks.length > 0) {
    gsap.to(legoState.bricks, {
      scale: 1.12,
      duration: 0.18,
      yoyo: true,
      repeat: 1,
      ease: "power1.inOut",
      onComplete: () => {
        document.body.classList.remove("lego-loading");
        const overlay = document.getElementById("legoOverlay");
        if (overlay) overlay.classList.remove("active");
        cancelAnimationFrame(legoState.rafId);
      }
    });
  } else {
    document.body.classList.remove("lego-loading");
    const overlay = document.getElementById("legoOverlay");
    if (overlay) overlay.classList.remove("active");
    cancelAnimationFrame(legoState.rafId);
  }
}
