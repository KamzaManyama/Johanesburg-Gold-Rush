/**
 * Johanesburg Gold Rush — Game Engine
 * State machine. All game outcomes come from API.
 * No RNG here — we only render what the server says.
 */

'use strict';

const GameEngine = (() => {

  const S = {
    sessionId:   null,
    playerId:    null,
    username:    'Player',
    balance:     0,
    currency:    'ZAR',
    opId:        'DEMO',

    cfg: {
      reels:      6,
      rows:       4,
      lines:      10,
      betSteps:   [1,2,5,10,20,50,100],
      defaultBet: 5,
      minBet:     1,
      maxBet:     100,
      paytable:   {},
      paylines:   [],
      freeSpins:  { count: 10, multiplier: 3, triggerCount: 3 },
    },

    betIdx:   2,
    betPerLine: 5,

    grid: Array.from({ length: 6 }, () => Array(4).fill('nugget')),

    spinning:    false,
    spinLocked:  false,

    fsActive:    false,
    fsLeft:      0,
    fsTotal:     0,
    fsAcc:       0,
    fsMul:       3,

    autoOn:      false,
    autoLeft:    0,
    autoTimer:   null,
    autoWinLim:  500,
    autoLossLim: 100,

    rg: {
      sessionTimeLimitMs: 3600000,
      sessionLossLimit:   500,
      startBal:           0,
    },

    history:     [],
    stats:       { spins: 0, totalBet: 0, totalWon: 0, bestWin: 0 },

    turbo:       false,
    soundOn:     true,
    musicOn:     true,

    sessionStartMs: 0,

    pendingResult: null,
  };

  /* SYMBOL DEFINITIONS — Gold Rush theme */
  const SYMBOLS = {
    // High value
    dynamite: { name: 'Dynamite',   src: 'assets/images/dynamite.jpg'   },
    pickaxe:  { name: 'Pickaxe',    src: 'assets/images/pickaxe.jpg'    },
    lantern:  { name: 'Lantern',    src: 'assets/images/lantern.jpg'    },
    cart:     { name: 'Mine Cart',  src: 'assets/images/cart.jpg'       },
    // Mid value
    helmet:   { name: 'Helmet',     src: 'assets/images/helmet.png'     },
    boots:    { name: 'Boots',      src: 'assets/images/boots.jpg'      },
    nugget:   { name: 'Gold Nugget',src: 'assets/images/nugget.jpg'     },
    // Special
    wild:     { name: 'Wild',       src: 'assets/images/wild.gif'       },
    scatter:  { name: 'Scatter',    src: 'assets/images/scatter.png'    },
  };

  const _listeners = {};
  function on(evt, fn)    { (_listeners[evt] = _listeners[evt] || []).push(fn); }
  function emit(evt, data) { (_listeners[evt] || []).forEach(fn => fn(data)); }

  async function init(initialBalance = 2000) {
    emit('loading', { phase: 'session' });
    try {
      const res = await API.validateSession(initialBalance);
      if (!res.ok || !res.data) throw new Error('Session validation failed');

      const d = res.data;
      S.sessionId  = d.sessionId;
      S.playerId   = d.playerId;
      S.username   = d.username;
      S.balance    = d.balance;
      S.currency   = d.currency || 'ZAR';
      S.opId       = d.opId;

      if (d.gameConfig) applyConfig(d.gameConfig);

      if (d.responsibleGaming) {
        S.rg.sessionTimeLimitMs = d.responsibleGaming.sessionTimeLimitMs || 3600000;
        S.rg.sessionLossLimit   = d.responsibleGaming.sessionLossLimit   || 500;
      }
      S.rg.startBal = S.balance;

      S.betIdx     = S.cfg.betSteps.indexOf(S.cfg.defaultBet);
      if (S.betIdx < 0) S.betIdx = 2;
      S.betPerLine = S.cfg.betSteps[S.betIdx];

      S.sessionStartMs = Date.now();
      startSessionTimer();

      emit('ready', { session: d });
      return d;

    } catch (err) {
      emit('error', { code: err.code || 'INIT_FAILED', message: err.message });
      throw err;
    }
  }

  async function resume() {
    if (!S.sessionId) return;
    try {
      const res = await API.resumeSession(S.sessionId);
      if (!res.ok) throw new Error('Resume failed');
      const d = res.data;
      S.balance = d.balance;
      if (d.bonusActive) {
        S.fsActive = true;
        S.fsLeft   = d.freeSpinsLeft;
        S.fsAcc    = d.freeSpinsAcc;
      }
      emit('resumed', d);
      return d;
    } catch (err) {
      emit('error', { code: 'RESUME_FAILED', message: err.message });
    }
  }

  function applyConfig(cfg) {
    if (cfg.betSteps)   S.cfg.betSteps   = cfg.betSteps;
    if (cfg.defaultBet) S.cfg.defaultBet = cfg.defaultBet;
    if (cfg.minBet)     S.cfg.minBet     = cfg.minBet;
    if (cfg.maxBet)     S.cfg.maxBet     = cfg.maxBet;
    if (cfg.lines)      S.cfg.lines      = cfg.lines;
    if (cfg.paytable)   S.cfg.paytable   = cfg.paytable;
    if (cfg.paylines)   S.cfg.paylines   = cfg.paylines;
    if (cfg.freeSpins)  S.cfg.freeSpins  = cfg.freeSpins;
    if (cfg.reels)      S.cfg.reels      = cfg.reels;
    if (cfg.rows)       S.cfg.rows       = cfg.rows;
  }

  function adjustBet(dir) {
    S.betIdx = Math.max(0, Math.min(S.cfg.betSteps.length - 1, S.betIdx + dir));
    S.betPerLine = S.cfg.betSteps[S.betIdx];
    emit('betChanged', { betPerLine: S.betPerLine, totalBet: totalBet() });
  }

  function setBetByValue(val) {
    const idx = S.cfg.betSteps.indexOf(val);
    if (idx >= 0) { S.betIdx = idx; S.betPerLine = val; }
    emit('betChanged', { betPerLine: S.betPerLine, totalBet: totalBet() });
  }

  function totalBet() { return S.betPerLine * S.cfg.lines; }

  function canSpin() {
    return !S.spinning && !S.spinLocked && S.balance >= totalBet() && !!S.sessionId;
  }

  async function spin() {
    if (!canSpin()) return;

    const sessionLost = S.rg.startBal - S.balance;
    if (S.rg.sessionLossLimit > 0 && sessionLost >= S.rg.sessionLossLimit) {
      emit('rgLimit', { type: 'loss', value: sessionLost });
      stopAuto();
      return;
    }

    S.spinning = true;
    emit('spinStart', { betPerLine: S.betPerLine, totalBet: totalBet() });

    const seedArr = new Uint8Array(8);
    crypto.getRandomValues(seedArr);
    const clientSeed = Array.from(seedArr, b => b.toString(16).padStart(2, '0')).join('');

    try {
      const res = await API.spin({
        betPerLine:  S.betPerLine,
        lines:       S.cfg.lines,
        sessionId:   S.sessionId,
        clientSeed,
      });

      if (!res.ok || !res.data) throw new Error('Spin request failed');

      S.pendingResult = res.data;
      emit('spinResult', res.data);

    } catch (err) {
      S.spinning = false;
      emit('spinError', { code: err.code || 'SPIN_ERROR', message: err.message });
      if (S.autoOn) stopAuto();
    }
  }

  function applyResult(data) {
    const d = data || S.pendingResult;
    if (!d) return;

    S.balance    = d.balance;
    S.grid       = d.grid;

    S.stats.spins++;
    S.stats.totalBet += d.totalBet;
    S.stats.totalWon += d.totalWin;
    if (d.totalWin > S.stats.bestWin) S.stats.bestWin = d.totalWin;

    if (d.isFreeSpinRound) {
      S.fsLeft  = d.freeSpinsLeft;
      S.fsAcc   = d.freeSpinsAcc;
      if (S.fsLeft <= 0) {
        S.fsActive = false;
        emit('freeSpinsEnd', { total: d.freeSpinsAcc });
      }
    }

    if (d.triggerFreeSpins) {
      S.fsActive = true;
      S.fsLeft   = S.cfg.freeSpins.count;
      S.fsTotal  = S.cfg.freeSpins.count;
      S.fsAcc    = 0;
      S.fsMul    = d.fsMultiplier || S.cfg.freeSpins.multiplier;
    }

    S.history.unshift({
      spin:    S.stats.spins,
      spinId:  d.spinId,
      bet:     d.totalBet,
      win:     d.totalWin,
      balance: S.balance,
      ts:      Date.now(),
    });
    if (S.history.length > 20) S.history.pop();

    S.spinning      = false;
    S.pendingResult = null;

    emit('stateUpdated', { balance: S.balance });

    if (S.autoOn) {
      if (S.autoLeft > 0) {
        S.autoLeft--;
        if (S.autoLeft <= 0) { stopAuto(); return; }
        if (d.totalWin >= S.autoWinLim && S.autoWinLim > 0) {
          emit('toast', { msg: 'Auto stopped — win limit reached' });
          stopAuto(); return;
        }
        if (S.balance < S.autoLossLim) {
          emit('toast', { msg: 'Auto stopped — balance below limit' });
          stopAuto(); return;
        }
        if (canSpin()) {
          S.autoTimer = setTimeout(() => spin(), S.turbo ? 200 : 500);
        }
      } else {
        stopAuto();
      }
    }
  }

  function beginFreeSpins() {
    emit('freeSpinsBegin', { count: S.fsLeft, multiplier: S.fsMul });
    setTimeout(() => spin(), 500);
  }

  function startAuto({ count, winLimit, lossLimit }) {
    S.autoOn      = true;
    S.autoLeft    = count;
    S.autoWinLim  = winLimit  || 500;
    S.autoLossLim = lossLimit || 100;
    emit('autoStarted', { count });
    if (!S.spinning) spin();
  }

  function stopAuto() {
    S.autoOn   = false;
    S.autoLeft = 0;
    clearTimeout(S.autoTimer);
    emit('autoStopped', {});
  }

  async function endSession() {
    stopAuto();
    try {
      const res = await API.endSession(S.sessionId);
      const bal = res?.data?.balance ?? S.balance;
      emit('sessionEnded', { balance: bal });
      return bal;
    } catch (e) {
      emit('sessionEnded', { balance: S.balance });
      return S.balance;
    }
  }

  async function refreshBalance() {
    try {
      const res = await API.getBalance(S.sessionId);
      if (res?.data?.balance !== undefined) {
        S.balance = res.data.balance;
        emit('stateUpdated', { balance: S.balance });
      }
    } catch (e) {}
  }

  let _timerIv = null;
  function startSessionTimer() {
    if (_timerIv) clearInterval(_timerIv);
    _timerIv = setInterval(() => {
      const elapsed = Date.now() - S.sessionStartMs;
      emit('sessionTick', { elapsed, secs: Math.floor(elapsed / 1000) });
      if (S.rg.sessionTimeLimitMs > 0 && elapsed >= S.rg.sessionTimeLimitMs) {
        clearInterval(_timerIv);
        emit('rgLimit', { type: 'time', elapsed });
        stopAuto();
      }
    }, 1000);
  }

  function setSound(on)  { S.soundOn = on; AudioEngine.setSound(on); }
  function setMusic(on)  { S.musicOn = on; AudioEngine.setMusic(on); }
  function setTurbo(on)  { S.turbo   = on; emit('settingChanged', { turbo: on }); }

  function updateRGLimits({ timeMins, lossLimit }) {
    if (timeMins)   S.rg.sessionTimeLimitMs = timeMins * 60000;
    if (lossLimit)  S.rg.sessionLossLimit   = lossLimit;
    emit('toast', { msg: 'Limits saved' });
  }

  window.addEventListener('message', e => {
    if (!e.data || typeof e.data !== 'object') return;
    switch (e.data.type) {
      case 'SET_BALANCE':
        S.balance = e.data.balance;
        emit('stateUpdated', { balance: S.balance });
        break;
      case 'SESSION_KILL':
        stopAuto();
        emit('sessionExpired', {});
        break;
      case 'PAUSE_GAME':
        stopAuto();
        emit('gamePaused', {});
        break;
    }
  });

  return {
    on,
    init,
    resume,
    spin,
    applyResult,
    beginFreeSpins,
    startAuto,
    stopAuto,
    endSession,
    refreshBalance,
    adjustBet,
    setBetByValue,
    setSound,
    setMusic,
    setTurbo,
    updateRGLimits,
    totalBet,
    canSpin,
    get state()   { return S; },
    get symbols() { return SYMBOLS; },
  };

})();