/**
 * Johannesburg Gold Rush — Audio Engine (Real Audio Version)
 * Handles preloading, overlapping playback, autoplay unlock, and volume controls.
 */

'use strict';

const AudioEngine = (() => {
    // ------------------- CONFIGURATION -------------------
    // Path to sound files (adjust if needed, or override via window.JOZI_AUDIO_BASE)
    const DEFAULT_AUDIO_BASE = '../assets/sound/';
    const AUDIO_BASE = window.JOZI_AUDIO_BASE || DEFAULT_AUDIO_BASE;

    // Sound file mapping (key → filename)
    const SOUND_FILES = {
        click:      'click.mp3',
        spinStart:  'slot-machine.mp3',
        reelTick:   'mixkit-melodic-gold-price-2000.wav',
        reelStop:   'mixkit-payout-award-1934.wav',
        smallWin:   'winning-reward-1983.wav',
        bigWin:     'mixkit-slot-machine-win-siren-1929.wav',
        megaWin:    'mixkit-payout-award-1934.wav',
        scatter:    'wild.mp3',
        freeSpins:  'mixkit-melodic-gold-price-2000.wav',
        bonus:      'mixkit-payout-award-1934.wav',
        deposit:    'mixkit-melodic-gold-price-2000.wav',
        error:      'mixkit-slot-machine-win-siren-1929.wav',
        countdown:  'click.mp3',
        bg:         'oosongoo-background-music-224633.mp3'
    };

    // ------------------- PRIVATE STATE -------------------
    let soundEnabled = true;
    let musicEnabled = true;
    let globalSfxVolume = 0.8;
    let globalMusicVolume = 0.3;

    const soundCache = {};          // preloaded <audio> elements (one per key)
    let musicElement = null;        // background music element (single instance)
    let unlockContext = null;       // silent AudioContext to unlock audio
    let isUnlocked = false;

    // ------------------- HELPER: PRELOAD SOUNDS -------------------
    function preloadSounds() {
        for (const [name, file] of Object.entries(SOUND_FILES)) {
            const path = AUDIO_BASE + file;
            const audio = new Audio(path);
            audio.preload = 'auto';
            audio.volume = globalSfxVolume;
            audio.addEventListener('error', () => {
                console.warn(`[AudioEngine] Failed to load: ${name} (${path})`);
            });
            soundCache[name] = audio;
        }
        console.log('[AudioEngine] All sounds preloaded.');
    }

    // ------------------- UNLOCK AUDIO (user interaction) -------------------
    function unlockAudio() {
        if (isUnlocked) return;
        try {
            // Create a silent AudioContext – this unlocks audio on most browsers
            unlockContext = new (window.AudioContext || window.webkitAudioContext)();
            const silentBuffer = unlockContext.createBuffer(1, 1, 22050);
            const source = unlockContext.createBufferSource();
            source.buffer = silentBuffer;
            source.connect(unlockContext.destination);
            source.start();
            unlockContext.resume().then(() => {
                isUnlocked = true;
                console.log('[AudioEngine] Audio unlocked.');
                // If music should be playing, start it now
                if (musicEnabled && musicElement && musicElement.paused) {
                    musicElement.play().catch(e => console.warn('Music play after unlock:', e));
                }
            }).catch(e => console.warn('Failed to resume unlock context:', e));
        } catch (e) {
            console.warn('[AudioEngine] Web Audio not supported – no auto‑unlock.');
            isUnlocked = true; // fallback – assume unlocked
        }
    }

    // ------------------- PLAY SFX (with overlapping support) -------------------
    function playSFX(name, volume = 1.0) {
        if (!soundEnabled) return;
        if (!isUnlocked) {
            // If not unlocked yet, we'll try to play anyway – might be blocked.
            // Avoid spamming console.
            return;
        }

        const original = soundCache[name];
        if (!original) {
            console.warn(`[AudioEngine] Sound not found: ${name}`);
            return;
        }

        // Clone the preloaded element to allow overlapping playback
        const clone = original.cloneNode();
        clone.volume = volume * globalSfxVolume;
        clone.play().catch(err => {
            // If still blocked, try unlocking again (unlikely after first click)
            if (err.name === 'NotAllowedError') {
                console.warn(`[AudioEngine] Play blocked for ${name}, attempting unlock...`);
                unlockAudio();
            } else {
                console.warn(`[AudioEngine] Play failed for ${name}:`, err);
            }
        });
    }

    // ------------------- PUBLIC API -------------------
    function init() {
        preloadSounds();

        // Set up global unlock on first user interaction
        const unlockHandler = () => {
            unlockAudio();
            document.removeEventListener('click', unlockHandler);
            document.removeEventListener('touchstart', unlockHandler);
        };
        document.addEventListener('click', unlockHandler);
        document.addEventListener('touchstart', unlockHandler);
    }

    function resume() {
        // Called externally (e.g., after a modal close) to ensure music plays
        if (!isUnlocked) unlockAudio();
        if (musicElement && musicElement.paused && musicEnabled) {
            musicElement.play().catch(e => console.warn('Resume music:', e));
        }
    }

    // SFX methods – each maps to a sound key
    const SFX = {
        click()          { playSFX('click', 0.6); },
        spinStart()      { playSFX('spinStart', 0.9); },
        reelTick()       { playSFX('reelTick', 0.4); },
        reelStop()       { playSFX('reelStop', 0.9); },
        smallWin()       { playSFX('smallWin', 0.7); },
        bigWin()         { playSFX('bigWin', 0.9); },
        megaWin()        { playSFX('megaWin', 1.0); },
        scatterLand()    { playSFX('scatter', 0.9); },
        freeSpinsStart() { playSFX('freeSpins', 0.9); },
        bonusCollect()   { playSFX('bonus', 0.8); },
        deposit()        { playSFX('deposit', 0.7); },
        error()          { playSFX('error', 0.6); },
        countdown()      { playSFX('countdown', 0.5); }
    };

    function startMusic() {
        if (!musicEnabled) return;
        if (musicElement) {
            musicElement.play().catch(e => console.warn('Music play:', e));
            return;
        }

        // Use custom music source if defined (compatibility with old engine)
        let musicPath = AUDIO_BASE + SOUND_FILES.bg;
        if (window.JOZI_MUSIC_SRC && window.JOZI_MUSIC_SRC !== null) {
            musicPath = window.JOZI_MUSIC_SRC;
        }

        musicElement = new Audio(musicPath);
        musicElement.loop = true;
        musicElement.volume = globalMusicVolume;
        musicElement.addEventListener('error', () => {
            console.warn('[AudioEngine] Background music failed to load:', musicPath);
        });
        musicElement.play().catch(e => {
            console.warn('Music autoplay blocked – will start after unlock.');
        });
    }

    function stopMusic() {
        if (musicElement) {
            musicElement.pause();
        }
    }

    function setSound(enabled) {
        soundEnabled = enabled;
        // No need to mute currently playing clones – they'll finish naturally.
    }

    function setMusic(enabled) {
        musicEnabled = enabled;
        if (enabled) {
            startMusic();
        } else {
            stopMusic();
        }
    }

    function setSoundVol(vol) {
        globalSfxVolume = Math.max(0, Math.min(1, vol));
        // Update volume for already preloaded sounds (optional)
        for (const sound of Object.values(soundCache)) {
            sound.volume = globalSfxVolume;
        }
    }

    function setMusicVol(vol) {
        globalMusicVolume = Math.max(0, Math.min(1, vol));
        if (musicElement) {
            musicElement.volume = globalMusicVolume;
        }
    }

    // Getters for UI
    Object.defineProperty(this, 'soundEnabled', {
        get: () => soundEnabled
    });
    Object.defineProperty(this, 'musicEnabled', {
        get: () => musicEnabled
    });

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
        get musicEnabled() { return musicEnabled; }
    };
})();