/**
 * Big Five Bonanza — API Service Layer
 * All backend communication. No game logic here.
 * Reads auth from cookies; never stores sensitive data in localStorage.
 */

'use strict';

const API = (() => {

  /* ─────────────────────────────────────────
   * CONFIG  (runtime values injected by operator)
   * ───────────────────────────────────────── */
  const CFG = {
    base:    window.BIG5_API_BASE    || '/api',
    timeout: window.BIG5_API_TIMEOUT || 10000,
  };

  /* ─────────────────────────────────────────
   * COOKIE HELPERS
   * ───────────────────────────────────────── */
  function getCookie(name) {
    const m = document.cookie.match('(?:^|; )' + name + '=([^;]*)');
    return m ? decodeURIComponent(m[1]) : null;
  }

  function getToken() {
    // Operator JWT stored in HttpOnly-safe cookie (set server-side).
    // We read the non-sensitive session reference only.
    return getCookie('b5_session') || getQueryParam('token') || null;
  }

  function getQueryParam(name) {
    return new URLSearchParams(window.location.search).get(name);
  }

  /* ─────────────────────────────────────────
   * HTTP CORE
   * ───────────────────────────────────────── */
  let _pendingRequests = 0;

  async function request(method, path, body = null, retries = 1) {
    const token = getToken();
    if (!token) throw new APIError('NO_SESSION', 'No active session token');

    const headers = {
      'Content-Type':  'application/json',
      'Accept':        'application/json',
      'X-Session-Ref': token,
      'X-Game-Id':     'JOZI_GOLDRUSH_6X4_V1',
      'X-Request-Id':  generateRequestId(),
    };

    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), CFG.timeout);
    _pendingRequests++;

    try {
      const res = await fetch(CFG.base + path, {
        method,
        headers,
        credentials: 'include',   // sends HttpOnly cookies
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(tid);
      _pendingRequests--;

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        const code = data?.error?.code || `HTTP_${res.status}`;
        const msg  = data?.error?.message || `Request failed (${res.status})`;
        throw new APIError(code, msg, res.status);
      }

      return data;

    } catch (err) {
      clearTimeout(tid);
      _pendingRequests--;

      if (err instanceof APIError) throw err;

      // Retry transient network errors once
      if (retries > 0 && (err.name === 'AbortError' || err.name === 'TypeError')) {
        await sleep(600);
        return request(method, path, body, retries - 1);
      }

      throw new APIError('NETWORK_ERROR', 'Network request failed', 0);
    }
  }

  /* ─────────────────────────────────────────
   * API METHODS
   * ───────────────────────────────────────── */

  /**
   * POST /api/session/validate
   * Called on game load. Returns session + player info + initial balance.
   */
  async function validateSession() {
    const token    = getToken();
    const playerId = getQueryParam('playerId') || getCookie('b5_player');
    const opId     = getQueryParam('opId')     || getCookie('b5_op')     || 'DEFAULT';

    return request('POST', '/session/validate', {
      token,
      playerId,
      opId,
      gameId: 'JOZI_GOLDRUSH_6X4_V1',
      clientInfo: {
        ua:       navigator.userAgent,
        lang:     navigator.language,
        tz:       Intl.DateTimeFormat().resolvedOptions().timeZone,
        screen:   `${screen.width}x${screen.height}`,
      },
    });
  }

  /**
   * POST /api/spin
   * Single spin request. Backend runs RNG, evaluates, debits/credits wallet.
   * Returns full deterministic result.
   */
  async function spin({ betPerLine, lines, sessionId, clientSeed }) {
    return request('POST', '/spin', {
      sessionId,
      betPerLine,
      lines,
      clientSeed,      // client-provided entropy for provably fair
      currency: 'ZAR',
    });
  }

  /**
   * POST /api/session/resume
   * Reconnect to an interrupted session (e.g. mid-free-spins).
   */
  async function resumeSession(sessionId) {
    return request('POST', '/session/resume', { sessionId });
  }

  /**
   * POST /api/session/end
   * Cleanly close the session and return balance.
   */
  async function endSession(sessionId) {
    return request('POST', '/session/end', { sessionId });
  }

  /**
   * GET /api/game/config
   * Fetch game config (paytable, bet limits, RTP, paylines) for this tenant.
   */
  async function getGameConfig() {
    return request('GET', '/game/config');
  }

  /**
   * GET /api/player/balance
   * Refresh balance from wallet (operator callback).
   */
  async function getBalance(sessionId) {
    return request('GET', `/player/balance?sessionId=${encodeURIComponent(sessionId)}`);
  }

  /* ─────────────────────────────────────────
   * UTILITIES
   * ───────────────────────────────────────── */
  function generateRequestId() {
    const arr = new Uint8Array(16);
    crypto.getRandomValues(arr);
    return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
  }

  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  /* ─────────────────────────────────────────
   * CUSTOM ERROR
   * ───────────────────────────────────────── */
  class APIError extends Error {
    constructor(code, message, status = 0) {
      super(message);
      this.name = 'APIError';
      this.code = code;
      this.status = status;
    }
  }

  /* ─────────────────────────────────────────
   * MOCK BACKEND  (remove / gate behind feature flag in production)
   * ───────────────────────────────────────── */
  const MOCK = (() => {
    // Weighted symbol pool — mirrors backend distribution
    const POOL = [];
    const weights = {
      nugget:   12, boots:    10, helmet:   8,
      cart:      8, lantern:   8, pickaxe:  8,
      dynamite:  6, wild:      3, scatter:  3,
    };
    for (const [sym, w] of Object.entries(weights))
      for (let i = 0; i < w; i++) POOL.push(sym);

    function rnd() { return POOL[Math.floor(Math.random() * POOL.length)]; }

    const PAYTABLE = {
      dynamite: [0,0,10,25,75,150],
      pickaxe:  [0,0, 8,20,60,120],
      lantern:  [0,0, 6,15,45, 90],
      cart:     [0,0, 5,12,35, 70],
      helmet:   [0,0, 4,10,30, 60],
      boots:    [0,0, 3, 8,20, 40],
      nugget:   [0,0, 2, 6,15, 30],
      wild:     [0,0,20,50,200,400],
      scatter:  [0,0, 5,15,50,100],
    };

    const PAYLINES = [
      [0,0,0,0,0,0],[1,1,1,1,1,1],[2,2,2,2,2,2],[3,3,3,3,3,3],
      [0,1,2,3,2,1],[3,2,1,0,1,2],[0,0,1,2,3,3],[3,3,2,1,0,0],
      [1,2,3,3,2,1],[2,1,0,0,1,2],
    ];

    function evalWins(grid, betPerLine, fsMultiplier = 1) {
      let totalWin = 0;
      const winLines = [];

      PAYLINES.forEach((line, li) => {
        const syms = line.map((r, c) => grid[c][r]);
        let base = syms[0] === 'wild' ? (syms.find(s => s !== 'wild') || 'wild') : syms[0];
        let cnt = 1;
        for (let i = 1; i < 6; i++) {
          const s = syms[i];
          if (s === base || s === 'wild' || (base === 'wild' && s)) {
            if (base === 'wild' && s !== 'wild') base = s;
            cnt++;
          } else break;
        }
        if (cnt >= 3) {
          const mult = PAYTABLE[base === 'wild' ? 'wild' : base]?.[Math.min(cnt, 5)] || 0;
          if (mult > 0) {
            const lineWin = betPerLine * mult * fsMultiplier;
            totalWin += lineWin;
            winLines.push({ lineIndex: li, symbol: base, count: cnt, win: lineWin });
          }
        }
      });

      return { totalWin, winLines };
    }

    let _mockBalance  = null;
    let _mockSession  = null;
    let _mockFsLeft   = 0;
    let _mockFsAcc    = 0;
    let _mockFsMul    = 3;

    return {
      validateSession(balance) {
        _mockBalance = balance;
        _mockSession = 'MOCK_' + Math.random().toString(36).slice(2, 10).toUpperCase();
        return {
          ok: true,
          data: {
            sessionId:  _mockSession,
            playerId:   getCookie('b5_player') || getQueryParam('playerId') || 'ZA_' + Math.floor(Math.random()*900000+100000),
            username:   getQueryParam('username') || 'Player' + Math.floor(Math.random()*9999),
            balance:    _mockBalance,
            currency:   'ZAR',
            opId:       getQueryParam('opId') || 'DEMO',
            expiresAt:  Date.now() + 3600000,
            gameConfig: {
              gameId:      'JOZI_GOLDRUSH_6X4_V1',
              reels:       6,
              rows:        4,
              lines:       10,
              betSteps:    [1,2,5,10,20,50,100],
              defaultBet:  5,
              minBet:      1,
              maxBet:      100,
              rtp:         96.5,
              volatility:  'HIGH',
              freeSpins:   { count: 10, multiplier: 3, triggerCount: 3 },
              paytable:    PAYTABLE,
              paylines:    PAYLINES,
            },
            responsibleGaming: {
              sessionTimeLimitMs: 3600000,
              sessionLossLimit:   500,
            },
          },
        };
      },

      spin({ betPerLine, lines, sessionId, fsMultiplier = 1 }) {
        // Generate grid
        const grid = Array.from({ length: 6 }, () =>
          Array.from({ length: 4 }, () => rnd())
        );

        const isBonus   = _mockFsLeft > 0;
        const fsMul     = isBonus ? _mockFsMul : 1;
        const { totalWin, winLines } = evalWins(grid, betPerLine, fsMul);
        const scatters  = grid.flat().filter(s => s === 'scatter').length;
        const triggerFs = scatters >= 3 && !isBonus;

        const totalBet = betPerLine * lines;
        _mockBalance   = Math.max(0, _mockBalance - totalBet + totalWin);

        if (isBonus) { _mockFsLeft--; _mockFsAcc += totalWin; }
        if (triggerFs) { _mockFsLeft = 10; _mockFsAcc = 0; }

        return {
          ok: true,
          data: {
            spinId:       crypto.randomUUID(),
            sessionId,
            grid,
            winLines,
            totalWin,
            totalBet,
            balance:      _mockBalance,
            scatterCount: scatters,
            triggerFreeSpins: triggerFs,
            isFreeSpinRound:  isBonus,
            freeSpinsLeft:    _mockFsLeft,
            freeSpinsTotal:   isBonus ? 10 : 0,
            freeSpinsAcc:     _mockFsAcc,
            fsMultiplier:     fsMul,
            serverSeed:       'DEMO_SEED_' + Date.now(),
            serverSeedHash:   'DEMO_HASH',
            timestamp:        Date.now(),
          },
        };
      },

      resumeSession() {
        return {
          ok: true,
          data: {
            sessionId:     _mockSession,
            balance:       _mockBalance,
            freeSpinsLeft: _mockFsLeft,
            freeSpinsAcc:  _mockFsAcc,
            bonusActive:   _mockFsLeft > 0,
          },
        };
      },

      endSession() {
        return { ok: true, data: { balance: _mockBalance } };
      },

      getGameConfig() {
        // Already included in validateSession
        return { ok: true, data: {} };
      },

      getBalance() {
        return { ok: true, data: { balance: _mockBalance } };
      },
    };
  })();

  /* ─────────────────────────────────────────
   * PUBLIC INTERFACE — switches mock <-> real
   * ───────────────────────────────────────── */
  const USE_MOCK = window.BIG5_MOCK !== false; // set BIG5_MOCK=false in prod

  return {
    validateSession: USE_MOCK
      ? (balance) => Promise.resolve(MOCK.validateSession(balance))
      : validateSession,

    spin: USE_MOCK
      ? (params) => Promise.resolve(MOCK.spin(params))
      : spin,

    resumeSession: USE_MOCK
      ? (sid) => Promise.resolve(MOCK.resumeSession(sid))
      : resumeSession,

    endSession: USE_MOCK
      ? (sid) => Promise.resolve(MOCK.endSession(sid))
      : endSession,

    getGameConfig: USE_MOCK
      ? () => Promise.resolve(MOCK.getGameConfig())
      : getGameConfig,

    getBalance: USE_MOCK
      ? (sid) => Promise.resolve(MOCK.getBalance(sid))
      : getBalance,

    get pendingRequests() { return _pendingRequests; },
    APIError,
  };

})();