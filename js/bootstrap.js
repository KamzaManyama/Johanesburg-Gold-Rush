'use strict';

/**
 * ═══════════════════════════════════════════════════════════════════
 *  Johanesburg Gold Rush · Session Bootstrap  (js/bootstrap.js)
 *
 *  Load order in index.html:
 *    1. api.js
 *    2. audio.js
 *    3. engine.js
 *    4. bootstrap.js   ← this file
 *    5. ui.js
 *
 *  How it works:
 *    Your website redirects the player to the game like this:
 *
 *    https://yourgame.com/game/?token=abc123&op=MYSITE&lang=en&currency=ZAR&lobby=https://mysite.com
 *
 *    This module reads those params, calls your backend to validate
 *    the token, gets the player's balance + config, and hands it all
 *    to GameEngine.init() so the game can start.
 *
 *  Required URL params:
 *    token     — one-time session token created by your backend
 *    op        — operator ID (your site identifier)
 *
 *  Optional URL params:
 *    lang      — player language (default: 'en')
 *    currency  — override currency (default from server)
 *    lobby     — URL to send player when they exit
 *    demo      — '1' or 'true' → force demo/mock mode
 *    bet       — preset bet per line value
 *    mode      — 'real' | 'demo'
 * ═══════════════════════════════════════════════════════════════════
 */

const SessionBootstrap = (() => {

  /* ─────────────────────────────────────────────────────────────
     PARSE URL PARAMETERS
     Reads everything from the query string safely.
  ───────────────────────────────────────────────────────────── */
  function _parseParams() {
    const params = new URLSearchParams(window.location.search);

    return {
      // Core (required)
      token:    params.get('token')    || params.get('sessionToken') || null,
      op:       params.get('op')       || params.get('operatorId')   || 'DEMO',

      // Optional launch params
      lang:     params.get('lang')     || 'en',
      currency: params.get('currency') || null,
      lobby:    params.get('lobby')    || params.get('lobbyUrl')     || null,
      mode:     params.get('mode')     || 'real',          // 'real' | 'demo'
      demo:     params.get('demo')     === '1' || params.get('demo') === 'true',
      bet:      params.get('bet')      ? Number(params.get('bet'))   : null,

      // Responsible gaming passed from operator shell
      timeLimitMins: params.get('timeLimitMins') ? Number(params.get('timeLimitMins')) : null,
      lossLimit:     params.get('lossLimit')      ? Number(params.get('lossLimit'))     : null,

      // Provably fair — operator can pass nonce
      nonce:    params.get('nonce')    || null,
    };
  }

  /* ─────────────────────────────────────────────────────────────
     VALIDATE TOKEN WITH YOUR BACKEND
     POST /api/session/validate
     Your server must return the player profile + game config.
  ───────────────────────────────────────────────────────────── */
  async function _validateToken(params) {
    const endpoint = `${window.JOZI_API_BASE || '/api'}/session/validate`;

    const body = {
      token:    params.token,
      op:       params.op,
      lang:     params.lang,
      currency: params.currency,
      nonce:    params.nonce,
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), window.JOZI_API_TIMEOUT || 10000);

    try {
      const res = await fetch(endpoint, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
        signal:  controller.signal,
      });
      clearTimeout(timeout);

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw Object.assign(
          new Error(err.message || `HTTP ${res.status}`),
          { code: err.code || 'SESSION_HTTP_ERROR', status: res.status }
        );
      }

      return await res.json();

    } catch (err) {
      clearTimeout(timeout);
      if (err.name === 'AbortError') {
        throw Object.assign(new Error('Session validation timed out'), { code: 'SESSION_TIMEOUT' });
      }
      throw err;
    }
  }

  /* ─────────────────────────────────────────────────────────────
     MOCK SESSION — used when demo=true or BIG5_MOCK=true
     Returns a fake but complete session object that mirrors
     exactly what your real backend must return.
  ───────────────────────────────────────────────────────────── */
  function _mockSessionResponse(params) {
    const buf = new Uint8Array(8);
    crypto.getRandomValues(buf);
    const id = Array.from(buf, b => b.toString(16).padStart(2, '0')).join('');

    return {
      ok: true,
      data: {
        // ── Identity ───────────────────────────────────────
        sessionId:  'SESS-' + id.toUpperCase(),
        playerId:   'PL-' + id.slice(0, 6).toUpperCase(),
        username:   'GoldMiner',
        opId:       params.op,
        lang:       params.lang,

        // ── Money ─────────────────────────────────────────
        balance:    2000.00,
        currency:   params.currency || 'ZAR',
        mode:       params.demo ? 'demo' : (params.mode || 'real'),

        // ── Game config (operator can override these) ─────
        gameConfig: {
          reels:      6,
          rows:       4,
          lines:      10,
          betSteps:   [1, 2, 5, 10, 20, 50, 100],
          defaultBet: params.bet || 5,
          minBet:     1,
          maxBet:     100,
          rtp:        96.5,
          maxWinMult: 5000,
          freeSpins: {
            count:        10,
            multiplier:   3,
            triggerCount: 3,
          },
        },

        // ── Responsible gaming ────────────────────────────
        responsibleGaming: {
          sessionTimeLimitMs: params.timeLimitMins ? params.timeLimitMins * 60000 : 0,
          sessionLossLimit:   params.lossLimit || 0,
          depositLimit:       0,
        },

        // ── Navigation ────────────────────────────────────
        lobbyUrl: params.lobby || null,

        // ── Provably fair ─────────────────────────────────
        serverSeedHash: _generateHash(),
      }
    };
  }

  function _generateHash() {
    const buf = new Uint8Array(32);
    crypto.getRandomValues(buf);
    return Array.from(buf, b => b.toString(16).padStart(2, '0')).join('');
  }

  /* ─────────────────────────────────────────────────────────────
     APPLY SESSION TO GAME ENGINE
     Takes the validated session response and boots the engine.
  ───────────────────────────────────────────────────────────── */
  function _applySession(sessionData, params) {
    const d = sessionData;

    // Store lobby URL globally so UI exit button can use it
    window.JOZI_LOBBY_URL = d.lobbyUrl || params.lobby || null;

    // Store lang globally for any i18n use
    window.JOZI_LANG = d.lang || params.lang || 'en';

    // Store mode
    window.JOZI_MODE = d.mode || 'real';

    // Directly hydrate the engine state
    // (engine.init() also calls API.validateSession — in URL mode
    //  we bypass that and feed the data in directly)
    const S = GameEngine.state;

    S.sessionId  = d.sessionId;
    S.playerId   = d.playerId;
    S.username   = d.username   || 'Player';
    S.balance    = d.balance    || 0;
    S.currency   = d.currency   || 'ZAR';
    S.opId       = d.opId       || params.op;

    // Apply server-provided game config
    if (d.gameConfig) {
      GameEngine._applyConfigPublic(d.gameConfig);
    }

    // Apply bet preset from URL if provided
    if (params.bet) {
      GameEngine.setBetByValue(params.bet);
    }

    // Apply RG limits
    if (d.responsibleGaming) {
      GameEngine.updateRGLimits({
        timeMins:     d.responsibleGaming.sessionTimeLimitMs
                        ? d.responsibleGaming.sessionTimeLimitMs / 60000
                        : null,
        lossLimit:    d.responsibleGaming.sessionLossLimit   || null,
        depositLimit: d.responsibleGaming.depositLimit       || null,
      });
    }

    // RG start balance for session loss tracking
    S.rg.startBal    = S.balance;
    S.rg.sessionLost = 0;

    // Session start time
    S.sessionStartMs = Date.now();

    // Server seed hash for provably fair display
    if (d.serverSeedHash) {
      S.serverSeedHash = d.serverSeedHash;
    }
  }

  /* ─────────────────────────────────────────────────────────────
     MAIN BOOT — call this from ui.js instead of GameEngine.init()
  ───────────────────────────────────────────────────────────── */
  async function boot() {
    const params = _parseParams();

    // ── Decide mode ───────────────────────────────────────────
    // Force mock/demo if:
    //   - demo param is set
    //   - mode=demo
    //   - BIG5_MOCK global is true
    //   - no token present (local dev)
    const isMock = params.demo
      || params.mode === 'demo'
      || window.BIG5_MOCK === true
      || !params.token;

    window.BIG5_MOCK = isMock; // normalise global flag

    // ── Emit early loading events ─────────────────────────────
    GameEngine._emitPublic('loading', { phase: 'session', progress: 10 });

    try {
      let sessionResponse;

      if (isMock) {
        // Local / demo mode — no backend call needed
        await _sleep(300);
        sessionResponse = _mockSessionResponse(params);
        GameEngine._emitPublic('loading', { phase: 'session', progress: 40 });
      } else {
        // Real mode — validate token with your backend
        if (!params.token) {
          throw Object.assign(
            new Error('No session token in URL. Add ?token=YOUR_TOKEN to the game URL.'),
            { code: 'NO_TOKEN' }
          );
        }

        sessionResponse = await _validateToken(params);
        GameEngine._emitPublic('loading', { phase: 'session', progress: 40 });

        if (!sessionResponse.ok || !sessionResponse.data) {
          throw Object.assign(
            new Error(sessionResponse.error || 'Session validation failed'),
            { code: sessionResponse.code || 'SESSION_INVALID' }
          );
        }
      }

      // ── Apply validated session to engine ─────────────────
      _applySession(sessionResponse.data, params);
      GameEngine._emitPublic('loading', { phase: 'assets', progress: 70 });

      await _sleep(200);
      GameEngine._emitPublic('loading', { phase: 'complete', progress: 100 });

      // ── Fire ready event with full session + config ────────
      GameEngine._emitPublic('ready', {
        session:  sessionResponse.data,
        symbols:  GameEngine.symbols,
        paytable: GameEngine.paytable,
        paylines: GameEngine.paylines,
        params,           // raw URL params — useful for UI
        isDemo:   isMock,
      });

      // ── Start session timer ───────────────────────────────
      GameEngine._startTimerPublic();

      return sessionResponse.data;

    } catch (err) {
      GameEngine._emitPublic('error', {
        code:    err.code    || 'BOOT_FAILED',
        message: err.message || 'Failed to start game session',
        status:  err.status  || null,
      });
      throw err;
    }
  }

  /* ─────────────────────────────────────────────────────────────
     UTILITY
  ───────────────────────────────────────────────────────────── */
  function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  /** Read current launch params — useful for UI to show player name, currency etc. */
  function getLaunchParams() { return _parseParams(); }

  /** Get the lobby URL to redirect on exit */
  function getLobbyUrl() { return window.JOZI_LOBBY_URL || null; }

  /** Return to lobby (called by UI exit button) */
  function exitToLobby() {
    const url = getLobbyUrl();
    if (url) {
      window.top.location.href = url; // works inside iframe too
    } else {
      window.history.back();
    }
  }

  return {
    boot,
    getLaunchParams,
    getLobbyUrl,
    exitToLobby,
  };

})();