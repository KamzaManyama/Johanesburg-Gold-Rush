/**
 * Big Five Bonanza — UI Controller
 * Renders game state driven by GameEngine events.
 * All money flows through the engine which calls the API.
 * Zero game logic here — pure presentation layer.
 */

'use strict';

const UI = (() => {

  /* ─────────────────────────────────────────
   * DOM REFS
   * ───────────────────────────────────────── */
  const $ = id => document.getElementById(id);
  const E = {
    loader:     $('loader'),
    ldBar:      $('ld-bar'),
    ldStatus:   $('ld-status'),
    game:       $('game'),
    reelsGrid:  $('reels-grid'),
    plRow:      $('pl-row'),
    winDisplay: $('win-display'),
    wdAmount:   $('wd-amount'),
    navBal:     $('nav-bal'),
    betDisp:    $('bet-disp'),
    btnSpin:    $('btn-spin'),
    btnStop:    $('btn-stop'),
    celScreen:  $('cel-screen'),
    celType:    $('cel-type'),
    celTitle:   $('cel-title'),
    celAmount:  $('cel-amount'),
    splUser:    $('spl-user'),
    splTime:    $('spl-time'),
    fsHud:      $('fs-hud'),
    fsNum:      $('fs-num'),
    fsMulDisp:  $('fs-mul-disp'),
    fsMulBadge: $('fs-mul-badge'),
    netInd:     $('net-ind'),
    toast:      $('toast'),
    niSound:    $('ni-sound'),
    niTurbo:    $('ni-turbo'),
    niAuto:     $('ni-auto'),
  };

  /* ─────────────────────────────────────────
   * SPIN ANIMATION CONFIG
   * ───────────────────────────────────────── */
  const ANIM = {
    get spinGap()  { return GameEngine.state.turbo ? 55  : 110 },
    get spinDur()  { return GameEngine.state.turbo ? 130 : 240 },
    get spinIter() { return GameEngine.state.turbo ? 4   : 8   },
    get spinFps()  { return GameEngine.state.turbo ? 30  : 52  },
    get autoDelay(){ return GameEngine.state.turbo ? 200 : 500 },
  };

  /* ─────────────────────────────────────────
   * SYMBOL POOL (for client-side reel animation only)
   * Real symbols come from server result
   * ───────────────────────────────────────── */
  const ANIM_POOL = [
    'nugget','nugget','nugget','boots','boots','helmet','cart',
    'lantern','pickaxe','dynamite','wild','scatter',
  ];
  function randAnimSym() { return ANIM_POOL[Math.floor(Math.random() * ANIM_POOL.length)]; }

  /* ─────────────────────────────────────────
   * FORMAT HELPERS
   * ───────────────────────────────────────── */
  function fmt(n)  { return Number(n).toLocaleString('en-ZA', { minimumFractionDigits:2, maximumFractionDigits:2 }); }
  function fmtI(n) { return Number(n).toLocaleString('en-ZA'); }
  function fmtTime(secs) {
    return String(Math.floor(secs/60)).padStart(2,'0') + ':' + String(secs%60).padStart(2,'0');
  }

  /* ─────────────────────────────────────────
   * GRID BUILD
   * ───────────────────────────────────────── */
  function buildGrid() {
    const S = GameEngine.symbols;
    E.reelsGrid.innerHTML = '';
    E.plRow.innerHTML     = '';

    for (let c = 0; c < 6; c++) {
      const col = document.createElement('div');
      col.className = 'reel-col';
      col.id = 'col' + c;
      for (let r = 0; r < 4; r++) {
        const cell = document.createElement('div');
        cell.className = 'reel-cell';
        cell.id = `c${r}x${c}`;
        const img = document.createElement('img');
        img.className = 'sym-img';
        img.alt = '';
        img.loading = 'eager';
        cell.appendChild(img);
        col.appendChild(cell);
      }
      E.reelsGrid.appendChild(col);
    }

    for (let i = 0; i < 10; i++) {
      const dot = document.createElement('div');
      dot.className = 'pl-dot';
      dot.id = 'pld' + i;
      E.plRow.appendChild(dot);
    }
  }

  function cell(r, c)  { return document.getElementById(`c${r}x${c}`) }
  function dot(i)      { return document.getElementById('pld' + i) }

  function setCell(el, sid) {
    if (!el) return;
    const img = el.querySelector('.sym-img');
    if (!img) return;
    const sym = GameEngine.symbols[sid];
    img.src = sym ? sym.src : '';
    img.className = 'sym-img' +
      (sid === 'scatter' ? ' is-scatter' : '') +
      (sid === 'wild'    ? ' is-wild'    : '');
    el.dataset.s = sid;
  }

  function fillRandom() {
    for (let c = 0; c < 6; c++)
      for (let r = 0; r < 4; r++)
        setCell(cell(r, c), randAnimSym());
  }

  function applyGrid(grid) {
    for (let c = 0; c < 6; c++)
      for (let r = 0; r < 4; r++)
        setCell(cell(r, c), grid[c][r]);
  }

  /* ─────────────────────────────────────────
   * REEL SPIN ANIMATION
   * ───────────────────────────────────────── */
  function spinReel(col, finalSyms, startDelay, dur) {
    const cells = [0,1,2,3].map(r => cell(r, col));
    return new Promise(resolve => {
      setTimeout(() => {
        cells.forEach(c => c && c.classList.add('spinning'));
        let ticks = 0;
        const iv = setInterval(() => {
          cells.forEach(c => c && setCell(c, randAnimSym()));
          AudioEngine.sfx.reelTick();
          if (++ticks >= ANIM.spinIter) clearInterval(iv);
        }, ANIM.spinFps);

        setTimeout(() => {
          cells.forEach(c => c && c.classList.remove('spinning'));
          finalSyms.forEach((sid, r) => setCell(cells[r], sid));
          AudioEngine.sfx.reelStop(col);
          resolve();
        }, dur);
      }, startDelay);
    });
  }

  /* ─────────────────────────────────────────
   * WIN HIGHLIGHT
   * ───────────────────────────────────────── */
  function showWinCells(winLines, paylines) {
    winLines.forEach(wl => {
      const pl = paylines[wl.lineIndex];
      if (!pl) return;
      pl.forEach((row, col) => {
        const c = cell(row, col);
        if (c) c.classList.add('win-cell');
      });
      const d = dot(wl.lineIndex);
      if (d) d.classList.add('lit');
    });
  }

  function clearWinCells() {
    document.querySelectorAll('.reel-cell').forEach(c => c.classList.remove('win-cell'));
    for (let i = 0; i < 10; i++) { const d = dot(i); if (d) d.classList.remove('lit'); }
    E.winDisplay.classList.remove('show');
  }

  /* ─────────────────────────────────────────
   * BALANCE DISPLAY
   * ───────────────────────────────────────── */
  let _lastBal = null;
  function updateBalance(bal) {
    E.navBal.textContent = fmt(bal);
    if (_lastBal !== null) {
      E.navBal.classList.remove('up', 'down');
      if (bal > _lastBal) {
        E.navBal.classList.add('up');
        setTimeout(() => E.navBal.classList.remove('up'), 600);
      } else if (bal < _lastBal) {
        E.navBal.classList.add('down');
        setTimeout(() => E.navBal.classList.remove('down'), 600);
      }
    }
    _lastBal = bal;
  }

  function updateBetDisplay() {
    const S = GameEngine.state;
    E.betDisp.textContent = S.betPerLine;
    $('modal-total-bet') && ($('modal-total-bet').textContent = GameEngine.totalBet() + ' ZAR');
    $('modal-lines')     && ($('modal-lines').textContent = S.cfg.lines);
  }

  function updateBtnState() {
    E.btnSpin.disabled = !GameEngine.canSpin();
  }

  /* ─────────────────────────────────────────
   * PAYTABLE RENDER
   * ───────────────────────────────────────── */
  function buildPaytable() {
    const S    = GameEngine.state;
    const syms = GameEngine.symbols;
    const pt   = S.cfg.paytable;
    const el   = $('paytable-content');
    if (!el || !pt || !Object.keys(pt).length) return;

    el.innerHTML = '';
    const ORDER = ['dynamite','pickaxe','lantern','cart','helmet','boots','nugget','wild','scatter'];
    ORDER.forEach(id => {
      const sym = syms[id];
      const m   = pt[id];
      if (!sym || !m) return;
      const row = document.createElement('div');
      row.className = 'pt-row';
      row.innerHTML = `
        <img class="pt-icon" src="${sym.src}" alt="${sym.name}">
        <span class="pt-name">${sym.name}</span>
        <div class="pt-pays">
          <div class="pt-pay"><span>3× </span>${m[2]||'—'}</div>
          <div class="pt-pay"><span>4× </span>${m[3]||'—'}</div>
          <div class="pt-pay"><span>5× </span>${m[4]||'—'}</div>
          <div class="pt-pay"><span>6× </span>${m[5]||'—'}</div>
        </div>`;
      el.appendChild(row);
    });
  }

  /* ─────────────────────────────────────────
   * BET CHIPS
   * ───────────────────────────────────────── */
  function buildBetChips() {
    const S   = GameEngine.state;
    const row = $('bet-chip-row');
    if (!row) return;
    row.innerHTML = '';
    S.cfg.betSteps.forEach(v => {
      const b = document.createElement('span');
      b.className = 'bet-chip' + (v === S.betPerLine ? ' sel' : '');
      b.textContent = 'R' + v;
      b.onclick = () => {
        GameEngine.setBetByValue(v);
        AudioEngine.sfx.click();
        buildBetChips();
        updateBetDisplay();
        updateBtnState();
      };
      row.appendChild(b);
    });
  }

  /* ─────────────────────────────────────────
   * HISTORY RENDER
   * ───────────────────────────────────────── */
  function renderHistory() {
    const S  = GameEngine.state;
    const el = $('history-list');
    if (!el) return;
    if (!S.history.length) {
      el.innerHTML = '<p style="color:var(--muted)">No spins yet.</p>'; return;
    }
    el.innerHTML = S.history.map(h => `
      <div class="hist-row">
        <span style="color:var(--muted);font-size:12px">Spin #${h.spin}</span>
        <span style="color:var(--muted);font-size:12px">Bet R${fmtI(h.bet)}</span>
        <span class="${h.win > 0 ? 'hist-win' : 'hist-lose'}">${h.win > 0 ? '+ ' + fmtI(h.win) : '—'}</span>
        <span style="color:var(--muted);font-size:11px">${fmt(h.balance)}</span>
      </div>`).join('');
  }

  /* ─────────────────────────────────────────
   * STATS UPDATE
   * ───────────────────────────────────────── */
  function updateStats() {
    const S = GameEngine.state;
    const s = S.stats;
    $('stat-spins') && ($('stat-spins').textContent = s.spins);
    $('stat-bet')   && ($('stat-bet').textContent   = 'R' + fmtI(s.totalBet));
    $('stat-won')   && ($('stat-won').textContent   = 'R' + fmtI(s.totalWon));
    $('stat-best')  && ($('stat-best').textContent  = 'R' + fmtI(s.bestWin));
    $('stat-session-id') && ($('stat-session-id').textContent = S.sessionId || '—');
  }

  /* ─────────────────────────────────────────
   * FREE SPINS HUD
   * ───────────────────────────────────────── */
  function updateFsHud(left, mul) {
    E.fsHud.classList.toggle('show', left > 0);
    E.fsMulBadge.classList.toggle('show', left > 0);
    E.fsNum.textContent    = left;
    E.fsMulDisp.textContent = `×${mul} Multiplier`;
  }

  /* ─────────────────────────────────────────
   * CELEBRATION
   * ───────────────────────────────────────── */
  const WIN_ICONS = {
    'WIN':       '🪙',
    'BIG WIN':   '💰',
    'GREAT WIN': '⛏️',
    'MEGA WIN':  '🏆',
  };

  function showCelebration(type, amount) {
    E.celType.textContent   = type;
    E.celTitle.textContent  = type;
    E.celAmount.textContent = fmtI(amount);
    // Update win icon
    const iconEl = document.getElementById('cel-win-icon');
    if (iconEl) {
      iconEl.textContent = WIN_ICONS[type] || '💰';
      iconEl.style.animation = 'none';
      void iconEl.offsetWidth;
      iconEl.style.animation = '';
    }
    E.celScreen.classList.add('show');
    spawnConfetti(type === 'MEGA WIN' ? 80 : type === 'BIG WIN' ? 60 : 45);
  }
  E.celScreen.addEventListener('click', () => E.celScreen.classList.remove('show'));

  function spawnConfetti(n) {
    const cols = ['#FFD147','#E8901A','#C97A12','#fff','#8B5A1F','#FFAD42','#D4950A','#FFF5E0'];
    for (let i = 0; i < n; i++) {
      const p = document.createElement('div');
      p.className = 'confetti-p';
      p.style.cssText = `
        left:${Math.random()*100}vw;
        background:${cols[Math.floor(Math.random()*cols.length)]};
        border-radius:${Math.random()>.5?'50%':'2px'};
        animation-duration:${1.4+Math.random()*2}s;
        animation-delay:${Math.random()*.5}s`;
      document.body.appendChild(p);
      setTimeout(() => p.remove(), 4500);
    }
  }

  /* ─────────────────────────────────────────
   * NETWORK INDICATOR
   * ───────────────────────────────────────── */
  function setNetwork(state) { // 'ok' | 'loading' | 'error'
    E.netInd.className = 'net-indicator' + (state !== 'ok' ? ' ' + state : '');
  }

  /* ─────────────────────────────────────────
   * MODALS
   * ───────────────────────────────────────── */
  function showModal(id) {
    const el = $(id);
    if (!el) return;
    el.classList.add('active');
    switch (id) {
      case 'modal-history':  renderHistory();  break;
      case 'modal-bet':      buildBetChips();  updateBetDisplay();  break;
      case 'modal-paytable': buildPaytable();  break;
      case 'modal-stats':    updateStats();    break;
      case 'modal-exit':
        $('exit-bal-disp') && ($('exit-bal-disp').textContent = 'R ' + fmt(GameEngine.state.balance));
        break;
    }
    AudioEngine.sfx.click();
  }

  function hideModal(id) {
    const el = $(id);
    if (el) el.classList.remove('active');
  }

  function from(a, b) { hideModal(a); showModal(b); }

  // Close on backdrop click
  document.querySelectorAll('.modal-overlay').forEach(ov =>
    ov.addEventListener('click', e => { if (e.target === ov) hideModal(ov.id); })
  );
  document.querySelectorAll('[data-close]').forEach(b =>
    b.addEventListener('click', () => hideModal(b.dataset.close))
  );

  /* ─────────────────────────────────────────
   * TOAST
   * ───────────────────────────────────────── */
  let _toastTimer = null;
  function toast(msg) {
    E.toast.textContent = msg;
    E.toast.classList.add('show');
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => E.toast.classList.remove('show'), 2400);
  }

  /* ─────────────────────────────────────────
   * TOGGLE CONTROLS
   * ───────────────────────────────────────── */
  function toggleSound() {
    const on = !GameEngine.state.soundOn;
    GameEngine.setSound(on);
    $('t-sound').textContent = on ? 'ON' : 'OFF';
    $('t-sound').className   = 'toggle-btn' + (on ? ' on' : '');
    E.niSound.innerHTML      = on ? '<i class="fas fa-volume-high"></i>' : '<i class="fas fa-volume-xmark"></i>';
    E.niSound.className      = 'ni' + (on ? ' active' : '');
    toast(on ? 'Sound ON' : 'Sound OFF');
  }

  function toggleMusic() {
    const on = !GameEngine.state.musicOn;
    GameEngine.setMusic(on);
    $('t-music').textContent = on ? 'ON' : 'OFF';
    $('t-music').className   = 'toggle-btn' + (on ? ' on' : '');
    toast(on ? 'Music ON' : 'Music OFF');
  }

  function toggleTurbo() {
    const on = !GameEngine.state.turbo;
    GameEngine.setTurbo(on);
    $('t-turbo').textContent = on ? 'ON' : 'OFF';
    $('t-turbo').className   = 'toggle-btn' + (on ? ' on' : '');
    E.niTurbo.className      = 'ni' + (on ? ' active' : '');
    toast(on ? 'Turbo ON' : 'Turbo OFF');
  }

  function toggleFullscreen() {
    document.fullscreenElement
      ? document.exitFullscreen()
      : document.documentElement.requestFullscreen().catch(() => {});
  }

  function saveLimits() {
    const timeMins  = parseFloat($('rl-time')?.value || 60);
    const lossLimit = parseFloat($('rl-loss')?.value || 500);
    GameEngine.updateRGLimits({ timeMins, lossLimit });
    hideModal('modal-responsible');
  }

  /* ─────────────────────────────────────────
   * AUTO SPIN START (called from modal button)
   * ───────────────────────────────────────── */
  function startAutoSpin() {
    let selectedCount = 10;
    const sel = document.querySelector('.count-chip.sel');
    if (sel) selectedCount = parseInt(sel.dataset.n);

    GameEngine.startAuto({
      count:     selectedCount,
      winLimit:  parseFloat($('auto-win-limit')?.value  || 500),
      lossLimit: parseFloat($('auto-loss-limit')?.value || 100),
    });
    hideModal('modal-autospin');
  }

  /* ─────────────────────────────────────────
   * DEPOSIT (demo — in prod this calls operator cashier)
   * ───────────────────────────────────────── */
  function deposit(amount) {
    GameEngine.state.balance += amount;
    GameEngine.state.rg.startBal = GameEngine.state.balance;
    updateBalance(GameEngine.state.balance);
    updateBtnState();
    hideModal('modal-deposit');
    AudioEngine.sfx.deposit();
    toast('R' + fmtI(amount) + ' deposited');
  }

  /* ─────────────────────────────────────────
   * EXIT / RE-AUTH
   * ───────────────────────────────────────── */
  async function exitGame() {
    const finalBal = await GameEngine.endSession();
    hideModal('modal-exit');
    try {
      window.parent.postMessage({
        type: 'GAME_EXIT',
        balance: finalBal,
        userId:  GameEngine.state.playerId,
      }, '*');
    } catch (e) {}
    toast('Returning to lobby…');
  }

  function reAuth() {
    try {
      window.parent.postMessage({
        type: 'SESSION_EXPIRED',
        userId: GameEngine.state.playerId,
      }, '*');
    } catch (e) {}
    toast('Requesting new session…');
  }

  function retryConnection() {
    hideModal('modal-connection');
    setNetwork('loading');
    GameEngine.resume().then(() => {
      setNetwork('ok');
      toast('Reconnected');
    }).catch(() => {
      setNetwork('error');
      showModal('modal-connection');
    });
  }

  /* ─────────────────────────────────────────
   * ENGINE EVENT HANDLERS
   * ───────────────────────────────────────── */

  GameEngine.on('ready', data => {
    // Populate UI from session
    E.splUser.textContent = GameEngine.state.username;
    updateBalance(GameEngine.state.balance);
    updateBetDisplay();
    updateBtnState();
    buildPaytable();
    fillRandom();

    // Loader out → game in
    setLoadProgress(100, 'Ready');
    setTimeout(() => {
      E.loader.classList.add('out');
      E.game.classList.add('visible');
      updateBtnState();
      AudioEngine.startMusic();
    }, 400);
  });

  GameEngine.on('betChanged', () => {
    updateBetDisplay();
    updateBtnState();
    buildBetChips();
  });

  GameEngine.on('spinStart', () => {
    clearWinCells();
    setNetwork('loading');
    E.btnSpin.classList.add('is-spinning');
    E.btnSpin.disabled = true;
    AudioEngine.sfx.spinStart();
    AudioEngine.resume();
  });

  GameEngine.on('spinResult', async data => {
    setNetwork('ok');

    // Animate reels with server result
    const grid = data.grid;
    const promises = [];
    for (let c = 0; c < 6; c++) {
      promises.push(spinReel(c, grid[c], c * ANIM.spinGap, ANIM.spinDur));
    }
    await Promise.all(promises);

    // Short pause for drama
    await sleep(60);

    // Commit result
    GameEngine.applyResult(data);
    E.btnSpin.classList.remove('is-spinning');

    // Show win
    if (data.totalWin > 0) {
      E.wdAmount.textContent = fmtI(data.totalWin) + ' ZAR';
      E.winDisplay.classList.add('show');
      showWinCells(data.winLines, GameEngine.state.cfg.paylines);

      const bet = GameEngine.totalBet();
      const mul = data.totalWin / (data.betPerLine || bet);

      if (data.totalWin >= bet * 50) {
        AudioEngine.sfx.megaWin();
        showCelebration('MEGA WIN', data.totalWin);
        setTimeout(() => showBigWinModal('MEGA WIN', data.totalWin, '🦁 Maximum achievement!', data.spinId), 2000);
      } else if (data.totalWin >= bet * 20) {
        AudioEngine.sfx.bigWin();
        showCelebration('BIG WIN', data.totalWin);
        setTimeout(() => showBigWinModal('BIG WIN', data.totalWin, data.isFreeSpinRound ? `Includes ×${data.fsMultiplier} Free Spin multiplier` : '', data.spinId), 1800);
      } else if (data.totalWin >= bet * 8) {
        AudioEngine.sfx.bigWin();
        showCelebration('GREAT WIN', data.totalWin);
      } else {
        AudioEngine.sfx.smallWin();
      }
    }

    // Free spins trigger
    if (data.triggerFreeSpins) {
      AudioEngine.sfx.scatterLand();
      setTimeout(() => {
        $('bonus-count').textContent = GameEngine.state.cfg.freeSpins.count;
        $('bonus-mul').textContent   = GameEngine.state.fsMul + '×';
        showModal('modal-bonus');
      }, data.totalWin > 0 ? 800 : 200);
    }

    // FS round update
    if (data.isFreeSpinRound) {
      updateFsHud(data.freeSpinsLeft, data.fsMultiplier || 3);
    }

    updateBalance(data.balance);
    updateBtnState();
  });

  GameEngine.on('spinError', ({ code, message }) => {
    setNetwork('error');
    E.btnSpin.classList.remove('is-spinning');
    updateBtnState();
    AudioEngine.sfx.error();
    if (code === 'NETWORK_ERROR') {
      showModal('modal-connection');
    } else if (code === 'INSUFFICIENT_BALANCE') {
      showModal('modal-insufficient');
    } else {
      toast('Error: ' + message);
    }
  });

  GameEngine.on('freeSpinsBegin', ({ count, multiplier }) => {
    AudioEngine.sfx.freeSpinsStart();
    updateFsHud(count, multiplier);
    toast(`${count} Free Spins — ×${multiplier} Multiplier active`);
  });

  GameEngine.on('freeSpinsEnd', ({ total }) => {
    updateFsHud(0, 3);
    AudioEngine.sfx.bonusCollect();
    $('fs-end-amount').textContent = fmtI(total);
    setTimeout(() => showModal('modal-fs-end'), 600);
    spawnConfetti(40);
  });

  GameEngine.on('autoStarted', ({ count }) => {
    E.btnStop.classList.add('show');
    E.niAuto.classList.add('active');
    toast(`Auto spin: ${count} spins`);
  });

  GameEngine.on('autoStopped', () => {
    E.btnStop.classList.remove('show');
    E.niAuto.classList.remove('active');
  });

  GameEngine.on('stateUpdated', ({ balance }) => {
    updateBalance(balance);
    updateBtnState();
  });

  GameEngine.on('sessionTick', ({ secs }) => {
    E.splTime.textContent = fmtTime(secs);
  });

  GameEngine.on('rgLimit', ({ type }) => {
    if (type === 'time') {
      toast('Session time limit reached');
      showModal('modal-responsible');
    } else if (type === 'loss') {
      toast('Session loss limit reached');
      showModal('modal-responsible');
    }
  });

  GameEngine.on('sessionExpired', () => {
    showModal('modal-session');
  });

  GameEngine.on('gamePaused', () => {
    showModal('modal-pause');
  });

  GameEngine.on('toast', ({ msg }) => toast(msg));

  GameEngine.on('error', ({ code, message }) => {
    setNetwork('error');
    E.ldStatus.textContent = 'Error: ' + message;
    console.error('[GameEngine]', code, message);
  });

  /* ─────────────────────────────────────────
   * BIG WIN MODAL
   * ───────────────────────────────────────── */
  function showBigWinModal(title, amount, sub, spinId) {
    $('win-modal-title').textContent  = title;
    $('win-modal-amount').textContent = fmtI(amount);
    $('win-modal-sub').textContent    = sub || '';
    if (spinId) {
      $('win-verify').style.display = 'block';
      $('win-spin-id').textContent  = spinId;
    } else {
      $('win-verify').style.display = 'none';
    }
    showModal('modal-win');
  }

  /* ─────────────────────────────────────────
   * LOADER PROGRESS
   * ───────────────────────────────────────── */
  function setLoadProgress(pct, status) {
    E.ldBar.style.width    = pct + '%';
    E.ldStatus.textContent = status || '';
  }

  /* ─────────────────────────────────────────
   * EVENT BINDINGS
   * ───────────────────────────────────────── */
  function bindEvents() {
    // Spin
    E.btnSpin.addEventListener('click', () => {
      AudioEngine.sfx.click();
      AudioEngine.resume();
      if (GameEngine.state.balance < GameEngine.totalBet()) {
        showModal('modal-insufficient');
        return;
      }
      GameEngine.spin();
    });

    // Stop auto
    E.btnStop.addEventListener('click', () => {
      GameEngine.stopAuto();
      toast('Auto spin stopped');
    });

    // Bet buttons
    $('bet-up').addEventListener('click', e => {
      e.stopPropagation();
      GameEngine.adjustBet(1);
      AudioEngine.sfx.click();
    });
    $('bet-dn').addEventListener('click', e => {
      e.stopPropagation();
      GameEngine.adjustBet(-1);
      AudioEngine.sfx.click();
    });

    // Nav icons
    $('ni-menu').addEventListener('click',     () => { AudioEngine.sfx.click(); showModal('modal-menu');    });
    $('ni-info').addEventListener('click',     () => { AudioEngine.sfx.click(); showModal('modal-paytable');});
    $('ni-history').addEventListener('click',  () => { AudioEngine.sfx.click(); showModal('modal-history'); });
    $('ni-settings').addEventListener('click', () => { AudioEngine.sfx.click(); showModal('modal-settings');});
    $('ni-sound').addEventListener('click',    () => toggleSound());
    $('ni-turbo').addEventListener('click',    () => { AudioEngine.sfx.click(); toggleTurbo();              });
    $('ni-auto').addEventListener('click',     () => { AudioEngine.sfx.click(); showModal('modal-autospin');});

    // Auto count chips
    document.querySelectorAll('.count-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('.count-chip').forEach(c => c.classList.remove('sel'));
        chip.classList.add('sel');
        AudioEngine.sfx.click();
      });
    });

    // First interaction — resume audio context
    document.addEventListener('click',      () => AudioEngine.resume(), { once: true, passive: true });
    document.addEventListener('touchstart', () => AudioEngine.resume(), { once: true, passive: true });
  }

  /* ─────────────────────────────────────────
   * UTILITY
   * ───────────────────────────────────────── */
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  /* ─────────────────────────────────────────
   * INIT SEQUENCE
   * ───────────────────────────────────────── */
  async function init() {
    AudioEngine.init();
    buildGrid();
    bindEvents();

    // Progressive loader
    setLoadProgress(20, 'Initialising…');

    // Preload symbol images
    const syms = GameEngine.symbols;
    const imgPromises = Object.values(syms).map(s => new Promise(res => {
      const img = new Image();
      img.onload = img.onerror = res;
      img.src = s.src;
    }));
    setLoadProgress(40, 'Loading assets…');
    await Promise.all(imgPromises);

    setLoadProgress(70, 'Connecting to server…');
    setNetwork('loading');

    // Initial balance from query string or default
    const startBal = parseFloat(new URLSearchParams(window.location.search).get('balance') || '2000');

    try {
      await GameEngine.init(startBal);
      setNetwork('ok');
    } catch (err) {
      setLoadProgress(100, 'Connection failed');
      setNetwork('error');
      // Show error after a moment
      setTimeout(() => {
        E.loader.classList.add('out');
        E.game.classList.add('visible');
        showModal('modal-connection');
      }, 1000);
    }
  }

  /* ─────────────────────────────────────────
   * PUBLIC
   * ───────────────────────────────────────── */
  return {
    init,
    showModal,
    hideModal,
    from,
    toast,
    toggleSound,
    toggleMusic,
    toggleTurbo,
    toggleFullscreen,
    saveLimits,
    startAutoSpin,
    deposit,
    exitGame,
    reAuth,
    retryConnection,
  };

})();

// Boot
document.addEventListener('DOMContentLoaded', () => UI.init());