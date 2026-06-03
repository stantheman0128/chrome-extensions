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
    unknown: '?',
  };

  // colonist's own resource-card SVGs. The URLs carry a content hash that
  // changes per deploy, so these are only sensible *defaults*: resourceFromImg()
  // overwrites each entry with the live src the moment that card is seen in the
  // log, so the panel self-heals to whatever colonist currently serves.
  const RESOURCE_ICON = {
    lumber: 'https://cdn.colonist.io/dist/assets/card_lumber.cf22f8083cf89c2a29e7.svg',
    brick:  'https://cdn.colonist.io/dist/assets/card_brick.5950ea07a7ea01bc54a5.svg',
    wool:   'https://cdn.colonist.io/dist/assets/card_wool.17a6dea8d559949f0ccc.svg',
    grain:  'https://cdn.colonist.io/dist/assets/card_grain.09c9d82146a64bce69b5.svg',
    ore:    'https://cdn.colonist.io/dist/assets/card_ore.117f64dab28e1c987958.svg',
    // colonist's face-down "?" card — used to head the unknown-cards column.
    unknown: 'https://cdn.colonist.io/dist/assets/card_rescardback.03c18312a76028b0d9c9.svg',
  };

  // Palette sampled from colonist's own side panels (player cards / chat / log):
  // a light warm-grey card on the blue page, near-black text, blue accents, and
  // the familiar green/terracotta resource tones. Grouped here so the whole look
  // is one easy edit.
  const THEME = {
    bg:       '#ece9e1', // panel — light warm grey (matches colonist cards)
    bgAlt:    '#ddd8ca', // header strip
    rowLine:  '#d2ccbd', // row separators
    text:     '#2d2a24', // near-black body text
    textDim:  '#857c66', // muted labels
    border:   '#c6bfae', // panel + control borders
    bar:      '#5b93c8', // dice bar — colonist blue (neutral)
    barTrack: '#d8d3c4', // dice bar track
    good:     '#3f8f3f', // above expected (green)
    bad:      '#c0533a', // below expected (terracotta)
    accent:   '#2f6f9f', // headings — colonist blue
  };

  const BUILD_COST = {
    road:       { lumber: 1, brick: 1 },
    settlement: { lumber: 1, brick: 1, wool: 1, grain: 1 },
    city:       { ore: 3, grain: 2 },
    devcard:    { wool: 1, grain: 1, ore: 1 },
  };

  // Catan ships 19 cards of each resource in the bank/supply.
  const BANK_TOTAL = 19;

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

  // Cards still sitting in the bank for each resource: 19 minus what every
  // player is *known* to hold. Unknown (stolen) cards can't be attributed to a
  // resource, so this is an UPPER bound when unknowns are in play. Clamped to
  // [0, 19] — a value outside that range would mean our tracking has drifted.
  function bankRemaining() {
    const bank = {};
    for (const r of RESOURCES) {
      let held = 0;
      for (const p of state.players.values()) held += p.resources[r];
      bank[r] = Math.max(0, Math.min(BANK_TOTAL, BANK_TOTAL - held));
    }
    return bank;
  }

  // True when any player holds unknown (stolen, untyped) cards — in which case
  // bankRemaining() is an upper bound rather than an exact count.
  function hasUnknownCards() {
    for (const p of state.players.values()) if (p.unknown > 0) return true;
    return false;
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
    const rawSrc = img.getAttribute('src') || '';
    const src = rawSrc.toLowerCase();
    // The face-down "?" card isn't a resource, but cache its live URL so the
    // unknown-cards column header can use colonist's own art.
    if (src.indexOf('card_rescardback') !== -1) {
      RESOURCE_ICON.unknown = rawSrc;
      return null;
    }
    for (const r of RESOURCES) {
      if (src.indexOf('card_' + r) !== -1) {
        // Cache colonist's current card art so the panel uses the live URL.
        RESOURCE_ICON[r] = rawSrc;
        return r;
      }
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
    // Skip "You stole … from <Victim>"-style lines: there the only coloured
    // name is the victim, while the icon_player avatar belongs to the local
    // human. Inferring selfName here would wrongly tag the victim as self.
    if (!state.selfName && player && !text.startsWith('you ')) {
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

    // --- Executed player-to-player trade ---
    // Real colonist format: "X gave [A] and got [B] from Y" (no "traded"/"with").
    // The text contains " got ", so this MUST run before the generic "got" gain
    // branch below — otherwise that branch would count BOTH the given-away and
    // received cards as a net gain for X, double-counting the trade.
    if (text.includes('gave') && text.includes('and got') && text.includes('from')) {
      const refs = allPlayerRefs(msgEl);
      if (refs.length >= 2) {
        const actor = getPlayer(refs[0].name, refs[0].color);
        const other = getPlayer(refs[1].name, refs[1].color);
        const { give, recv } = splitTradeResources(msgEl);
        for (const r of RESOURCES) {
          if (give[r]) { takeResource(actor, r, give[r]); giveResource(other, r, give[r]); }
          if (recv[r]) { giveResource(actor, r, recv[r]); takeResource(other, r, recv[r]); }
        }
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

      // Monopoly: "X stole N [resource]" — one player ref + a single resource
      // icon. The QUANTITY is the number in the text (the icon shows only one
      // copy), so parse it rather than counting icons. The named resource is
      // taken from every other player and handed to X.
      if (refs.length === 1 && total > 0 && player) {
        const m = text.match(/stole\s+(\d+)/);
        const stolenCount = m ? parseInt(m[1], 10) : 0;
        for (const r of RESOURCES) {
          if (counts[r] <= 0) continue;
          giveResource(player, r, stolenCount || counts[r]);
          for (const other of state.players.values()) {
            if (other === player) continue;
            if (other.resources[r] > 0) other.resources[r] = 0;
          }
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
        // The boundary word between "given away" and "received" differs by
        // trade type: player trades say "… and got …", bank trades "… and took
        // …", and the legacy "… for …" form is kept for safety.
        if (
          t.includes(' and got ') || t.includes(' and received ') ||
          t.includes(' for ') || t.includes(' and took ') || t.includes(' took ')
        ) {
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

  // ---- persisted UI prefs (position, size, font scale, minimized) ----
  const UI_KEY = 'colonist-stats-tracker:ui';
  function loadUI() {
    try { return JSON.parse(localStorage.getItem(UI_KEY)) || {}; }
    catch (e) { return {}; }
  }
  function saveUI(patch) {
    try { localStorage.setItem(UI_KEY, JSON.stringify({ ...loadUI(), ...patch })); }
    catch (e) { /* storage unavailable — non-fatal */ }
  }

  function ctrlBtn(id, label, title) {
    return `<button id="${id}" title="${title}" style="background:transparent;` +
      `border:1px solid ${THEME.border};color:${THEME.text};border-radius:4px;` +
      `padding:1px 6px;cursor:pointer;font-size:0.85em;line-height:1.5;">${label}</button>`;
  }

  // An <img> of colonist's resource card, sized in EM so it scales with the
  // panel font (which itself tracks the panel width). alt falls back to the
  // emoji if the URL ever 404s, keeping us CSP-safe (no inline error handlers).
  function iconImg(r, em) {
    const w = (em * 0.7125).toFixed(3);
    return `<img src="${escapeAttr(RESOURCE_ICON[r])}" alt="${RESOURCE_LABEL[r]}" title="${r}" ` +
      `style="height:${em}em;width:${w}em;vertical-align:middle;">`;
  }

  // Zoom model (方案二): one font-size drives the whole panel and is derived from
  // its width, so dragging the panel wider scales everything (font, em icons,
  // bars) at once. No +/- buttons.
  function fontFromWidth(w) {
    return Math.max(10, Math.min(22, Math.round(w / 27)));
  }

  // Per-panel / per-section fold state (persisted).
  const uiState = { panelCollapsed: false, diceCollapsed: false, resCollapsed: false };

  // Animate a section body open/closed via max-height (height:auto can't
  // transition, so we go to the measured scrollHeight then to 'none'/0).
  function setSectionOpen(wrap, open, animate) {
    if (!wrap) return;
    if (!animate) { wrap.style.maxHeight = open ? 'none' : '0'; return; }
    if (open) {
      wrap.style.maxHeight = wrap.scrollHeight + 'px';
      const done = () => { wrap.style.maxHeight = 'none'; wrap.removeEventListener('transitionend', done); };
      wrap.addEventListener('transitionend', done);
    } else {
      wrap.style.maxHeight = wrap.scrollHeight + 'px';
      void wrap.offsetHeight; // force reflow so the next change animates
      wrap.style.maxHeight = '0';
    }
  }

  function applySectionInit() {
    setSectionOpen(panel.querySelector('#cst-dice-wrap'), !uiState.diceCollapsed, false);
    setSectionOpen(panel.querySelector('#cst-res-wrap'), !uiState.resCollapsed, false);
  }

  // Collapse the whole panel down to a single spinning dice icon (no circle —
  // just the dice) and back. The width/height transition is enabled ONLY for
  // this toggle (the base style has none, so live drag-resizing stays instant).
  function setPanelCollapsed(collapsed) {
    uiState.panelCollapsed = collapsed;
    saveUI({ panelCollapsed: collapsed });
    const host = panel;
    const body = host.querySelector('#cst-body');
    const header = host.querySelector('#cst-header');
    const title = host.querySelector('#cst-title');
    const glyph = host.querySelector('#cst-glyph');
    const controls = host.querySelector('#cst-controls');
    host.style.overflow = 'hidden';
    host.style.transition =
      'width .25s ease, height .25s ease, background-color .25s ease, border-color .25s ease, box-shadow .25s ease';
    // Pin the current size first so height can animate (auto can't transition).
    host.style.width = host.offsetWidth + 'px';
    host.style.height = host.offsetHeight + 'px';
    void host.offsetHeight; // reflow
    if (collapsed) {
      host.style.resize = 'none';
      host.style.minWidth = '0';
      title.style.display = 'none';
      if (controls) controls.style.display = 'none';
      header.style.background = 'transparent';
      header.style.borderBottom = 'none';
      header.style.padding = '0';
      header.style.justifyContent = 'center';
      header.style.height = '100%';
      host.style.background = 'transparent';
      host.style.borderColor = 'transparent';
      host.style.boxShadow = 'none';
      host.style.width = '36px';
      host.style.height = '36px';
      glyph.style.fontSize = '1.7em';
      glyph.style.transform = 'rotate(360deg)';
      setTimeout(() => {
        body.style.display = 'none';
        host.style.overflow = 'visible'; // let the hover shadow show
        host.style.transition = '';
      }, 260);
    } else {
      const w = loadUI().width || 340;
      body.style.display = 'block';
      host.style.resize = 'both';
      host.style.minWidth = '250px';
      title.style.display = '';
      if (controls) controls.style.display = 'flex';
      header.style.background = THEME.bgAlt;
      header.style.borderBottom = `1px solid ${THEME.border}`;
      header.style.padding = '8px 11px';
      header.style.justifyContent = 'space-between';
      header.style.height = '';
      host.style.background = THEME.bg;
      host.style.borderColor = THEME.border;
      host.style.boxShadow = '0 6px 20px rgba(40,30,10,0.30)';
      host.style.fontSize = fontFromWidth(w) + 'px';
      glyph.style.fontSize = '';
      glyph.style.transform = 'rotate(0deg)';
      host.style.width = w + 'px';
      void host.offsetHeight;
      host.style.height = host.scrollHeight + 'px';
      setTimeout(() => {
        host.style.height = 'auto';
        host.style.overflow = 'auto';
        host.style.transition = '';
      }, 260);
    }
  }

  // Reset the panel's SIZE, POSITION and appearance to defaults — WITHOUT
  // touching the tracked stats (the old stats-wiping reset is gone for good).
  function resetLayout() {
    uiState.panelCollapsed = false;
    uiState.diceCollapsed = false;
    uiState.resCollapsed = false;
    try { localStorage.removeItem(UI_KEY); } catch (e) {}
    const host = panel;
    const header = host.querySelector('#cst-header');
    const title = host.querySelector('#cst-title');
    const controls = host.querySelector('#cst-controls');
    const glyph = host.querySelector('#cst-glyph');
    host.style.transition = '';
    host.style.resize = 'both';
    host.style.minWidth = '250px';
    host.style.overflow = 'auto';
    host.style.background = THEME.bg;
    host.style.borderColor = THEME.border;
    host.style.boxShadow = '0 6px 20px rgba(40,30,10,0.30)';
    host.style.borderRadius = '10px';
    host.style.right = 'auto';
    host.style.left = '16px';
    host.style.top = '16px';
    host.style.width = '340px';
    host.style.height = 'auto';
    host.style.fontSize = fontFromWidth(340) + 'px';
    header.style.background = THEME.bgAlt;
    header.style.borderBottom = `1px solid ${THEME.border}`;
    header.style.padding = '8px 11px';
    header.style.justifyContent = 'space-between';
    header.style.height = '';
    title.style.display = '';
    if (controls) controls.style.display = 'flex';
    glyph.style.fontSize = '';
    glyph.style.transform = 'rotate(0deg)';
    host.querySelector('#cst-body').style.display = 'block';
    host.querySelectorAll('.cst-chev').forEach((c) => { c.textContent = '▾'; });
    applySectionInit();
    render();
  }

  function createPanel() {
    if (panel) return;
    const ui = loadUI();
    uiState.panelCollapsed = !!ui.panelCollapsed;
    uiState.diceCollapsed = !!ui.diceCollapsed;
    uiState.resCollapsed = !!ui.resCollapsed;
    const host = document.createElement('div');
    host.id = 'colonist-stats-tracker';
    const place = ui.left != null ? `left:${ui.left}px;top:${ui.top}px;` : 'top:16px;left:16px;';
    const width = ui.width || 340;
    // resize:both → drag any corner/edge. Width drives the font size, so a wider
    // panel zooms everything; height adds vertical room. Height defaults to auto.
    host.style.cssText =
      `position:fixed;${place}width:${width}px;z-index:2147483647;` +
      'height:auto;max-height:92vh;min-width:250px;overflow:auto;resize:both;' +
      `background:${THEME.bg};color:${THEME.text};border:1px solid ${THEME.border};` +
      'border-radius:10px;box-shadow:0 6px 20px rgba(40,30,10,0.30);' +
      'font-family:"Open Sans",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;' +
      `font-size:${fontFromWidth(width)}px;user-select:none;` +
      // Promote to a clean GPU layer so the overlay composites over colonist's
      // WebGL board without leaving repaint "ghost trails".
      'transform:translateZ(0);backface-visibility:hidden;';
    const secHead = 'display:flex;justify-content:space-between;align-items:baseline;cursor:pointer;';
    host.innerHTML = `
      <div id="cst-header" style="display:flex;align-items:center;justify-content:space-between;gap:6px;
           padding:8px 11px;cursor:move;background:${THEME.bgAlt};border-bottom:1px solid ${THEME.border};
           border-radius:10px 10px 0 0;position:sticky;top:0;z-index:1;">
        <strong style="font-size:1.05em;color:${THEME.accent};white-space:nowrap;display:flex;align-items:center;gap:6px;">
          <span id="cst-glyph" title="Click to collapse / expand" style="cursor:pointer;display:inline-block;transition:transform .35s ease, font-size .25s ease, filter .15s ease;">🎲</span>
          <span id="cst-title">Colonist Stats</span>
        </strong>
        <div id="cst-controls" style="display:flex;gap:4px;align-items:center;">
          ${ctrlBtn('cst-refresh', '⟳', 'Reset size & position (keeps stats)')}
        </div>
      </div>
      <div id="cst-body" style="padding:12px 14px 13px;">
        <div id="cst-dice-head" data-fold="diceCollapsed" style="${secHead}margin-bottom:7px;">
          <strong style="color:${THEME.accent};"><span class="cst-chev">${uiState.diceCollapsed ? '▸' : '▾'}</span> Dice Rolls</strong>
          <span id="cst-dice-rolls" style="color:${THEME.textDim};font-size:0.82em;"></span>
        </div>
        <div id="cst-dice-wrap" style="overflow:hidden;transition:max-height .28s ease;"><div id="cst-dice"></div></div>
        <div id="cst-res-head" data-fold="resCollapsed" style="${secHead}margin-top:14px;">
          <strong style="color:${THEME.accent};"><span class="cst-chev">${uiState.resCollapsed ? '▸' : '▾'}</span> Resources</strong>
        </div>
        <div id="cst-res-wrap" style="overflow:hidden;transition:max-height .28s ease;"><div id="cst-resources"></div></div>
      </div>`;
    document.body.appendChild(host);
    panel = host;

    // Inject the :hover rule once (inline styles can't express :hover).
    if (!document.getElementById('cst-style')) {
      const st = document.createElement('style');
      st.id = 'cst-style';
      st.textContent = '#colonist-stats-tracker #cst-glyph:hover{filter:drop-shadow(0 2px 4px rgba(0,0,0,.5));}';
      (document.head || document.documentElement).appendChild(st);
    }

    // Click a section header to fold/unfold it (animated). Delegated so it keeps
    // working across content re-renders. Re-fit the panel height to content so
    // folding actually shrinks the whole panel (no leftover empty space).
    host.addEventListener('click', (e) => {
      const head = e.target.closest && e.target.closest('[data-fold]');
      if (!head || !host.contains(head)) return;
      const key = head.getAttribute('data-fold');
      uiState[key] = !uiState[key];
      saveUI({ [key]: uiState[key] });
      const open = !uiState[key];
      setSectionOpen(head.nextElementSibling, open, true);
      host.style.height = 'auto';
      const c = head.querySelector('.cst-chev');
      if (c) c.textContent = open ? '▾' : '▸';
    });

    // Width drives font size. Update the font LIVE on every resize tick so the
    // content tracks the drag instead of lagging; only the save is debounced.
    if (typeof ResizeObserver !== 'undefined') {
      let rT, lastW = 0;
      new ResizeObserver(() => {
        if (uiState.panelCollapsed) return;
        const w = host.offsetWidth;
        if (w === lastW) return;
        lastW = w;
        host.style.fontSize = fontFromWidth(w) + 'px';
        clearTimeout(rT);
        rT = setTimeout(() => saveUI({ width: w }), 250);
      }).observe(host);
    }

    host.querySelector('#cst-refresh').addEventListener('click', resetLayout);

    makeDraggable(host, host.querySelector('#cst-header'));

    render();
    applySectionInit();
    if (uiState.panelCollapsed) setPanelCollapsed(true);
  }

  function makeDraggable(el, handle) {
    let dx = 0, dy = 0, sx = 0, sy = 0, dragging = false, moved = false, onGlyph = false;
    handle.addEventListener('mousedown', (e) => {
      if (e.target.tagName === 'BUTTON') return;
      dragging = true; moved = false;
      onGlyph = !!(e.target.closest && e.target.closest('#cst-glyph'));
      const rect = el.getBoundingClientRect();
      sx = e.clientX; sy = e.clientY;
      dx = rect.left; dy = rect.top;
      el.style.right = 'auto';
      e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      if (Math.abs(e.clientX - sx) + Math.abs(e.clientY - sy) > 3) moved = true;
      el.style.left = (dx + e.clientX - sx) + 'px';
      el.style.top  = (dy + e.clientY - sy) + 'px';
    });
    window.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      if (!moved) {
        // Click (no drag): the dice glyph toggles the whole-panel collapse;
        // when already collapsed, a click anywhere on the icon expands it.
        if (uiState.panelCollapsed) { setPanelCollapsed(false); return; }
        if (onGlyph) { setPanelCollapsed(true); return; }
        return;
      }
      saveUI({ left: parseInt(el.style.left, 10), top: parseInt(el.style.top, 10) });
    });
  }

  // Dice histogram bars (the section header lives in the static skeleton).
  function renderDiceBars() {
    let maxCount = 0;
    for (let n = 2; n <= 12; n++) maxCount = Math.max(maxCount, state.diceCounts[n]);
    const cols = [];
    for (let n = 2; n <= 12; n++) {
      const c = state.diceCounts[n];
      const pct = state.totalRolls ? (c / state.totalRolls * 100) : 0;
      const expected = EXPECTED_PCT[n];
      const barH = maxCount ? Math.round((c / maxCount) * 100) : 0;
      const delta = pct - expected;
      const barColor = Math.abs(delta) < 2 ? THEME.bar : (delta > 0 ? THEME.good : THEME.bad);
      cols.push(`
        <div style="flex:1 1 0;display:flex;flex-direction:column;align-items:center;gap:1px;min-width:0;">
          <span style="font-size:0.72em;font-variant-numeric:tabular-nums;color:${THEME.textDim};">${c}</span>
          <div style="width:100%;height:3.6em;display:flex;align-items:flex-end;justify-content:center;">
            <div title="${n}: ${c} rolls · ${pct.toFixed(1)}% (expected ${expected}%)"
                 style="width:74%;height:${barH}%;min-height:2px;background:${barColor};
                 border-radius:3px 3px 0 0;transition:height .2s;"></div>
          </div>
          <span style="font-size:0.92em;font-weight:700;font-variant-numeric:tabular-nums;
                color:${n === 7 ? THEME.bad : THEME.text};">${n}</span>
          <span style="font-size:0.66em;font-variant-numeric:tabular-nums;color:${barColor};">${Math.round(pct)}%</span>
        </div>`);
    }
    return `<div style="display:flex;align-items:flex-end;gap:3px;">${cols.join('')}</div>`;
  }

  // Read colonist's own player panel for the authoritative turn order AND each
  // player's avatar. Matched by stable data-attributes so it survives colonist's
  // CSS-hash renames. Returns [{name, avatar}] top-to-bottom, or null if the
  // panel isn't on the page (e.g. the lobby, or under jsdom in tests).
  function readPlayerPanel() {
    const seen = new Set();
    const out = [];
    document.querySelectorAll('[data-player-color]').forEach((row) => {
      const nameEl = row.querySelector('[class*="username"]');
      if (!nameEl) return;
      const name = (nameEl.textContent || '').trim();
      if (!name || seen.has(name)) return;
      seen.add(name);
      const av = row.querySelector('[class*="avatarImage"]');
      out.push({ name, avatar: av ? av.getAttribute('src') : null });
    });
    return out.length ? out : null;
  }

  // Resources table. Each resource icon's header carries a top-right badge with
  // the bank-remaining count (like colonist's supply row); the last column is
  // the unknown/stolen-card count, headed by colonist's face-down "?" card. No
  // separate Σ total — colonist's own dashboard already shows each hand size.
  // Player rows follow colonist's panel order and show each player's avatar.
  function renderResTable() {
    const bank = bankRemaining();
    const cols = `minmax(88px,1.7fr) repeat(${RESOURCES.length}, 1fr) 0.95fr`;

    const iconCell = (r) => {
      const low = bank[r] <= 2;
      return `<span style="text-align:center;">
        <span style="position:relative;display:inline-block;line-height:0;">
          ${iconImg(r, 1.7)}
          <span title="Bank: ${bank[r]} left"
                style="position:absolute;top:-0.55em;right:-0.7em;min-width:1.2em;padding:0 0.25em;text-align:center;
                background:#fbf9f4;color:${low ? THEME.bad : THEME.text};border:1px solid ${THEME.border};
                border-radius:0.7em;font-size:0.6em;font-weight:700;line-height:1.5;
                box-shadow:0 1px 2px rgba(0,0,0,.2);">${bank[r]}</span>
        </span>
      </span>`;
    };

    const head = `
      <div style="display:grid;grid-template-columns:${cols};gap:4px;align-items:end;padding:0.9em 3px 0.7em;">
        <span style="color:${THEME.textDim};font-size:0.8em;">Player</span>
        ${RESOURCES.map(iconCell).join('')}
        <span style="text-align:center;" title="Unknown (stolen) cards">${iconImg('unknown', 1.55)}</span>
      </div>`;

    if (state.players.size === 0) {
      return head + `<div style="color:${THEME.textDim};padding:5px 3px;">Waiting for first move…</div>`;
    }

    // Order + avatars from colonist's panel; fall back to first-seen order.
    const profiles = readPlayerPanel();
    const prof = profiles ? new Map(profiles.map((p, i) => [p.name, { avatar: p.avatar, order: i }])) : null;
    const players = [...state.players.values()];
    if (prof) {
      players.sort((a, b) =>
        (prof.has(a.name) ? prof.get(a.name).order : 1e9) -
        (prof.has(b.name) ? prof.get(b.name).order : 1e9));
    }

    const rows = [];
    for (const p of players) {
      const av = prof && prof.get(p.name) && prof.get(p.name).avatar;
      const avatar = av
        ? `<span style="display:inline-flex;flex:0 0 auto;width:1.5em;height:1.5em;margin-right:5px;
            border-radius:50%;overflow:hidden;background:${escapeAttr(p.color)};align-items:center;justify-content:center;">
            <img src="${escapeAttr(av)}" alt="" style="width:100%;height:100%;object-fit:contain;"></span>`
        : '';
      rows.push(`
        <div style="display:grid;grid-template-columns:${cols};gap:4px;align-items:center;
             padding:5px 3px;border-top:1px solid ${THEME.rowLine};">
          <span style="display:flex;align-items:center;color:${escapeAttr(p.color)};font-weight:700;overflow:hidden;white-space:nowrap;" title="${escapeHtml(p.name)}">${avatar}<span style="overflow:hidden;text-overflow:ellipsis;">${escapeHtml(p.name)}</span></span>
          ${RESOURCES.map((r) =>
            `<span style="text-align:center;font-variant-numeric:tabular-nums;${p.resources[r] === 0 ? `color:${THEME.textDim};opacity:.4;` : ''}">${p.resources[r]}</span>`
          ).join('')}
          <span style="text-align:center;font-variant-numeric:tabular-nums;color:${p.unknown ? THEME.accent : THEME.textDim};${p.unknown ? 'font-weight:700;' : 'opacity:.4;'}">${p.unknown}</span>
        </div>`);
    }
    return head + rows.join('');
  }

  function render() {
    if (!panel) return;
    const d = panel.querySelector('#cst-dice');
    if (d) d.innerHTML = renderDiceBars();
    const r = panel.querySelector('#cst-resources');
    if (r) r.innerHTML = renderResTable();
    const rolls = panel.querySelector('#cst-dice-rolls');
    if (rolls) rolls.textContent = `${state.totalRolls} rolls`;
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

  // Reset all tracked stats. Shared by the panel's reset button and tests.
  function resetState() {
    for (const k of Object.keys(state.diceCounts)) state.diceCounts[k] = 0;
    state.totalRolls = 0;
    state.players.clear();
    state.seenIndices = new Set();
    state.selfName = null;
    state.paused = false;
  }

  // In a browser (no CommonJS `module`) boot immediately and follow SPA
  // navigation. Under Node (the synthetic-log test harness) we skip every
  // DOM/observer side effect and instead export the pure parsing functions.
  const isCommonJS = typeof module !== 'undefined' && module.exports;
  if (isCommonJS) {
    // Node test harness: export the pure functions, no DOM side effects.
    module.exports = {
      state,
      resetState,
      processMessage,
      splitTradeResources,
      countResources,
      diceSum,
      getPlayer,
      giveResource,
      takeResource,
      bankRemaining,
      hasUnknownCards,
      // UI entry points (exposed so the jsdom smoke test can render the panel).
      createPanel,
      render,
    };
  } else if (typeof window !== 'undefined' && window.__CST_PREVIEW__) {
    // Preview harness (preview.html): build the panel but DON'T attach to
    // colonist. Expose internals so the page can seed mock data and re-render.
    createPanel();
    render();
    window.__CST__ = {
      state, getPlayer, giveResource, resetState, render, RESOURCE_ICON, THEME,
    };
  } else {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', boot);
    } else {
      boot();
    }

    // Re-attach on SPA navigation. seenIndices is reset per-container inside
    // attachObserver(), so on a path change we only need to re-discover the log.
    let lastPath = location.pathname;
    new MutationObserver(() => {
      if (location.pathname !== lastPath) {
        lastPath = location.pathname;
        attachObserver();
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
  }
})();
