/**
 * Johanesburg Gold Rush — Audio Engine
 * Web Audio API synthesiser + asset loader.
 * Replace synth sounds with real .ogg/.mp3 files by setting AUDIO_BASE.
 */

'use strict';

const AudioEngine = (() => {

  let ctx = null;
  let masterGain = null;
  let sfxGain    = null;
  let musicGain  = null;

  let soundEnabled = true;
  let musicEnabled = true;

  let bgLoop = null;

  function init() {
    if (ctx) return;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      masterGain = ctx.createGain(); masterGain.gain.value = 0.85;
      sfxGain    = ctx.createGain(); sfxGain.gain.value    = 1.0;
      musicGain  = ctx.createGain(); musicGain.gain.value  = 0.28;
      sfxGain.connect(masterGain);
      musicGain.connect(masterGain);
      masterGain.connect(ctx.destination);
    } catch (e) {
      console.warn('[Audio] WebAudio not available', e);
    }
  }

  function resume() {
    if (ctx && ctx.state === 'suspended') ctx.resume();
  }

  function tone(freq, dur = 0.08, vol = 0.15, type = 'sine', dest = sfxGain) {
    if (!ctx || !soundEnabled) return;
    try {
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.connect(env); env.connect(dest);
      osc.type = type;
      osc.frequency.setValueAtTime(freq, ctx.currentTime);
      env.gain.setValueAtTime(vol, ctx.currentTime);
      env.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + dur + 0.01);
    } catch (e) {}
  }

  function noise(dur = 0.06, vol = 0.05) {
    if (!ctx || !soundEnabled) return;
    try {
      const bufLen = ctx.sampleRate * dur;
      const buf    = ctx.createBuffer(1, bufLen, ctx.sampleRate);
      const data   = buf.getChannelData(0);
      for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1;
      const src  = ctx.createBufferSource();
      const filt = ctx.createBiquadFilter();
      const env  = ctx.createGain();
      src.buffer = buf;
      filt.type  = 'bandpass'; filt.frequency.value = 800; filt.Q.value = 0.6;
      src.connect(filt); filt.connect(env); env.connect(sfxGain);
      env.gain.setValueAtTime(vol, ctx.currentTime);
      env.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
      src.start(); src.stop(ctx.currentTime + dur + 0.01);
    } catch (e) {}
  }

  /* SFX — Gold Rush themed sounds */
  const SFX = {
    click() {
      tone(600, 0.04, 0.10, 'square');
    },

    spinStart() {
      resume();
      // Mechanical reel crank sound
      [80, 100, 130, 160].forEach((f, i) =>
        setTimeout(() => { tone(f, 0.08, 0.12, 'sawtooth'); noise(0.04, 0.04); }, i * 35)
      );
    },

    // Gold Rush reel tick — metallic clank
    reelTick() {
      const freq = 200 + Math.random() * 120;
      tone(freq, 0.025, 0.08, 'square');
      noise(0.02, 0.06);
    },

    // Heavy thud when reel stops — like a mine cart stopping
    reelStop(reelIdx) {
      const base = 130 + reelIdx * 18;
      tone(base, 0.12, 0.22, 'sine');
      tone(base * 0.75, 0.08, 0.12, 'triangle');
      noise(0.06, 0.10);
      // Metal ring
      setTimeout(() => tone(base * 3, 0.08, 0.06, 'sine'), 40);
    },

    smallWin() {
      // Coins falling
      [523, 587, 659, 784].forEach((f, i) =>
        setTimeout(() => { tone(f, 0.12, 0.18, 'sine'); noise(0.04, 0.03); }, i * 80)
      );
    },

    bigWin() {
      // Gold rush fanfare
      [392, 523, 659, 784, 1047, 1319].forEach((f, i) =>
        setTimeout(() => { tone(f, 0.22, 0.20, 'sine'); tone(f * 1.5, 0.12, 0.06, 'triangle'); }, i * 100)
      );
    },

    megaWin() {
      [261, 392, 523, 659, 784, 1047, 1175, 1319, 1568].forEach((f, i) =>
        setTimeout(() => { tone(f, 0.28, 0.22, 'sine'); tone(f * 2, 0.18, 0.08, 'triangle'); }, i * 80)
      );
      setTimeout(() => noise(0.3, 0.10), 300);
    },

    scatterLand() {
      // Dynamite fuse sound
      noise(0.15, 0.12);
      setTimeout(() => { tone(440, 0.25, 0.25, 'sine'); tone(660, 0.18, 0.14, 'sine'); }, 150);
    },

    freeSpinsStart() {
      // Mine shaft echo melody
      const melody = [261, 329, 392, 523, 659, 784, 880, 1047];
      melody.forEach((f, i) =>
        setTimeout(() => tone(f, 0.28, 0.20, 'sine'), i * 130)
      );
    },

    bonusCollect() {
      [330, 415, 523, 659, 880].forEach((f, i) =>
        setTimeout(() => { tone(f, 0.18, 0.18, 'sine'); noise(0.03, 0.02); }, i * 75)
      );
    },

    deposit() {
      [392, 523, 659, 784].forEach((f, i) =>
        setTimeout(() => tone(f, 0.14, 0.18, 'sine'), i * 75)
      );
    },

    error() {
      tone(180, 0.20, 0.18, 'sawtooth');
      setTimeout(() => tone(140, 0.25, 0.14, 'sawtooth'), 160);
    },

    countdown() {
      tone(440, 0.08, 0.12, 'square');
    },
  };

  /* Background Music — Western/Gold Rush feel */
  const MUSIC_SRC = window.JOZI_MUSIC_SRC || null;
  let musicAudioEl = null;

  // Western pentatonic progression
  const CHORDS = [
    [146.83, 196.00, 246.94],  // D3 G3 B3
    [164.81, 220.00, 261.63],  // E3 A3 C4
    [130.81, 174.61, 220.00],  // C3 F3 A3
    [146.83, 195.00, 246.94],  // D3 ~G3 B3
  ];
  const BASS_NOTES = [73.42, 82.41, 65.41, 73.42];    // D2 E2 C2 D2
  const LEAD_NOTES = [587.33, 659.25, 523.25, 587.33]; // D5 E5 C5 D5

  function startMusic() {
    if (!musicEnabled) return;
    init(); resume();

    if (MUSIC_SRC) {
      if (!musicAudioEl) {
        musicAudioEl = new Audio(MUSIC_SRC);
        musicAudioEl.loop = true;
        musicAudioEl.volume = 0.3;
      }
      musicAudioEl.play().catch(() => startSynthMusic());
      return;
    }
    startSynthMusic();
  }

  function startSynthMusic() {
    if (bgLoop || !ctx || !musicEnabled) return;
    let beat = 0;

    function playBeat() {
      if (!musicEnabled) { stopMusic(); return; }
      const ci    = Math.floor(beat / 2) % CHORDS.length;
      const chord = CHORDS[ci];
      const bass  = BASS_NOTES[ci];
      const lead  = LEAD_NOTES[ci];

      chord.forEach(f => {
        if (!ctx) return;
        const osc = ctx.createOscillator();
        const env = ctx.createGain();
        osc.connect(env); env.connect(musicGain);
        osc.type = 'triangle'; osc.frequency.value = f;
        const t = ctx.currentTime;
        env.gain.setValueAtTime(0.001, t);
        env.gain.linearRampToValueAtTime(0.035, t + 0.25);
        env.gain.linearRampToValueAtTime(0.001, t + 1.4);
        osc.start(t); osc.stop(t + 1.8);
      });

      if (beat % 2 === 0) {
        const osc = ctx.createOscillator();
        const env = ctx.createGain();
        osc.connect(env); env.connect(musicGain);
        osc.type = 'sine'; osc.frequency.value = bass;
        const t = ctx.currentTime;
        env.gain.setValueAtTime(0.08, t);
        env.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
        osc.start(t); osc.stop(t + 0.8);
      }

      if (beat % 4 === 2 && Math.random() > 0.35) {
        const osc = ctx.createOscillator();
        const env = ctx.createGain();
        osc.connect(env); env.connect(musicGain);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(lead, ctx.currentTime);
        osc.frequency.linearRampToValueAtTime(lead * (Math.random() > 0.5 ? 1.06 : 0.94), ctx.currentTime + 0.35);
        const t = ctx.currentTime;
        env.gain.setValueAtTime(0.04, t);
        env.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
        osc.start(t); osc.stop(t + 0.7);
      }

      // Percussion — boot stomp feel
      if (beat % 2 === 0) noise(0.06, 0.04);
      if (beat % 4 === 2) { noise(0.025, 0.02); }

      beat++;
    }

    playBeat();
    bgLoop = setInterval(playBeat, 1600);
  }

  function stopMusic() {
    if (bgLoop) { clearInterval(bgLoop); bgLoop = null; }
    if (musicAudioEl) { musicAudioEl.pause(); }
  }

  function setSound(on) {
    soundEnabled = on;
    if (sfxGain) sfxGain.gain.value = on ? 1.0 : 0;
  }

  function setMusic(on) {
    musicEnabled = on;
    if (on) startMusic();
    else    stopMusic();
    if (musicGain) musicGain.gain.value = on ? 0.28 : 0;
  }

  function setSoundVol(v) {
    if (sfxGain) sfxGain.gain.value = Math.max(0, Math.min(1, v));
  }

  function setMusicVol(v) {
    if (musicGain) musicGain.gain.value = Math.max(0, Math.min(1, v * 0.35));
    if (musicAudioEl) musicAudioEl.volume = Math.max(0, Math.min(1, v * 0.35));
  }

  return {
    init,
    resume,
    sfx: SFX,
    startMusic,
    stopMusic,
    setSound,
    setMusic,
    setSoundVol,
    setMusicVol,
    get soundEnabled() { return soundEnabled; },
    get musicEnabled() { return musicEnabled; },
  };

})();