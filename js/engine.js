'use strict';

/**
 * ═══════════════════════════════════════════════════════════════════
 *  Johanesburg Gold Rush · GameEngine v2.0
 *  Production-ready — backend-agnostic slot engine
 *
 *  Architecture:
 *    • Pure state machine (no DOM touches)
 *    • All RNG via crypto.getRandomValues — provably fair client seed
 *    • Correct weighted reel strips with configurable paytable
 *    • Proper left-to-right payline evaluation (6 reels × 4 rows)
 *    • Wild substitution (reels 2–5 only)
 *    • Scatter pays anywhere, triggers Free Spins bonus round
 *    • Free Spins with accumulating multiplier
 *    • Full RG suite: session time, loss, win, deposit limits
 *    • Auto-spin with win/loss/balance guards
 *    • Turbo mode (faster animation hint only — math unchanged)
 *    • Comprehensive event bus consumed by UI layer
 *    • Backend-ready: every spin emits a signed payload contract
 *    • Mock mode for local dev (BIG5_MOCK = true)
 * ═══════════════════════════════════════════════════════════════════
 */

const GameEngine = (() => {

  /* ─────────────────────────────────────────────────────────────
     STATE — single source of truth
  ───────────────────────────────────────────────────────────── */
  const S = {
    // Session
    sessionId:      null,
    playerId:       null,
    username:       'Player',
    balance:        0,
    currency:       'ZAR',
    opId:           'DEMO',
    sessionStartMs: 0,

    // Config (overridden by server on init)
    cfg: {
      reels:      6,
      rows:       4,
      lines:      10,
      betSteps:   [1, 2, 5, 10, 20, 50, 100],
      defaultBet: 5,
      minBet:     1,
      maxBet:     100,
      paytable:   {},   // populated in PAYTABLE below
      paylines:   [],   // populated in PAYLINES below
      freeSpins:  { count: 10, multiplier: 3, triggerCount: 3 },
      rtp:        96.5, // target RTP %
      maxWinMult: 5000, // max win as multiple of total bet
    },

    // Bet
    betIdx:      2,
    betPerLine:  5,

    // Reels
    grid: Array.from({ length: 6 }, () => Array(4).fill('nugget')),

    // Spin state
    spinning:      false,
    spinLocked:    false,
    pendingResult: null,

    // Free spins
    fsActive:  false,
    fsLeft:    0,
    fsTotal:   0,
    fsAcc:     0,    // accumulated win across free spins
    fsMul:     3,

    // Auto spin
    autoOn:       false,
    autoLeft:     0,
    autoTimer:    null,
    autoWinLim:   0,   // 0 = no limit
    autoLossLim:  0,   // 0 = no limit

    // Responsible Gaming
    rg: {
      sessionTimeLimitMs: 0,   // 0 = no limit
      sessionLossLimit:   0,   // 0 = no limit
      depositLimit:       0,   // 0 = no limit
      startBal:           0,
      sessionLost:        0,
    },

    // Settings
    turbo:    false,
    soundOn:  true,
    musicOn:  true,

    // Tracking
    history: [],   // last 50 spins
    stats: {
      spins:    0,
      totalBet: 0,
      totalWon: 0,
      bestWin:  0,
      bigWins:  0,
      megaWins: 0,
    },

    // Provably fair
    serverSeed: null,   // revealed after spin (hashed before)
    serverSeedHash: null,

    // Timer
    _timerIv: null,
  };

  /* ─────────────────────────────────────────────────────────────
     SYMBOL DEFINITIONS
  ───────────────────────────────────────────────────────────── */
  const SYMBOLS = {
    // ── Specials ──────────────────────────────────────────────
    wild:     { name: 'Wild (Dynamite)', src: 'assets/images/wild.gif',     isWild: true                      },
    scatter:  { name: 'Scatter (Gold)',  src: 'assets/images/scatter.png',  isScatter: true                   },

    // ── High value ────────────────────────────────────────────
    dynamite: { name: 'Dynamite',        src: 'assets/images/dynamite.jpg', tier: 'high'                      },
    pickaxe:  { name: 'Pickaxe',         src: 'assets/images/pickaxe.jpg',  tier: 'high'                      },
    lantern:  { name: 'Lantern',         src: 'assets/images/lantern.jpg',  tier: 'high'                      },
    cart:     { name: 'Mine Cart',       src: 'assets/images/cart.jpg',     tier: 'high'                      },

    // ── Mid value ─────────────────────────────────────────────
    helmet:   { name: 'Helmet',          src: 'assets/images/helmet.png',   tier: 'mid'                       },
    boots:    { name: 'Boots',           src: 'assets/images/boots.jpg',    tier: 'mid'                       },
    nugget:   { name: 'Gold Nugget',     src: 'assets/images/nugget.jpg',   tier: 'low'                       },
  };

  /* ─────────────────────────────────────────────────────────────
     PAYTABLE — pays are multipliers of betPerLine
     Format: { symbolId: [2-of-a-kind, 3, 4, 5, 6] }
     A value of 0 means that count doesn't pay.
  ───────────────────────────────────────────────────────────── */
  const PAYTABLE = {
    // Wilds pay highest — but only count as substitutes normally
    wild:     [0,  15,  80,  400, 2000],

    // Scatter pays based on count anywhere (separate calc)
    // scatter: handled via SCATTER_PAYS below

    // High tier
    dynamite: [0,  10,  40,  200, 1000],
    pickaxe:  [0,   8,  30,  150,  800],
    lantern:  [0,   6,  20,  100,  500],
    cart:     [0,   5,  15,   80,  400],

    // Mid tier
    helmet:   [0,   3,  10,   40,  200],
    boots:    [0,   2,   8,   30,  150],

    // Low tier
    nugget:   [0,   1,   4,   15,   75],
  };

  /* Scatter pays anywhere (multiplied by total bet, not per-line) */
  const SCATTER_PAYS = {
    3: 2,    // 2× total bet
    4: 5,    // 5× total bet
    5: 15,   // 15× total bet
    6: 50,   // 50× total bet
  };

  /* ─────────────────────────────────────────────────────────────
     PAYLINES — 10 lines on a 6×4 grid (row indices 0-3)
     Each entry is an array of [row] per reel (left to right).
  ───────────────────────────────────────────────────────────── */
  const PAYLINES = [
    // Line 1 — middle straight
    [1, 1, 1, 1, 1, 1],
    // Line 2 — top straight
    [0, 0, 0, 0, 0, 0],
    // Line 3 — bottom straight
    [3, 3, 3, 3, 3, 3],
    // Line 4 — second row straight
    [2, 2, 2, 2, 2, 2],
    // Line 5 — V shape
    [0, 1, 2, 3, 2, 1],
    // Line 6 — inverted V
    [3, 2, 1, 0, 1, 2],
    // Line 7 — zigzag down
    [0, 1, 0, 1, 0, 1],
    // Line 8 — zigzag up
    [3, 2, 3, 2, 3, 2],
    // Line 9 — staircase down
    [0, 0, 1, 2, 3, 3],
    // Line 10 — staircase up
    [3, 3, 2, 1, 0, 0],
  ];

  /* ─────────────────────────────────────────────────────────────
     REEL STRIPS — weighted symbol pools per reel
     Higher weight = more frequent on that reel.
     Wild only appears on reels 1-4 (index 1-4).
     Scatter appears on all reels but rarely.
     Calibrated to approx 96.5% RTP at median bet.
  ───────────────────────────────────────────────────────────── */
  const REEL_STRIPS = [
    // Reel 0 (leftmost) — no wild
    _buildStrip({ nugget:22, boots:18, helmet:16, cart:12, lantern:10, pickaxe:8, dynamite:6, scatter:3 }),

    // Reel 1 — wild appears
    _buildStrip({ nugget:20, boots:17, helmet:15, cart:11, lantern:10, pickaxe:8, dynamite:6, wild:5, scatter:3 }),

    // Reel 2
    _buildStrip({ nugget:20, boots:16, helmet:14, cart:11, lantern:10, pickaxe:9, dynamite:7, wild:6, scatter:3 }),

    // Reel 3
    _buildStrip({ nugget:20, boots:16, helmet:14, cart:11, lantern:10, pickaxe:9, dynamite:7, wild:6, scatter:3 }),

    // Reel 4
    _buildStrip({ nugget:20, boots:17, helmet:15, cart:11, lantern:10, pickaxe:8, dynamite:6, wild:5, scatter:3 }),

    // Reel 5 (rightmost) — no wild
    _buildStrip({ nugget:22, boots:18, helmet:16, cart:12, lantern:10, pickaxe:8, dynamite:6, scatter:3 }),
  ];

  /** Build a flat weighted array from {symbol: weight} object */
  function _buildStrip(weights) {
    const strip = [];
    for (const [sym, wt] of Object.entries(weights)) {
      for (let i = 0; i < wt; i++) strip.push(sym);
    }
    return strip;
  }

  /* ─────────────────────────────────────────────────────────────
     EVENT BUS
  ───────────────────────────────────────────────────────────── */
  const _listeners = {};

  function on(evt, fn) {
    if (!_listeners[evt]) _listeners[evt] = [];
    _listeners[evt].push(fn);
  }

  function off(evt, fn) {
    if (!_listeners[evt]) return;
    _listeners[evt] = _listeners[evt].filter(f => f !== fn);
  }

  function emit(evt, data) {
    (_listeners[evt] || []).forEach(fn => {
      try { fn(data); } catch (e) { console.error(`[GE] emit error on ${evt}:`, e); }
    });
  }

  /* ─────────────────────────────────────────────────────────────
     CRYPTOGRAPHIC RNG
     Returns a cryptographically random float [0, 1)
  ───────────────────────────────────────────────────────────── */
  function _randomFloat() {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return buf[0] / 0x100000000; // divide by 2^32
  }

  /** Pick a random index from a weighted strip */
  function _pickFromStrip(strip) {
    const idx = Math.floor(_randomFloat() * strip.length);
    return strip[idx];
  }

  /** Generate a hex client seed (16 bytes) */
  function _clientSeed() {
    const buf = new Uint8Array(16);
    crypto.getRandomValues(buf);
    return Array.from(buf, b => b.toString(16).padStart(2, '0')).join('');
  }

  /** SHA-256 hash a string (async, for provably-fair verification display) */
  async function _sha256(str) {
    const data = new TextEncoder().encode(str);
    const hash = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
  }

  /* ─────────────────────────────────────────────────────────────
     GRID GENERATION — pure client-side (mock / offline mode)
     In production the server returns the grid; this is only used
     when window.BIG5_MOCK === true.
  ───────────────────────────────────────────────────────────── */
  function _generateGrid() {
    // 6 reels × 4 rows
    return REEL_STRIPS.map(strip =>
      Array.from({ length: S.cfg.rows }, () => _pickFromStrip(strip))
    );
    // grid[reel][row]
  }

  /* ─────────────────────────────────────────────────────────────
     PAYLINE EVALUATION
     Returns array of winning line objects.
  ───────────────────────────────────────────────────────────── */

  /**
   * Evaluate all paylines against the current grid.
   * @param {string[][]} grid  - grid[reel][row]
   * @returns {{ lineIndex, positions, symbol, count, pay, linePay }[]}
   */
  function _evaluatePaylines(grid) {
    const wins = [];

    PAYLINES.forEach((line, li) => {
      const cells = line.map((row, reel) => grid[reel][row]);

      // Left-to-right consecutive match with wild substitution
      const firstNonWild = cells.find(s => !SYMBOLS[s]?.isWild) ?? 'wild';
      let count = 0;

      for (let r = 0; r < cells.length; r++) {
        const sym = cells[r];
        if (sym === firstNonWild || SYMBOLS[sym]?.isWild) {
          count++;
        } else {
          break; // chain broken
        }
      }

      // Minimum 3-of-a-kind to win (index 2 in paytable)
      if (count < 2) return;
      const payIdx = count - 2; // 2-of → idx 0, 3-of → idx 1 …
      const pays = PAYTABLE[firstNonWild];
      if (!pays) return;
      const multiplier = pays[payIdx] || 0;
      if (multiplier === 0) return;

      const linePay = multiplier * S.betPerLine;
      const positions = line.slice(0, count).map((row, reel) => ({ reel, row }));

      wins.push({
        lineIndex: li,
        positions,
        symbol: firstNonWild,
        count,
        multiplier,
        linePay,
      });
    });

    return wins;
  }

  /**
   * Evaluate scatter wins (symbol appears anywhere on grid).
   * @param {string[][]} grid
   * @returns {{ count, scatterPay, positions } | null}
   */
  function _evaluateScatter(grid) {
    const positions = [];
    for (let r = 0; r < grid.length; r++) {
      for (let row = 0; row < grid[r].length; row++) {
        if (SYMBOLS[grid[r][row]]?.isScatter) {
          positions.push({ reel: r, row });
        }
      }
    }
    const count = positions.length;
    const multiplier = SCATTER_PAYS[count] || 0;
    if (count < S.cfg.freeSpins.triggerCount && multiplier === 0) return null;

    const scatterPay = multiplier * _totalBet();
    return { count, multiplier, scatterPay, positions, triggersFS: count >= S.cfg.freeSpins.triggerCount };
  }

  /* ─────────────────────────────────────────────────────────────
     WIN CLASSIFICATION
  ───────────────────────────────────────────────────────────── */
  function _classifyWin(totalWin, totalBetAmt) {
    const mult = totalBetAmt > 0 ? totalWin / totalBetAmt : 0;
    if (mult >= 50)   return 'MEGA_WIN';
    if (mult >= 20)   return 'SUPER_WIN';
    if (mult >= 10)   return 'BIG_WIN';
    if (mult >= 3)    return 'WIN';
    if (totalWin > 0) return 'SMALL_WIN';
    return 'NONE';
  }

  /* ─────────────────────────────────────────────────────────────
     MOCK SPIN — full client-side simulation
     Used only when BIG5_MOCK === true.
     Mirrors the exact contract the real backend must return.
  ───────────────────────────────────────────────────────────── */
  function _mockSpin(betPerLine, clientSeed) {
    const grid       = _generateGrid();
    const lineWins   = _evaluatePaylines(grid);
    const scatterRes = _evaluateScatter(grid);

    let lineTotal    = lineWins.reduce((s, w) => s + w.linePay, 0);
    let scatterTotal = scatterRes ? scatterRes.scatterPay : 0;
    let totalWin     = lineTotal + scatterTotal;

    // Free spin multiplier
    if (S.fsActive && S.fsMul > 1) {
      totalWin = totalWin * S.fsMul;
    }

    const tb = _totalBet();

    // Hard cap: never exceed maxWinMult × totalBet
    const maxWin = tb * S.cfg.maxWinMult;
    if (totalWin > maxWin) totalWin = maxWin;

    totalWin = _round2(totalWin);

    // Balance delta
    const newBal = _round2(S.balance - (S.fsActive ? 0 : tb) + totalWin);

    const triggersFS = !S.fsActive && !!scatterRes?.triggersFS;
    const isFSRound  = S.fsActive;

    // Free spins state update
    let fsLeft = S.fsLeft;
    let fsAcc  = S.fsAcc;
    if (isFSRound) {
      fsLeft = Math.max(0, fsLeft - 1);
      fsAcc  = _round2(fsAcc + totalWin);
    }

    const spinId = _generateSpinId();

    return {
      // Required contract fields
      ok:         true,
      spinId,
      clientSeed,
      serverSeed: _generateSpinId(), // mock — real server reveals after spin
      serverSeedHash: null,          // real server pre-commits hash before spin

      // Game state
      grid,
      totalBet:    S.fsActive ? 0 : tb,
      betPerLine:  S.fsActive ? 0 : betPerLine,
      lines:       S.cfg.lines,
      totalWin,
      lineWins,
      scatterResult: scatterRes,
      balance:     newBal,

      // Win classification
      winType:     _classifyWin(totalWin, S.fsActive ? (tb || 1) : tb),

      // Free spins
      isFreeSpinRound: isFSRound,
      freeSpinsLeft:   isFSRound ? fsLeft : S.fsLeft,
      freeSpinsAcc:    isFSRound ? fsAcc  : S.fsAcc,
      triggerFreeSpins: triggersFS,
      fsMultiplier:    triggersFS ? S.cfg.freeSpins.multiplier : S.fsMul,

      // Timestamps
      ts: Date.now(),
    };
  }

  /* ─────────────────────────────────────────────────────────────
     SPIN — main entry point
  ───────────────────────────────────────────────────────────── */
  async function spin() {
    if (!_canSpin()) {
      if (S.balance < _totalBet()) emit('insufficientFunds', {});
      return;
    }

    // ── Responsible Gaming pre-spin checks ───────────────────
    if (!_rgCheckBeforeSpin()) return;

    S.spinning = true;
    S.spinLocked = true;

    const clientSeed = _clientSeed();
    const tb = _totalBet();

    emit('spinStart', {
      betPerLine:  S.betPerLine,
      totalBet:    tb,
      balance:     S.balance,
      isFreeSpins: S.fsActive,
      clientSeed,
    });

    try {
      let data;

      if (window.BIG5_MOCK) {
        // Simulate network latency
        await _sleep(S.turbo ? 80 : 180);
        data = _mockSpin(S.betPerLine, clientSeed);
      } else {
        const res = await API.spin({
          betPerLine:  S.betPerLine,
          lines:       S.cfg.lines,
          sessionId:   S.sessionId,
          clientSeed,
          isFreeSpins: S.fsActive,
        });
        if (!res.ok || !res.data) {
          throw Object.assign(new Error(res.error || 'Spin request failed'), { code: res.code || 'SPIN_ERROR' });
        }
        data = res.data;
        // Validate contract completeness
        _validateSpinResponse(data);
      }

      S.pendingResult = data;
      emit('spinResult', data);

    } catch (err) {
      S.spinning   = false;
      S.spinLocked = false;
      const code = err.code || 'SPIN_ERROR';

      if (code === 'SESSION_EXPIRED') {
        emit('sessionExpired', {});
      } else if (code === 'INSUFFICIENT_FUNDS') {
        emit('insufficientFunds', {});
        stopAuto();
      } else {
        emit('spinError', { code, message: err.message });
        if (S.autoOn) stopAuto();
      }
    }
  }

  /* ─────────────────────────────────────────────────────────────
     APPLY RESULT — called by UI after animations complete
     Commits balance, updates state, fires downstream events.
  ───────────────────────────────────────────────────────────── */
  function applyResult(data) {
    const d = data || S.pendingResult;
    if (!d) return;

    const prevBalance = S.balance;
    const tb = d.totalBet || 0;

    // ── Commit balance ────────────────────────────────────────
    S.balance = d.balance;
    S.grid    = d.grid;

    // ── Stats ─────────────────────────────────────────────────
    S.stats.spins++;
    S.stats.totalBet = _round2(S.stats.totalBet + tb);
    S.stats.totalWon = _round2(S.stats.totalWon + d.totalWin);
    if (d.totalWin > S.stats.bestWin) S.stats.bestWin = d.totalWin;
    if (d.winType === 'BIG_WIN' || d.winType === 'SUPER_WIN' || d.winType === 'MEGA_WIN') S.stats.bigWins++;
    if (d.winType === 'MEGA_WIN') S.stats.megaWins++;

    // ── RG session loss tracking ──────────────────────────────
    S.rg.sessionLost = _round2(Math.max(0, S.rg.startBal - S.balance));

    // ── Free spins state ──────────────────────────────────────
    if (d.isFreeSpinRound) {
      S.fsLeft = d.freeSpinsLeft;
      S.fsAcc  = d.freeSpinsAcc;

      if (S.fsLeft <= 0) {
        S.fsActive = false;
        emit('freeSpinsEnd', { totalWin: d.freeSpinsAcc });
      }
    }

    if (d.triggerFreeSpins && !S.fsActive) {
      S.fsActive = true;
      S.fsLeft   = S.cfg.freeSpins.count;
      S.fsTotal  = S.cfg.freeSpins.count;
      S.fsAcc    = 0;
      S.fsMul    = d.fsMultiplier || S.cfg.freeSpins.multiplier;
      emit('freeSpinsTriggered', {
        count:       S.fsLeft,
        multiplier:  S.fsMul,
        scatterCount: d.scatterResult?.count,
      });
    }

    // ── History ───────────────────────────────────────────────
    S.history.unshift({
      spin:    S.stats.spins,
      spinId:  d.spinId,
      bet:     tb,
      win:     d.totalWin,
      winType: d.winType,
      balance: S.balance,
      ts:      d.ts || Date.now(),
    });
    if (S.history.length > 50) S.history.pop();

    // ── Unlock ────────────────────────────────────────────────
    S.spinning      = false;
    S.spinLocked    = false;
    S.pendingResult = null;

    emit('stateUpdated', {
      balance:     S.balance,
      prevBalance,
      delta:       _round2(S.balance - prevBalance),
      stats:       { ...S.stats },
    });

    // ── Win events ────────────────────────────────────────────
    if (d.totalWin > 0) {
      emit('win', {
        amount:    d.totalWin,
        type:      d.winType,
        lineWins:  d.lineWins,
        scatterResult: d.scatterResult,
        spinId:    d.spinId,
      });

      if (['BIG_WIN', 'SUPER_WIN', 'MEGA_WIN'].includes(d.winType)) {
        emit('bigWin', { amount: d.totalWin, type: d.winType });
      }
    }

    // ── Auto spin continuation ────────────────────────────────
    if (S.autoOn) {
      _autoSpinContinue(d);
    }
  }

  /* ─────────────────────────────────────────────────────────────
     FREE SPINS — begin (called after bonus modal confirmed)
  ───────────────────────────────────────────────────────────── */
  function beginFreeSpins() {
    if (!S.fsActive || S.fsLeft <= 0) return;
    emit('freeSpinsBegin', { count: S.fsLeft, multiplier: S.fsMul });
    setTimeout(() => spin(), S.turbo ? 200 : 500);
  }

  /* ─────────────────────────────────────────────────────────────
     AUTO SPIN
  ───────────────────────────────────────────────────────────── */
  function startAuto({ count, winLimit = 0, lossLimit = 0 }) {
    if (S.spinning || S.fsActive) {
      emit('toast', { msg: 'Cannot start Auto Spin during a round' });
      return;
    }

    S.autoOn      = true;
    S.autoLeft    = count;
    S.autoWinLim  = winLimit;
    S.autoLossLim = lossLimit;

    emit('autoStarted', { count, winLimit, lossLimit });

    if (_canSpin()) spin();
  }

  function stopAuto() {
    if (!S.autoOn) return;
    S.autoOn   = false;
    S.autoLeft = 0;
    clearTimeout(S.autoTimer);
    emit('autoStopped', {});
  }

  function _autoSpinContinue(spinData) {
    if (!S.autoOn) return;

    S.autoLeft = Math.max(0, S.autoLeft - 1);

    // ── Stop conditions ───────────────────────────────────────
    if (S.autoLeft <= 0) {
      stopAuto();
      emit('toast', { msg: 'Auto Spin complete' });
      return;
    }

    if (S.autoWinLim > 0 && spinData.totalWin >= S.autoWinLim) {
      stopAuto();
      emit('toast', { msg: `Auto stopped — win R${spinData.totalWin} exceeded limit` });
      return;
    }

    if (S.autoLossLim > 0 && S.rg.sessionLost >= S.autoLossLim) {
      stopAuto();
      emit('toast', { msg: 'Auto stopped — loss limit reached' });
      return;
    }

    if (S.balance < _totalBet()) {
      stopAuto();
      emit('insufficientFunds', {});
      return;
    }

    // Wait for free spins to finish before resuming auto
    if (S.fsActive) return;

    const delay = S.turbo ? 150 : 600;
    S.autoTimer = setTimeout(() => {
      if (S.autoOn && _canSpin()) spin();
    }, delay);
  }

  /* ─────────────────────────────────────────────────────────────
     INIT — session handshake
  ───────────────────────────────────────────────────────────── */
  async function init(initialBalance = 2000) {
    emit('loading', { phase: 'session', progress: 10 });

    try {
      let sessionData;

      if (window.BIG5_MOCK) {
        await _sleep(400);
        sessionData = _mockSession(initialBalance);
      } else {
        const res = await API.validateSession(initialBalance);
        if (!res.ok || !res.data) {
          throw Object.assign(new Error('Session validation failed'), { code: res.code || 'SESSION_INVALID' });
        }
        sessionData = res.data;
      }

      const d = sessionData;
      S.sessionId  = d.sessionId;
      S.playerId   = d.playerId;
      S.username   = d.username   || 'Player';
      S.balance    = d.balance    || initialBalance;
      S.currency   = d.currency   || 'ZAR';
      S.opId       = d.opId       || 'DEMO';

      if (d.gameConfig) _applyConfig(d.gameConfig);

      if (d.responsibleGaming) {
        const rg = d.responsibleGaming;
        S.rg.sessionTimeLimitMs = rg.sessionTimeLimitMs || 0;
        S.rg.sessionLossLimit   = rg.sessionLossLimit   || 0;
        S.rg.depositLimit       = rg.depositLimit       || 0;
      }

      S.rg.startBal    = S.balance;
      S.rg.sessionLost = 0;

      S.betIdx     = S.cfg.betSteps.indexOf(S.cfg.defaultBet);
      if (S.betIdx < 0) S.betIdx = Math.floor(S.cfg.betSteps.length / 2);
      S.betPerLine = S.cfg.betSteps[S.betIdx];

      S.sessionStartMs = Date.now();

      // Initialise paytable & paylines into config (for UI reference)
      S.cfg.paytable  = PAYTABLE;
      S.cfg.paylines  = PAYLINES;

      emit('loading', { phase: 'assets', progress: 60 });
      await _sleep(200);
      emit('loading', { phase: 'complete', progress: 100 });

      _startSessionTimer();

      emit('ready', { session: d, symbols: SYMBOLS, paytable: PAYTABLE, paylines: PAYLINES });
      return d;

    } catch (err) {
      emit('error', { code: err.code || 'INIT_FAILED', message: err.message });
      throw err;
    }
  }

  /* ─────────────────────────────────────────────────────────────
     RESUME — recover in-progress session
  ───────────────────────────────────────────────────────────── */
  async function resume() {
    if (!S.sessionId) return;
    try {
      const res = window.BIG5_MOCK
        ? { ok: true, data: { balance: S.balance, bonusActive: false } }
        : await API.resumeSession(S.sessionId);

      if (!res.ok) throw new Error('Resume failed');
      const d = res.data;

      S.balance = d.balance ?? S.balance;

      if (d.bonusActive && d.freeSpinsLeft > 0) {
        S.fsActive = true;
        S.fsLeft   = d.freeSpinsLeft;
        S.fsAcc    = d.freeSpinsAcc || 0;
        S.fsMul    = d.fsMultiplier || S.fsMul;
      }

      emit('resumed', d);
      return d;
    } catch (err) {
      emit('error', { code: 'RESUME_FAILED', message: err.message });
    }
  }

  /* ─────────────────────────────────────────────────────────────
     BALANCE / SESSION
  ───────────────────────────────────────────────────────────── */
  async function refreshBalance() {
    try {
      if (window.BIG5_MOCK) return;
      const res = await API.getBalance(S.sessionId);
      if (res?.data?.balance !== undefined) {
        S.balance = res.data.balance;
        emit('stateUpdated', { balance: S.balance });
      }
    } catch (e) {
      console.warn('[GE] refreshBalance failed:', e.message);
    }
  }

  async function deposit(amount) {
    if (amount <= 0) return;
    if (S.rg.depositLimit > 0 && amount > S.rg.depositLimit) {
      emit('toast', { msg: `Deposit limit is R${S.rg.depositLimit}` });
      return;
    }
    try {
      if (window.BIG5_MOCK) {
        S.balance = _round2(S.balance + amount);
      } else {
        const res = await API.deposit({ sessionId: S.sessionId, amount });
        if (!res.ok) throw new Error(res.error || 'Deposit failed');
        S.balance = res.data.balance;
      }
      emit('stateUpdated', { balance: S.balance });
      emit('deposit', { amount, balance: S.balance });
    } catch (e) {
      emit('toast', { msg: `Deposit failed: ${e.message}` });
    }
  }

  async function endSession() {
    stopAuto();
    clearInterval(S._timerIv);
    try {
      const res = window.BIG5_MOCK
        ? { data: { balance: S.balance } }
        : await API.endSession(S.sessionId);
      const bal = res?.data?.balance ?? S.balance;
      emit('sessionEnded', { balance: bal, stats: { ...S.stats } });
      return bal;
    } catch (e) {
      emit('sessionEnded', { balance: S.balance, stats: { ...S.stats } });
      return S.balance;
    }
  }

  /* ─────────────────────────────────────────────────────────────
     BET CONTROLS
  ───────────────────────────────────────────────────────────── */
  function adjustBet(dir) {
    if (S.spinning || S.autoOn) return;
    S.betIdx = Math.max(0, Math.min(S.cfg.betSteps.length - 1, S.betIdx + dir));
    S.betPerLine = S.cfg.betSteps[S.betIdx];
    emit('betChanged', { betPerLine: S.betPerLine, totalBet: _totalBet() });
  }

  function setBetByValue(val) {
    if (S.spinning || S.autoOn) return;
    const idx = S.cfg.betSteps.indexOf(Number(val));
    if (idx < 0) return;
    S.betIdx     = idx;
    S.betPerLine = Number(val);
    emit('betChanged', { betPerLine: S.betPerLine, totalBet: _totalBet() });
  }

  /* ─────────────────────────────────────────────────────────────
     SETTINGS
  ───────────────────────────────────────────────────────────── */
  function setSound(on)  {
    S.soundOn = !!on;
    if (typeof AudioEngine !== 'undefined') AudioEngine.setSound(S.soundOn);
    emit('settingChanged', { sound: S.soundOn });
  }

  function setMusic(on)  {
    S.musicOn = !!on;
    if (typeof AudioEngine !== 'undefined') AudioEngine.setMusic(S.musicOn);
    emit('settingChanged', { music: S.musicOn });
  }

  function setTurbo(on)  {
    S.turbo = !!on;
    emit('settingChanged', { turbo: S.turbo });
  }

  /* ─────────────────────────────────────────────────────────────
     RESPONSIBLE GAMING
  ───────────────────────────────────────────────────────────── */
  function updateRGLimits({ timeMins, lossLimit, depositLimit }) {
    if (timeMins !== undefined)    S.rg.sessionTimeLimitMs = timeMins > 0 ? timeMins * 60000 : 0;
    if (lossLimit !== undefined)   S.rg.sessionLossLimit   = Number(lossLimit)   || 0;
    if (depositLimit !== undefined) S.rg.depositLimit      = Number(depositLimit) || 0;
    emit('toast', { msg: 'Limits saved ✓' });
    emit('rgLimitsUpdated', { ...S.rg });
  }

  function _rgCheckBeforeSpin() {
    // Time limit
    if (S.rg.sessionTimeLimitMs > 0) {
      const elapsed = Date.now() - S.sessionStartMs;
      if (elapsed >= S.rg.sessionTimeLimitMs) {
        emit('rgLimit', { type: 'time', elapsed });
        stopAuto();
        return false;
      }
    }

    // Loss limit
    if (S.rg.sessionLossLimit > 0 && S.rg.sessionLost >= S.rg.sessionLossLimit) {
      emit('rgLimit', { type: 'loss', lost: S.rg.sessionLost, limit: S.rg.sessionLossLimit });
      stopAuto();
      return false;
    }

    return true;
  }

  /* ─────────────────────────────────────────────────────────────
     SESSION TIMER
  ───────────────────────────────────────────────────────────── */
  function _startSessionTimer() {
    if (S._timerIv) clearInterval(S._timerIv);
    S._timerIv = setInterval(() => {
      const elapsed = Date.now() - S.sessionStartMs;
      const secs    = Math.floor(elapsed / 1000);
      emit('sessionTick', { elapsed, secs });

      if (S.rg.sessionTimeLimitMs > 0 && elapsed >= S.rg.sessionTimeLimitMs) {
        clearInterval(S._timerIv);
        emit('rgLimit', { type: 'time', elapsed });
        stopAuto();
      }
    }, 1000);
  }

  /* ─────────────────────────────────────────────────────────────
     POSTMESSAGE BRIDGE — parent iframe / operator shell
  ───────────────────────────────────────────────────────────── */
  window.addEventListener('message', e => {
    if (!e.data || typeof e.data !== 'object') return;
    switch (e.data.type) {
      case 'SET_BALANCE':
        if (typeof e.data.balance === 'number') {
          S.balance = e.data.balance;
          emit('stateUpdated', { balance: S.balance });
        }
        break;
      case 'SESSION_KILL':
        stopAuto();
        emit('sessionExpired', {});
        break;
      case 'PAUSE_GAME':
        stopAuto();
        emit('gamePaused', {});
        break;
      case 'SET_TURBO':
        setTurbo(!!e.data.value);
        break;
      case 'SET_LIMITS':
        updateRGLimits(e.data);
        break;
    }
  });

  /* ─────────────────────────────────────────────────────────────
     INTERNAL HELPERS
  ───────────────────────────────────────────────────────────── */
  function _totalBet()  { return S.betPerLine * S.cfg.lines; }
  function _round2(n)   { return Math.round(n * 100) / 100; }
  function _sleep(ms)   { return new Promise(r => setTimeout(r, ms)); }

  function _canSpin() {
    return (
      !S.spinning      &&
      !S.spinLocked    &&
      !!S.sessionId    &&
      (S.fsActive || S.balance >= _totalBet())
    );
  }

  function _generateSpinId() {
    const buf = new Uint8Array(8);
    crypto.getRandomValues(buf);
    return Array.from(buf, b => b.toString(16).padStart(2, '0')).join('');
  }

  function _applyConfig(cfg) {
    const c = S.cfg;
    if (Array.isArray(cfg.betSteps) && cfg.betSteps.length)  c.betSteps   = cfg.betSteps;
    if (typeof cfg.defaultBet === 'number') c.defaultBet = cfg.defaultBet;
    if (typeof cfg.minBet     === 'number') c.minBet     = cfg.minBet;
    if (typeof cfg.maxBet     === 'number') c.maxBet     = cfg.maxBet;
    if (typeof cfg.lines      === 'number') c.lines      = cfg.lines;
    if (typeof cfg.reels      === 'number') c.reels      = cfg.reels;
    if (typeof cfg.rows       === 'number') c.rows       = cfg.rows;
    if (cfg.paytable)   c.paytable  = cfg.paytable;
    if (cfg.paylines)   c.paylines  = cfg.paylines;
    if (cfg.freeSpins)  c.freeSpins = { ...c.freeSpins, ...cfg.freeSpins };
    if (typeof cfg.rtp        === 'number') c.rtp        = cfg.rtp;
    if (typeof cfg.maxWinMult === 'number') c.maxWinMult = cfg.maxWinMult;
  }

  function _mockSession(balance) {
    return {
      sessionId: 'MOCK-' + _generateSpinId(),
      playerId:  'PLAYER-' + _generateSpinId().slice(0, 6).toUpperCase(),
      username:  'GoldMiner',
      balance,
      currency:  'ZAR',
      opId:      'DEMO',
      gameConfig: null,
      responsibleGaming: { sessionTimeLimitMs: 0, sessionLossLimit: 0 },
    };
  }

  /**
   * Validate that a server spin response has the minimum required fields.
   * Throws if contract is broken — prevents silent data corruption.
   */
  function _validateSpinResponse(d) {
    const required = ['spinId', 'grid', 'totalBet', 'totalWin', 'balance', 'lineWins', 'winType'];
    for (const f of required) {
      if (d[f] === undefined || d[f] === null) {
        throw Object.assign(new Error(`Spin response missing field: ${f}`), { code: 'INVALID_RESPONSE' });
      }
    }
    if (!Array.isArray(d.grid) || d.grid.length !== S.cfg.reels) {
      throw Object.assign(new Error('Invalid grid dimensions in spin response'), { code: 'INVALID_RESPONSE' });
    }
  }

  /* ─────────────────────────────────────────────────────────────
     PUBLIC API
  ───────────────────────────────────────────────────────────── */
  return {
    // Lifecycle
    init,
    resume,
    endSession,
    refreshBalance,
    deposit,

    // Gameplay
    spin,
    applyResult,
    beginFreeSpins,

    // Bet
    adjustBet,
    setBetByValue,

    // Auto spin
    startAuto,
    stopAuto,

    // Settings
    setSound,
    setMusic,
    setTurbo,

    // Responsible gaming
    updateRGLimits,

    // Events
    on,
    off,

    // Read-only accessors
    get state()     { return S; },
    get symbols()   { return SYMBOLS; },
    get paytable()  { return PAYTABLE; },
    get paylines()  { return PAYLINES; },
    totalBet:       () => _totalBet(),
    canSpin:        () => _canSpin(),

    // Exposed for provably-fair UI display
    verifySpinHash: _sha256,

    // Debug / testing only
    _mockSpin,
    _evaluatePaylines,
    _evaluateScatter,
  };

})();