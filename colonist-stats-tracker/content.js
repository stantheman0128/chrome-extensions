(function () {
  'use strict';

  // =============================================================
  // Colonist.io Stats Tracker
  // -------------------------------------------------------------
  // Reads the in-game log (#game-log-text) message by message, then:
  //   1. Counts every dice-roll sum (2-12) to build a live histogram
  //   2. Tracks a best-effort resource inventory per player, including
  //      an "unknown" pool for cards moved by knight/robber steals
  //
  // Selectors are defensive: colonist.io tweaks class names from time
  // to time, so we look at image alt text, class names and src URLs
  // together before giving up on a message.
  // =============================================================

  const RESOURCES = ['lumber', 'brick', 'wool', 'grain', 'ore'];
  const RESOURCE_LABEL = {
    lumber: '🌲',
    brick: '🧱',
    wool:  '🐑',
    grain: '🌾',
    ore:   '⛰️',
  };

  const BUILD_COST = {
    road:       { lumber: 1, brick: 1 },
    settlement: { lumber: 1, brick: 1, wool: 1, grain: 1 },
    city:       { ore: 3, grain: 2 },
    devcard:    { wool: 1, grain: 1, ore: 1 },
  };

  // Expected frequency for a fair two-dice sum (for % comparison).
  const EXPECTED_PCT = {
    2:  2.78, 3:  5.56, 4:  8.33, 5: 11.11, 6: 13.89,
    7: 16.67, 8: 13.89, 9: 11.11, 10: 8.33, 11: 5.56, 12: 2.78,
  };

  // ---------- State ----------
  const state = {
    diceCounts: Object.fromEntries(
      Array.from({ length: 11 }, (_, i) => [i + 2, 0])
    ),
    totalRolls: 0,
    players: new Map(), // name -> { color, resources:{}, unknown:number }
    seenIndices: new Set(), // log message data-index values already processed
    selfName: null, // local human player; messages with avatar=icon_player.svg
    paused: false,
  };

  // =============================================================
  // Player bookkeeping
  // =============================================================
  function getPlayer(name, color) {
    if (!name) return null;
    let p = state.players.get(name);
    if (!p) {
      p = {
        name,
        color: color || '#888',
        resources: { lumber: 0, brick: 0, wool: 0, grain: 0, ore: 0 },
        unknown: 0,
      };
      state.players.set(name, p);
    } else if (color && !p.color) {
      p.color = color;
    }
    return p;
  }

  function playerTotal(p) {
    return RESOURCES.reduce((s, r) => s + p.resources[r], 0) + p.unknown;
  }

  // Add cards of known type.
  function giveResource(p, type, n = 1) {
    if (!p || !type) return;
    p.resources[type] += n;
  }

  // Remove cards of a known type. If the player doesn't have enough of
  // that type in the known pool, the shortfall comes out of the unknown
  // pool — meaning those stolen cards are retroactively identified.
  function takeResource(p, type, n = 1) {
    if (!p || !type) return;
    const have = p.resources[type];
    if (have >= n) {
      p.resources[type] -= n;
      return;
    }
    const remainder = n - have;
    p.resources[type] = 0;
    p.unknown = Math.max(0, p.unknown - remainder);
  }

  function spend(p, cost) {
    for (const [type, n] of Object.entries(cost)) takeResource(p, type, n);
  }

  function transferUnknown(fromP, toP) {
    if (!fromP || !toP) return;
    if (fromP.unknown > 0) {
      fromP.unknown -= 1;
    } else {
      // Pull a random-ish card from their known pool into our unknown pool.
      // Pick the type with the highest count to minimise surprise.
      let best = null;
      for (const r of RESOURCES) {
        if (fromP.resources[r] > 0 && (!best || fromP.resources[r] > fromP.resources[best])) {
          best = r;
        }
      }
      if (best) fromP.resources[best] -= 1;
    }
    toP.unknown += 1;
  }

  // =============================================================
  // Resource / dice icon extraction
  // =============================================================
  // Real resource cards have src/alt like `card_lumber.<hash>.svg` / alt
  // "Lumber". The same word can appear in tile icons (`generated_tile_wool`,
  // alt "wool tile") and in non-resource cards (`card_knight`,
  // `card_devcardback`, `card_rescardback`), so we anchor on the
  // `card_<resource>` substring to avoid those false positives.
  function resourceFromImg(img) {
    const src = (img.getAttribute('src') || '').toLowerCase();
    for (const r of RESOURCES) {
      if (src.indexOf('card_' + r) !== -1) return r;
    }
    return null;
  }

  function diceFromImg(img) {
    const txt = [
      img.getAttribute('alt'),
      img.className || '',
      img.getAttribute('src') || '',
    ].join(' ');
    const m = txt.match(/dice[_-]?(\d)/i);
    if (m) return parseInt(m[1], 10);
    return null;
  }

  // The avatar <img> sits inside the feedMessage but outside messagePart.
  // Scoping image scans to messagePart keeps the avatar from leaking in.
  function getMessagePart(msgEl) {
    return msgEl.querySelector('[class*="messagePart"]') || msgEl;
  }

  function countResources(msgEl) {
    const counts = { lumber: 0, brick: 0, wool: 0, grain: 0, ore: 0 };
    let total = 0;
    getMessagePart(msgEl).querySelectorAll('img').forEach((img) => {
      const r = resourceFromImg(img);
      if (r) {
        counts[r] += 1;
        total += 1;
      }
    });
    return { counts, total };
  }

  function diceSum(msgEl) {
    const values = [];
    getMessagePart(msgEl).querySelectorAll('img').forEach((img) => {
      const v = diceFromImg(img);
      if (v) values.push(v);
    });
    if (values.length < 2) return null;
    return values.slice(0, 2).reduce((a, b) => a + b, 0);
  }

  // =============================================================
  // Player name / color extraction
  // =============================================================
  function firstPlayerRef(msgEl) {
    // colonist.io styles player names with a coloured inline span inside
    // the messagePart wrapper (e.g. <span style="...color:#223697">Mirna</span>).
    const span = getMessagePart(msgEl).querySelector('span[style*="color"]');
    if (span) {
      const name = (span.textContent || '').trim();
      const style = span.getAttribute('style') || '';
      const colorMatch = style.match(/color\s*:\s*([^;]+)/i);
      return { name, color: colorMatch ? colorMatch[1].trim() : null };
    }
    return { name: null, color: null };
  }

  function allPlayerRefs(msgEl) {
    const refs = [];
    getMessagePart(msgEl).querySelectorAll('span[style*="color"]').forEach((s) => {
      const name = (s.textContent || '').trim();
      if (!name) return;
      const style = s.getAttribute('style') || '';
      const colorMatch = style.match(/color\s*:\s*([^;]+)/i);
      refs.push({ name, color: colorMatch ? colorMatch[1].trim() : null });
    });
    return refs;
  }

  // =============================================================
  // Message routing
  // =============================================================
  function processMessage(msgEl) {
    const text = (getMessagePart(msgEl).textContent || '').toLowerCase();
    if (!text) return;
    // Trade proposals look like "X wants to give A for B". They aren't
    // executed trades, so skip them — otherwise the " for " in the text
    // would confuse splitTradeResources downstream.
    if (text.includes('wants to give') || text.includes('wants to trade')) return;

    const primary = firstPlayerRef(msgEl);
    const player = getPlayer(primary.name, primary.color);

    // Identify the local human player. The avatar uses icon_player.svg for
    // self and icon_bot.svg for bots; we record the first coloured name we
    // see paired with icon_player.svg as `selfName`. Used by the "You stole
    // [resource] from X" handler below.
    if (!state.selfName && player) {
      const avatar = msgEl.querySelector('img[src*="icon_player"]');
      if (avatar) state.selfName = player.name;
    }

    // --- "You stole [resource] from X" — local player as thief ---
    // colonist.io reveals the actual stolen card to the player who stole it,
    // so this message contains a real card_<resource> img. The visible
    // colour-span is the victim, not the thief.
    if (text.startsWith('you stole') || text.indexOf(' you stole ') !== -1) {
      const refs = allPlayerRefs(msgEl);
      const { counts, total } = countResources(msgEl);
      const thief = state.selfName ? getPlayer(state.selfName) : null;
      const victim = refs.length ? getPlayer(refs[0].name, refs[0].color) : null;
      if (thief && victim && total > 0) {
        for (const r of RESOURCES) {
          if (counts[r] > 0) {
            giveResource(thief, r, counts[r]);
            takeResource(victim, r, counts[r]);
          }
        }
        renderSoon();
      }
      // Always claim the message — falling through would let the generic
      // "stole" branch below misread it as a Monopoly play.
      return;
    }

    // --- Dice roll ---
    if (text.includes('rolled') || text.includes('擲出') || text.includes('擲了')) {
      const sum = diceSum(msgEl);
      if (sum != null && sum >= 2 && sum <= 12) {
        state.diceCounts[sum] += 1;
        state.totalRolls += 1;
        renderSoon();
        return;
      }
    }

    // --- Gained resources (initial placement, roll yield, Year of Plenty) ---
    if (
      text.includes(' got ') || text.startsWith('got ') ||
      text.includes('received') || text.includes('獲得') ||
      text.includes('took from bank')
    ) {
      const { counts, total } = countResources(msgEl);
      if (total > 0 && player) {
        for (const r of RESOURCES) giveResource(player, r, counts[r]);
        renderSoon();
        return;
      }
    }

    // --- Built ---
    if (text.includes('built') || text.includes('建造')) {
      if (!player) return;
      if (text.includes('road')        || text.includes('道路'))  spend(player, BUILD_COST.road);
      else if (text.includes('settlement') || text.includes('聚落')) spend(player, BUILD_COST.settlement);
      else if (text.includes('city')       || text.includes('城市')) spend(player, BUILD_COST.city);
      renderSoon();
      return;
    }

    // --- Bought dev card ---
    // Text only contains "X bought " (the "Development Card" label is in the
    // image alt, not in textContent), so don't gate on substring matches —
    // dev cards are the only "buy" action in Catan.
    if (text.includes('bought') || text.includes('購買')) {
      if (player) spend(player, BUILD_COST.devcard);
      renderSoon();
      return;
    }

    // --- Discarded (robber) ---
    if (text.includes('discarded') || text.includes('棄了') || text.includes('棄牌')) {
      const { counts, total } = countResources(msgEl);
      if (total > 0 && player) {
        for (const r of RESOURCES) takeResource(player, r, counts[r]);
        renderSoon();
        return;
      }
    }

    // --- Stole (knight / robber moves or Monopoly) ---
    if (text.includes('stole') || text.includes('偷走') || text.includes('偷了')) {
      const refs = allPlayerRefs(msgEl);
      const { counts, total } = countResources(msgEl);

      // Knight/robber steal: "X stole from Y" (two players, no visible card type)
      if (refs.length >= 2) {
        const thief  = getPlayer(refs[0].name, refs[0].color);
        const victim = getPlayer(refs[1].name, refs[1].color);
        transferUnknown(victim, thief);
        renderSoon();
        return;
      }

      // Monopoly: "X stole N [resource]" — one player ref + visible resources.
      if (refs.length === 1 && total > 0 && player) {
        for (const r of RESOURCES) {
          if (counts[r] <= 0) continue;
          giveResource(player, r, counts[r]);
          for (const other of state.players.values()) {
            if (other === player) continue;
            if (other.resources[r] > 0) other.resources[r] = 0;
          }
        }
        renderSoon();
        return;
      }
    }

    // --- Trade between players ---
    // "X traded [A] for [B] with Y"
    if (text.includes('traded') && text.includes('with')) {
      const refs = allPlayerRefs(msgEl);
      if (refs.length >= 2 && player) {
        const other = getPlayer(refs[1].name, refs[1].color);
        // Split images by the word "for" in the text flow.
        const { give, recv } = splitTradeResources(msgEl);
        for (const r of RESOURCES) {
          if (give[r]) { takeResource(player, r, give[r]); giveResource(other,  r, give[r]); }
          if (recv[r]) { giveResource(player,  r, recv[r]); takeResource(other, r, recv[r]); }
        }
        renderSoon();
        return;
      }
    }

    // --- Bank / port trade: "X gave bank [A] and took [B]" ---
    if (
      (text.includes('gave bank') || text.includes('traded with bank') || text.includes('took from bank'))
      && player
    ) {
      const { give, recv } = splitTradeResources(msgEl);
      for (const r of RESOURCES) {
        if (give[r]) takeResource(player, r, give[r]);
        if (recv[r]) giveResource(player, r, recv[r]);
      }
      renderSoon();
      return;
    }
  }

  // Split resource images in a trade message into "given away" and
  // "received" piles, based on the word "for" (or "and took") in text.
  function splitTradeResources(msgEl) {
    const give = { lumber: 0, brick: 0, wool: 0, grain: 0, ore: 0 };
    const recv = { lumber: 0, brick: 0, wool: 0, grain: 0, ore: 0 };
    let bucket = give;
    const walker = document.createTreeWalker(msgEl, NodeFilter.SHOW_ALL);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (node.nodeType === Node.TEXT_NODE) {
        const t = (node.textContent || '').toLowerCase();
        if (t.includes(' for ') || t.includes(' and took ') || t.includes(' took ')) {
          bucket = recv;
        }
      } else if (node.nodeType === Node.ELEMENT_NODE && node.tagName === 'IMG') {
        const r = resourceFromImg(node);
        if (r) bucket[r] += 1;
      }
    }
    return { give, recv };
  }

  // =============================================================
  // Log container discovery + observer
  //
  // colonist.io renders the game log as a virtual list:
  //   div.virtualScroller-XXXX > div.scrollItemContainer-YYYY[data-index]
  //                              > div.feedMessage-ZZZZ > span.messagePart-...
  // Class suffixes are CSS-module hashes that change every deploy, so we
  // match by class prefix. Off-screen items get unmounted/remounted as the
  // user scrolls, so we de-dup by the stable `data-index` attribute rather
  // than by node identity.
  // =============================================================
  function findLogContainer() {
    // Walk up from any rendered message to its virtualScroller ancestor.
    const anyMessage = document.querySelector('[class*="feedMessage"]');
    if (anyMessage) {
      let cur = anyMessage.parentElement;
      while (cur) {
        const cls = cur.className || '';
        if (typeof cls === 'string' && cls.indexOf('virtualScroller') !== -1) {
          return cur;
        }
        cur = cur.parentElement;
      }
    }
    return document.querySelector('[class*="virtualScroller"]');
  }

  function processItem(itemEl) {
    if (!itemEl || itemEl.nodeType !== 1) return;
    if (!itemEl.matches || !itemEl.matches('[class*="scrollItemContainer"]')) return;
    const idx = itemEl.getAttribute('data-index');
    if (idx == null) return;
    if (state.seenIndices.has(idx)) return;
    state.seenIndices.add(idx);
    const msg = itemEl.querySelector('[class*="feedMessage"]');
    if (msg) processMessage(msg);
  }

  function scanExisting(container) {
    container.querySelectorAll('[class*="scrollItemContainer"]').forEach(processItem);
  }

  let observer = null;
  let observedContainer = null;
  function attachObserver() {
    const container = findLogContainer();
    if (!container) return false;
    if (container === observedContainer && observer) return true;
    if (observer) observer.disconnect();
    // New container = new game; reset transient log dedup but keep stats
    // unless the user explicitly hits the reset button.
    if (container !== observedContainer) state.seenIndices = new Set();
    observedContainer = container;
    scanExisting(container);
    observer = new MutationObserver((muts) => {
      if (state.paused) return;
      for (const m of muts) {
        m.addedNodes.forEach((n) => {
          if (n.nodeType !== 1) return;
          // Mutations may add a scrollItemContainer directly, or add it
          // inside a wrapper — handle both.
          if (n.matches && n.matches('[class*="scrollItemContainer"]')) {
            processItem(n);
          } else if (n.querySelectorAll) {
            n.querySelectorAll('[class*="scrollItemContainer"]').forEach(processItem);
          }
        });
      }
    });
    observer.observe(container, { childList: true, subtree: true });
    return true;
  }

  // =============================================================
  // UI panel
  // =============================================================
  let panel = null;
  let renderScheduled = false;
  function renderSoon() {
    if (renderScheduled) return;
    renderScheduled = true;
    requestAnimationFrame(() => { renderScheduled = false; render(); });
  }

  function createPanel() {
    if (panel) return;
    const host = document.createElement('div');
    host.id = 'colonist-stats-tracker';
    host.style.cssText =
      'position:fixed;top:80px;right:16px;z-index:2147483647;' +
      'width:320px;max-height:80vh;overflow:auto;' +
      'background:#1f1d18;color:#f4ecd8;border:1px solid #6b5b3b;' +
      'border-radius:10px;box-shadow:0 4px 16px rgba(0,0,0,0.4);' +
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;' +
      'font-size:12px;user-select:none;';
    host.innerHTML = `
      <div id="cst-header" style="display:flex;align-items:center;justify-content:space-between;
           padding:8px 10px;cursor:move;background:#2a271f;border-bottom:1px solid #6b5b3b;
           border-radius:10px 10px 0 0;">
        <strong style="font-size:13px;">🎲 Colonist Stats</strong>
        <div>
          <button id="cst-reset" title="Reset" style="background:transparent;border:1px solid #6b5b3b;
            color:#f4ecd8;border-radius:4px;padding:2px 6px;cursor:pointer;font-size:11px;margin-right:4px;">↺</button>
          <button id="cst-toggle" title="Minimize" style="background:transparent;border:1px solid #6b5b3b;
            color:#f4ecd8;border-radius:4px;padding:2px 6px;cursor:pointer;font-size:11px;">–</button>
        </div>
      </div>
      <div id="cst-body" style="padding:10px;">
        <div id="cst-dice"></div>
        <div id="cst-resources" style="margin-top:12px;"></div>
        <div id="cst-status" style="margin-top:8px;color:#a89b78;font-size:10px;"></div>
      </div>`;
    document.body.appendChild(host);
    panel = host;

    host.querySelector('#cst-reset').addEventListener('click', () => {
      for (const k of Object.keys(state.diceCounts)) state.diceCounts[k] = 0;
      state.totalRolls = 0;
      state.players.clear();
      state.seenIndices = new Set();
      if (observedContainer) scanExisting(observedContainer);
      render();
    });
    host.querySelector('#cst-toggle').addEventListener('click', (e) => {
      const body = host.querySelector('#cst-body');
      const hidden = body.style.display === 'none';
      body.style.display = hidden ? 'block' : 'none';
      e.currentTarget.textContent = hidden ? '–' : '+';
    });
    makeDraggable(host, host.querySelector('#cst-header'));
  }

  function makeDraggable(el, handle) {
    let dx = 0, dy = 0, sx = 0, sy = 0, dragging = false;
    handle.addEventListener('mousedown', (e) => {
      if (e.target.tagName === 'BUTTON') return;
      dragging = true;
      const rect = el.getBoundingClientRect();
      sx = e.clientX; sy = e.clientY;
      dx = rect.left; dy = rect.top;
      el.style.right = 'auto';
      e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      el.style.left = (dx + e.clientX - sx) + 'px';
      el.style.top  = (dy + e.clientY - sy) + 'px';
    });
    window.addEventListener('mouseup', () => { dragging = false; });
  }

  function renderDice() {
    const rows = [];
    let maxCount = 0;
    for (let n = 2; n <= 12; n++) maxCount = Math.max(maxCount, state.diceCounts[n]);
    for (let n = 2; n <= 12; n++) {
      const c = state.diceCounts[n];
      const pct = state.totalRolls ? (c / state.totalRolls * 100) : 0;
      const expected = EXPECTED_PCT[n];
      const barW = maxCount ? (c / maxCount * 100) : 0;
      const delta = pct - expected;
      const deltaColor = Math.abs(delta) < 2 ? '#a89b78' : (delta > 0 ? '#7fc67f' : '#e88b8b');
      rows.push(`
        <div style="display:grid;grid-template-columns:22px 1fr 44px 50px;align-items:center;gap:6px;margin:2px 0;">
          <span style="text-align:right;font-variant-numeric:tabular-nums;">${n}</span>
          <div style="background:#2a271f;height:12px;border-radius:2px;overflow:hidden;">
            <div style="background:#c9a86a;height:100%;width:${barW}%;transition:width 0.2s;"></div>
          </div>
          <span style="text-align:right;font-variant-numeric:tabular-nums;">${c}</span>
          <span style="text-align:right;color:${deltaColor};font-variant-numeric:tabular-nums;">
            ${pct.toFixed(1)}%
          </span>
        </div>`);
    }
    return `
      <div style="font-weight:600;margin-bottom:4px;">Dice Rolls (${state.totalRolls})</div>
      ${rows.join('')}
      <div style="margin-top:4px;color:#a89b78;font-size:10px;">
        Colour = actual vs expected (green above, red below, grey ≈ on).
      </div>`;
  }

  function renderResources() {
    if (state.players.size === 0) {
      return '<div style="font-weight:600;margin-bottom:4px;">Resources</div>' +
             '<div style="color:#a89b78;">Waiting for first move…</div>';
    }
    const lines = [];
    lines.push('<div style="font-weight:600;margin-bottom:4px;">Resources</div>');
    lines.push(`
      <div style="display:grid;grid-template-columns:1fr ${RESOURCES.map(() => '28px').join(' ')} 28px 32px;
           gap:4px;color:#a89b78;font-size:10px;padding:0 2px 4px;">
        <span>Player</span>
        ${RESOURCES.map((r) => `<span style="text-align:center;">${RESOURCE_LABEL[r]}</span>`).join('')}
        <span style="text-align:center;">?</span>
        <span style="text-align:right;">Σ</span>
      </div>`);
    for (const p of state.players.values()) {
      const total = playerTotal(p);
      lines.push(`
        <div style="display:grid;grid-template-columns:1fr ${RESOURCES.map(() => '28px').join(' ')} 28px 32px;
             gap:4px;align-items:center;padding:3px 2px;border-top:1px solid #3a352a;">
          <span style="color:${escapeAttr(p.color)};font-weight:600;overflow:hidden;text-overflow:ellipsis;">
            ${escapeHtml(p.name)}
          </span>
          ${RESOURCES.map((r) =>
            `<span style="text-align:center;font-variant-numeric:tabular-nums;
              ${p.resources[r] === 0 ? 'color:#555;' : ''}">${p.resources[r]}</span>`
          ).join('')}
          <span style="text-align:center;color:${p.unknown ? '#e0b84a' : '#555'};
            font-variant-numeric:tabular-nums;">${p.unknown}</span>
          <span style="text-align:right;font-weight:600;font-variant-numeric:tabular-nums;">${total}</span>
        </div>`);
    }
    return lines.join('');
  }

  function render() {
    if (!panel) return;
    panel.querySelector('#cst-dice').innerHTML = renderDice();
    panel.querySelector('#cst-resources').innerHTML = renderResources();
    const status = panel.querySelector('#cst-status');
    status.textContent = observer ? 'Live.' : 'Waiting for game log…';
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;',
    }[c]));
  }
  function escapeAttr(s) {
    if (!s) return '#f4ecd8';
    return String(s).replace(/["<>]/g, '');
  }

  // =============================================================
  // Boot
  // =============================================================
  function boot() {
    createPanel();
    render();
    let tries = 0;
    const timer = setInterval(() => {
      tries += 1;
      if (attachObserver()) {
        render();
        clearInterval(timer);
      } else if (tries > 120) {
        clearInterval(timer); // Give up after ~60s, stays idle till re-boot.
      }
    }, 500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  // Re-attach on SPA navigation. `seen` is a WeakSet so removed log nodes
  // are GC'd automatically; no need to clear it (clearing it would double-
  // count any messages still in the DOM).
  let lastPath = location.pathname;
  new MutationObserver(() => {
    if (location.pathname !== lastPath) {
      lastPath = location.pathname;
      attachObserver();
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
})();
