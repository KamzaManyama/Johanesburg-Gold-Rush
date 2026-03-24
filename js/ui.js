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
   * ANIMATION CONFIG
   * ───────────────────────────────────────── */
  const ANIM = {
    get reelDelay() { return GameEngine.state.turbo ? 50  : 100 },   // stagger between reels
    get spinTime()  { return GameEngine.state.turbo ? 500 : 900 },   // total spin duration per reel
    get tickMs()    { return GameEngine.state.turbo ? 60  : 100 },   // symbol swap interval
    get autoDelay() { return GameEngine.state.turbo ? 200 : 500 },
  };

  /* ─────────────────────────────────────────
   * SYMBOL POOL for animation (fast random swap)
   * ───────────────────────────────────────── */
  const ANIM_POOL = [
    'nugget','nugget','nugget','boots','boots','helmet',
    'cart','lantern','pickaxe','dynamite',
  ];
  function randAnimSym() { return ANIM_POOL[Math.floor(Math.random() * ANIM_POOL.length)]; }

  /* ─────────────────────────────────────────
   * FORMAT HELPERS
   * ───────────────────────────────────────── */
  function fmt(n)  { return Number(n).toLocaleString('en-ZA', { minimumFractionDigits:2, maximumFractionDigits:2 }); }
  function fmtI(n) { return Number(n).toLocaleString('en-ZA', { minimumFractionDigits:2, maximumFractionDigits:2 }); }
  function fmtTime(secs) {
    return String(Math.floor(secs/60)).padStart(2,'0') + ':' + String(secs%60).padStart(2,'0');
  }
  function fmtBet(v) {
    // Show R2.50 style for decimal bets
    const n = Number(v);
    return n % 1 === 0 ? String(n) : n.toFixed(2);
  }

  /* ─────────────────────────────────────────
   * GRID BUILD
   * ───────────────────────────────────────── */
  function buildGrid() {
    E.reelsGrid.innerHTML = '';
    E.plRow.innerHTML     = '';

    for (let c = 0; c < 6; c++) {
      const col = document.createElement('div');
      col.className = 'reel-col';
      col.id = 'col' + c;
      for (let r = 0; r < 4; r++) {
        const cellEl = document.createElement('div');
        cellEl.className = 'reel-cell';
        cellEl.id = `c${r}x${c}`;
        const img = document.createElement('img');
        img.className = 'sym-img';
        img.alt = '';
        img.loading = 'eager';
        img.draggable = false;
        cellEl.appendChild(img);
        col.appendChild(cellEl);
      }
      E.reelsGrid.appendChild(col);
    }

    for (let i = 0; i < 10; i++) {
      const dotEl = document.createElement('div');
      dotEl.className = 'pl-dot';
      dotEl.id = 'pld' + i;
      E.plRow.appendChild(dotEl);
    }
  }

  function cellEl(r, c) { return $(`c${r}x${c}`) }
  function colEl(c)      { return $('col' + c) }
  function dotEl(i)      { return $('pld' + i) }

  function setCell(el, sid) {
    if (!el) return;
    const img = el.querySelector('.sym-img');
    if (!img) return;
    const sym = GameEngine.symbols[sid];
    img.src = sym ? sym.src : '';
    img.className = 'sym-img'
      + (sid === 'scatter' ? ' is-scatter' : '')
      + (sid === 'wild'    ? ' is-wild'    : '');
    el.dataset.s = sid;
  }

  function fillRandom() {
    for (let c = 0; c < 6; c++)
      for (let r = 0; r < 4; r++)
        setCell(cellEl(r, c), randAnimSym());
  }

  function applyGrid(grid) {
    for (let c = 0; c < 6; c++)
      for (let r = 0; r < 4; r++)
        setCell(cellEl(r, c), grid[c][r]);
  }

  /* ─────────────────────────────────────────
   * REEL SPIN ANIMATION — professional slot spin
   * Each reel spins independently with blur + smooth stop
   * ───────────────────────────────────────── */
  let _spinningCols = new Set();

  function spinReel(colIdx, finalSyms, startDelay, totalDuration) {
    return new Promise(resolve => {
      const col = colEl(colIdx);
      if (!col) { resolve(); return; }

      const cells = [0,1,2,3].map(r => cellEl(r, colIdx));

      setTimeout(() => {
        // Start spinning
        _spinningCols.add(colIdx);
        col.classList.add('spinning');
        col.classList.remove('stopping');

        // Rapid symbol cycling
        const tickIv = setInterval(() => {
          cells.forEach(c => c && setCell(c, randAnimSym()));
          if (AudioEngine.sfx) AudioEngine.sfx.reelTick();
        }, ANIM.tickMs);

        // Stop: remove spinning, show real symbols with stopping animation
        const stopAt = totalDuration - startDelay;
        setTimeout(() => {
          clearInterval(tickIv);
          col.classList.remove('spinning');
          col.classList.add('stopping');

          // Snap final symbols
          finalSyms.forEach((sid, r) => setCell(cells[r], sid));
          AudioEngine.sfx.reelStop(colIdx);
          _spinningCols.delete(colIdx);

          // Remove stopping class after animation
          setTimeout(() => {
            col.classList.remove('stopping');
            resolve();
          }, 250);
        }, stopAt);
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
        const c = cellEl(row, col);
        if (c) c.classList.add('win-cell');
      });
      const d = dotEl(wl.lineIndex);
      if (d) d.classList.add('lit');
    });
  }

  function clearWinCells() {
    document.querySelectorAll('.reel-cell').forEach(c => c.classList.remove('win-cell'));
    for (let i = 0; i < 10; i++) { const d = dotEl(i); if (d) d.classList.remove('lit'); }
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
      void E.navBal.offsetWidth;
      if (bal > _lastBal)      { E.navBal.classList.add('up');   setTimeout(() => E.navBal.classList.remove('up'),   700); }
      else if (bal < _lastBal) { E.navBal.classList.add('down'); setTimeout(() => E.navBal.classList.remove('down'), 700); }
    }
    _lastBal = bal;
  }

  function updateBetDisplay() {
    const S = GameEngine.state;
    E.betDisp.textContent = fmtBet(S.betPerLine);
    const tb = GameEngine.totalBet();
    $('modal-total-bet') && ($('modal-total-bet').textContent = 'R' + fmtI(tb));
    $('modal-lines')     && ($('modal-lines').textContent = S.cfg.lines);
  }

  function updateBtnState() {
    E.btnSpin.disabled = !GameEngine.canSpin();
  }

  /* ─────────────────────────────────────────
   * PAYTABLE RENDER
   * ───────────────────────────────────────── */
  function buildPaytable() {
    const S   = GameEngine.state;
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
          <div class="pt-pay"><span>3× </span>${m[1]||m[2]||'—'}</div>
          <div class="pt-pay"><span>4× </span>${m[2]||m[3]||'—'}</div>
          <div class="pt-pay"><span>5× </span>${m[3]||m[4]||'—'}</div>
          <div class="pt-pay"><span>6× </span>${m[4]||m[5]||'—'}</div>
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
      b.textContent = 'R' + fmtBet(v);
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
    el.innerHTML = S.history.slice(0,20).map(h => `
      <div class="hist-row">
        <span style="color:var(--muted);font-size:12px">#${h.spin}</span>
        <span style="color:var(--muted);font-size:12px">R${fmtI(h.bet)}</span>
        <span class="${h.win > 0 ? 'hist-win' : 'hist-lose'}">${h.win > 0 ? '+R' + fmtI(h.win) : '—'}</span>
        <span style="color:var(--muted);font-size:11px">R${fmt(h.balance)}</span>
      </div>`).join('');
  }

  /* ─────────────────────────────────────────
   * STATS UPDATE
   * ───────────────────────────────────────── */
  function updateStats() {
    const s = GameEngine.state.stats;
    $('stat-spins') && ($('stat-spins').textContent = s.spins);
    $('stat-bet')   && ($('stat-bet').textContent   = 'R' + fmtI(s.totalBet));
    $('stat-won')   && ($('stat-won').textContent   = 'R' + fmtI(s.totalWon));
    $('stat-best')  && ($('stat-best').textContent  = 'R' + fmtI(s.bestWin));
    $('stat-session-id') && ($('stat-session-id').textContent = GameEngine.state.sessionId || '—');
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
   * CELEBRATION — full screen win overlay
   * ───────────────────────────────────────── */
  const WIN_DATA = {
    SMALL_WIN: { icon:'🪙', label:'WIN',      color:'#FFD966' },
    WIN:       { icon:'💰', label:'WIN',      color:'#FFD966' },
    BIG_WIN:   { icon:'⛏️', label:'BIG WIN',  color:'#FFB800' },
    SUPER_WIN: { icon:'💎', label:'SUPER WIN',color:'#FF9500' },
    MEGA_WIN:  { icon:'🏆', label:'MEGA WIN', color:'#FF6B00' },
  };

  function showCelebration(winType, amount) {
    const d = WIN_DATA[winType] || WIN_DATA.WIN;
    E.celType.textContent   = d.label;
    E.celTitle.textContent  = d.label;
    E.celAmount.textContent = 'R' + fmtI(amount);
    const iconEl = $('cel-win-icon');
    if (iconEl) {
      iconEl.textContent = d.icon;
      iconEl.style.animation = 'none';
      void iconEl.offsetWidth;
      iconEl.style.animation = '';
    }
    E.celScreen.classList.add('show');
    spawnConfetti(winType === 'MEGA_WIN' ? 90 : winType === 'SUPER_WIN' ? 70 : 50);
  }
  E.celScreen.addEventListener('click', () => E.celScreen.classList.remove('show'));

  function spawnConfetti(n) {
    const cols = ['#FFD147','#E8901A','#C97A12','#fff','#8B5A1F','#FFAD42','#D4950A','#FFF5E0','#FF9500'];
    for (let i = 0; i < n; i++) {
      const p = document.createElement('div');
      p.className = 'confetti-p';
      p.style.cssText = `
        left:${Math.random()*100}vw;
        background:${cols[Math.floor(Math.random()*cols.length)]};
        border-radius:${Math.random()>.5?'50%':'2px'};
        animation-duration:${1.5+Math.random()*2}s;
        animation-delay:${Math.random()*.6}s`;
      document.body.appendChild(p);
      setTimeout(() => p.remove(), 4800);
    }
  }

  /* ─────────────────────────────────────────
   * NETWORK INDICATOR
   * ───────────────────────────────────────── */
  function setNetwork(state) {
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
      case 'modal-bet':      buildBetChips();  updateBetDisplay(); break;
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
    _toastTimer = setTimeout(() => E.toast.classList.remove('show'), 2600);
  }

  /* ─────────────────────────────────────────
   * SETTINGS TOGGLES
   * ───────────────────────────────────────── */
  function toggleSound() {
    const on = !GameEngine.state.soundOn;
    GameEngine.setSound(on);
    $('t-sound').textContent = on ? 'ON' : 'OFF';
    $('t-sound').className   = 'toggle-btn' + (on ? ' on' : '');
    E.niSound.innerHTML      = on ? '<i class="fas fa-volume-high"></i>' : '<i class="fas fa-volume-xmark"></i>';
    E.niSound.className      = 'ni' + (on ? ' active' : '');
    toast(on ? '🔊 Sound ON' : '🔇 Sound OFF');
  }

  function toggleMusic() {
    const on = !GameEngine.state.musicOn;
    GameEngine.setMusic(on);
    $('t-music').textContent = on ? 'ON' : 'OFF';
    $('t-music').className   = 'toggle-btn' + (on ? ' on' : '');
    toast(on ? '🎵 Music ON' : 'Music OFF');
  }

  function toggleTurbo() {
    const on = !GameEngine.state.turbo;
    GameEngine.setTurbo(on);
    $('t-turbo').textContent = on ? 'ON' : 'OFF';
    $('t-turbo').className   = 'toggle-btn' + (on ? ' on' : '');
    E.niTurbo.className      = 'ni' + (on ? ' active' : '');
    toast(on ? '⚡ Turbo ON' : 'Turbo OFF');
  }

  function toggleFullscreen() {
    document.fullscreenElement
      ? document.exitFullscreen()
      : document.documentElement.requestFullscreen().catch(() => {});
  }

  function saveLimits() {
    const timeMins  = parseFloat($('rl-time')?.value  || 60);
    const lossLimit = parseFloat($('rl-loss')?.value  || 500);
    GameEngine.updateRGLimits({ timeMins, lossLimit });
    hideModal('modal-responsible');
  }

  /* ─────────────────────────────────────────
   * AUTO SPIN
   * ───────────────────────────────────────── */
  function startAutoSpin() {
    let sel = document.querySelector('.count-chip.sel');
    const count = sel ? parseInt(sel.dataset.n) : 10;
    GameEngine.startAuto({
      count,
      winLimit:  parseFloat($('auto-win-limit')?.value  || 500),
      lossLimit: parseFloat($('auto-loss-limit')?.value || 100),
    });
    hideModal('modal-autospin');
  }

  /* ─────────────────────────────────────────
   * DEPOSIT (demo)
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
      window.parent.postMessage({ type:'GAME_EXIT', balance:finalBal, userId:GameEngine.state.playerId }, '*');
    } catch(e) {}
    toast('Returning to lobby…');
  }

  function reAuth() {
    try { window.parent.postMessage({ type:'SESSION_EXPIRED', userId:GameEngine.state.playerId }, '*'); } catch(e) {}
    toast('Requesting new session…');
  }

  function retryConnection() {
    hideModal('modal-connection');
    setNetwork('loading');
    GameEngine.resume().then(() => {
      setNetwork('ok'); toast('Reconnected');
    }).catch(() => {
      setNetwork('error'); showModal('modal-connection');
    });
  }

  /* ─────────────────────────────────────────
   * BIG WIN MODAL — with image and rich presentation
   * ───────────────────────────────────────── */

  // Map win type to image to show in modal
  const WIN_IMAGES = {
    MEGA_WIN:  'assets/images/dynamite.jpg',
    SUPER_WIN: 'assets/images/pickaxe.jpg',
    BIG_WIN:   'assets/images/nugget.jpg',
    WIN:       'assets/images/nugget.jpg',
  };
  const WIN_BADGE_LABELS = {
    MEGA_WIN:  '🏆 MEGA WIN',
    SUPER_WIN: '💎 SUPER WIN',
    BIG_WIN:   '⛏️ BIG WIN',
    WIN:       '💰 BIG WIN',
  };

  function showBigWinModal(winType, amount, sub, spinId) {
    const title = WIN_BADGE_LABELS[winType] || 'BIG WIN';
    $('win-modal-title').textContent  = title.replace(/^[^\s]+ /,''); // without emoji
    $('win-modal-amount').textContent = 'R' + fmtI(amount);
    $('win-modal-sub').textContent    = sub || '';
    $('win-badge-label') && ($('win-badge-label').textContent = title);

    // Set winning image
    const imgEl = $('win-medal-img');
    if (imgEl) imgEl.src = WIN_IMAGES[winType] || WIN_IMAGES.BIG_WIN;

    if (spinId) {
      $('win-verify').style.display = 'block';
      $('win-spin-id').textContent  = spinId;
    } else {
      $('win-verify').style.display = 'none';
    }
    showModal('modal-win');
  }

  /* ─────────────────────────────────────────
   * ENGINE EVENT HANDLERS
   * ───────────────────────────────────────── */

  GameEngine.on('ready', data => {
    E.splUser.textContent = GameEngine.state.username;
    updateBalance(GameEngine.state.balance);
    updateBetDisplay();
    updateBtnState();
    buildPaytable();
    fillRandom();

    setLoadProgress(100, 'Ready to play!');
    setTimeout(() => {
      E.loader.classList.add('out');
      E.game.classList.add('visible');
      updateBtnState();
      AudioEngine.startMusic();
    }, 600);
  });

  GameEngine.on('betChanged', () => {
    updateBetDisplay();
    updateBtnState();
    buildBetChips();
    AudioEngine.sfx.click();
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

    const grid = data.grid;
    const totalDur = ANIM.spinTime;
    const promises = [];

    for (let c = 0; c < 6; c++) {
      const delay = c * ANIM.reelDelay;
      promises.push(spinReel(c, grid[c], delay, totalDur));
    }

    await Promise.all(promises);
    await sleep(80);

    GameEngine.applyResult(data);
    E.btnSpin.classList.remove('is-spinning');

    if (data.totalWin > 0) {
      E.wdAmount.textContent = 'R' + fmtI(data.totalWin);
      E.winDisplay.classList.add('show');
      showWinCells(data.lineWins || data.winLines || [], GameEngine.state.cfg.paylines);

      const tb  = GameEngine.totalBet() || (data.betPerLine * 10) || 25;
      const mul = tb > 0 ? data.totalWin / tb : 0;

      if (mul >= 50 || data.winType === 'MEGA_WIN') {
        AudioEngine.sfx.megaWin();
        showCelebration('MEGA_WIN', data.totalWin);
        setTimeout(() => showBigWinModal('MEGA_WIN', data.totalWin,
          '🏆 Maximum achievement unlocked!', data.spinId), 2200);
      } else if (mul >= 20 || data.winType === 'SUPER_WIN') {
        AudioEngine.sfx.bigWin();
        showCelebration('SUPER_WIN', data.totalWin);
        setTimeout(() => showBigWinModal('SUPER_WIN', data.totalWin,
          data.isFreeSpinRound ? `Includes ×${data.fsMultiplier} Free Spin multiplier` : '', data.spinId), 2000);
      } else if (mul >= 8 || data.winType === 'BIG_WIN') {
        AudioEngine.sfx.bigWin();
        showCelebration('BIG_WIN', data.totalWin);
        setTimeout(() => showBigWinModal('BIG_WIN', data.totalWin,
          data.isFreeSpinRound ? `Includes ×${data.fsMultiplier} multiplier` : '', data.spinId), 1800);
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
      }, data.totalWin > 0 ? 900 : 250);
    }

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
    } else if (code === 'INSUFFICIENT_BALANCE' || code === 'INSUFFICIENT_FUNDS') {
      showModal('modal-insufficient');
    } else {
      toast('Error: ' + message);
    }
  });

  GameEngine.on('freeSpinsBegin', ({ count, multiplier }) => {
    AudioEngine.sfx.freeSpinsStart();
    updateFsHud(count, multiplier);
    toast(`${count} Free Spins — ×${multiplier} Multiplier active!`);
  });

  GameEngine.on('freeSpinsEnd', ({ totalWin }) => {
    updateFsHud(0, 3);
    AudioEngine.sfx.bonusCollect();
    $('fs-end-amount').textContent = 'R' + fmtI(totalWin || 0);
    setTimeout(() => showModal('modal-fs-end'), 700);
    spawnConfetti(45);
  });

  GameEngine.on('autoStarted', ({ count }) => {
    E.btnStop.classList.add('show');
    E.niAuto.classList.add('active');
    toast(`Auto Spin: ${count} spins`);
  });

  GameEngine.on('autoStopped', () => {
    E.btnStop.classList.remove('show');
    E.niAuto.classList.remove('active');
  });

  GameEngine.on('stateUpdated', ({ balance }) => {
    if (balance !== undefined) updateBalance(balance);
    updateBtnState();
  });

  GameEngine.on('sessionTick', ({ secs }) => {
    E.splTime.textContent = fmtTime(secs);
  });

  GameEngine.on('rgLimit', ({ type }) => {
    if (type === 'time')  { toast('Session time limit reached'); showModal('modal-responsible'); }
    else if (type === 'loss') { toast('Session loss limit reached'); showModal('modal-responsible'); }
  });

  GameEngine.on('sessionExpired', () => showModal('modal-session'));
  GameEngine.on('gamePaused',     () => showModal('modal-pause'));
  GameEngine.on('toast',   ({ msg }) => toast(msg));
  GameEngine.on('insufficientFunds', () => showModal('modal-insufficient'));

  GameEngine.on('error', ({ code, message }) => {
    setNetwork('error');
    E.ldStatus.textContent = 'Error: ' + message;
    console.error('[GameEngine]', code, message);
  });

  /* ─────────────────────────────────────────
   * LOADER PROGRESS
   * ───────────────────────────────────────── */
  function setLoadProgress(pct, status) {
    E.ldBar.style.width    = pct + '%';
    E.ldStatus.textContent = status || '';
  }

  GameEngine.on('loading', ({ phase, progress }) => {
    const labels = {
      session:  'Connecting to server…',
      assets:   'Loading assets…',
      complete: 'Almost ready…',
    };
    setLoadProgress(progress, labels[phase] || 'Loading…');
  });

  /* ─────────────────────────────────────────
   * EVENT BINDINGS
   * ───────────────────────────────────────── */
  function bindEvents() {
    // Spin
    E.btnSpin.addEventListener('click', () => {
      AudioEngine.resume();
      AudioEngine.sfx.click();
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
    });
    $('bet-dn').addEventListener('click', e => {
      e.stopPropagation();
      GameEngine.adjustBet(-1);
    });

    // Nav icons
    $('ni-menu').addEventListener('click',     () => { AudioEngine.sfx.click(); showModal('modal-menu');     });
    $('ni-info').addEventListener('click',     () => { AudioEngine.sfx.click(); showModal('modal-paytable'); });
    $('ni-history').addEventListener('click',  () => { AudioEngine.sfx.click(); showModal('modal-history');  });
    $('ni-settings').addEventListener('click', () => { AudioEngine.sfx.click(); showModal('modal-settings'); });
    $('ni-sound').addEventListener('click',    () => toggleSound());
    $('ni-turbo').addEventListener('click',    () => { AudioEngine.sfx.click(); toggleTurbo(); });
    $('ni-auto').addEventListener('click',     () => { AudioEngine.sfx.click(); showModal('modal-autospin'); });

    // Auto count chips
    document.querySelectorAll('.count-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('.count-chip').forEach(c => c.classList.remove('sel'));
        chip.classList.add('sel');
        AudioEngine.sfx.click();
      });
    });

    // First interaction — unlock audio
    const firstInteract = () => { AudioEngine.resume(); };
    document.addEventListener('click',      firstInteract, { once:true, passive:true });
    document.addEventListener('touchstart', firstInteract, { once:true, passive:true });
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

    setLoadProgress(15, 'Initialising…');

    // Preload images
    const syms = GameEngine.symbols;
    const imgPs = Object.values(syms).map(s => new Promise(res => {
      const img = new Image();
      img.onload = img.onerror = res;
      img.src = s.src;
    }));
    setLoadProgress(35, 'Loading assets…');
    await Promise.all(imgPs);

    setLoadProgress(65, 'Connecting…');
    setNetwork('loading');

    const startBal = parseFloat(new URLSearchParams(window.location.search).get('balance') || '2500');

    try {
      await GameEngine.init(startBal);
      setNetwork('ok');
    } catch(err) {
      setLoadProgress(100, 'Connection failed');
      setNetwork('error');
      setTimeout(() => {
        E.loader.classList.add('out');
        E.game.classList.add('visible');
        showModal('modal-connection');
      }, 1200);
    }
  }

  /* ─────────────────────────────────────────
   * PUBLIC API
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

document.addEventListener('DOMContentLoaded', () => UI.init());

