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
    rollHistory: [],     // ordered dice sums — powers "rolls since last N"
    currentTurn: null,   // last player to roll = whose turn it (probably) is
    players: new Map(), // name -> { color, resources:{}, unknown:number }
    seenIndices: new Set(), // log message data-index values already processed
    selfName: null, // local human player; messages with avatar=icon_player.svg
    paused: false,
    gameStartTs: null, // ms epoch — when the current game's clock started
    gameEndTs: null,   // set when the winner line is seen; freezes the clock
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

    // --- Game over: "Bradly won the game!" ---
    // Handled before any player bookkeeping: the winner line must not create a
    // player entry or disturb counts, it only drives the lifecycle.
    if (text.includes('won the game') || text.includes('贏得')) {
      onGameWon();
      return;
    }

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
        state.rollHistory.push(sum);
        if (player) state.currentTurn = player.name;
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
    // New container = new game; reset the per-game dedup — EXCEPT on the first
    // attach right after a restore, where we keep the restored seenIndices so the
    // already-counted messages aren't double-processed.
    if (container !== observedContainer) {
      if (lifecycle === LIFE.ENDED && observedContainer) {
        // A brand-new log right after a finished game = the "play again" flow.
        // The roster check alone can't catch a same-players rematch, so the
        // fresh container is the new-game signal here.
        startNextGame();
      } else if (!justRestored) {
        state.seenIndices = new Set();
      }
      justRestored = false;
    }
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
    requestAnimationFrame(() => { renderScheduled = false; render(); schedulePersist(); });
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
    return `<button id="${id}" title="${title}" aria-label="${title}" style="display:inline-flex;` +
      `align-items:center;justify-content:center;background:transparent;` +
      `border:1px solid ${THEME.border};color:${THEME.text};border-radius:5px;` +
      `padding:3px 5px;cursor:pointer;line-height:0;` +
      `transition:background .12s ease,border-color .12s ease;">${label}</button>`;
  }

  // Inline SVG control icons (Lucide-style). Monochrome via currentColor so they
  // follow the button colour — including the armed red state — and scale in em
  // with the panel zoom. No external assets, so still CSP-clean.
  function svgIcon(inner) {
    return `<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" ` +
      `stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ` +
      `style="display:block;">${inner}</svg>`;
  }
  const ICON_SYNC = svgIcon('<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/>' +
    '<path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/>' +
    '<path d="M3 21v-5h5"/>');                                                   // refresh / sync
  // Horizontal chevrons — direction reads clearly even at 16px (no competing
  // diagonal line). Apart = enlarge (‹ ›), together = shrink (› ‹).
  const ICON_ENLARGE = svgIcon('<polyline points="9 8 5 12 9 16"/>' +
    '<polyline points="15 8 19 12 15 16"/>');                                    // ‹ › → go large
  const ICON_SHRINK = svgIcon('<polyline points="5 8 9 12 5 16"/>' +
    '<polyline points="19 8 15 12 19 16"/>');                                    // › ‹ → go small
  const ICON_MORE = '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" ' +
    'aria-hidden="true" style="display:block;"><circle cx="12" cy="5" r="1.7"/>' +
    '<circle cx="12" cy="12" r="1.7"/><circle cx="12" cy="19" r="1.7"/></svg>';  // more → presets menu

  function menuBtn(act, label) {
    return `<button data-act="${act}" class="cst-menu-item" style="display:block;width:100%;` +
      `text-align:left;background:transparent;border:0;color:${THEME.text};border-radius:5px;` +
      `padding:6px 8px;cursor:pointer;font-size:0.82em;white-space:nowrap;` +
      `transition:background .12s ease;">${label}</button>`;
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
  // Width drives the base font; the ⋮ menu's text-size controls nudge it via
  // uiState.fontScale. One place computes the final px so every caller agrees.
  function fpx(w) {
    return (fontFromWidth(w) * uiState.fontScale) + 'px';
  }
  function refreshFont() {
    if (panel && !uiState.panelCollapsed) panel.style.fontSize = fpx(panel.offsetWidth);
  }

  // Per-panel / per-section fold state (persisted).
  // diceMode: 'auto' shows physical dice only when the panel is wide enough for a
  // pair to breathe (else digits); 'faces'/'digits' are sticky manual overrides.
  const uiState = { panelCollapsed: false, diceCollapsed: false, resCollapsed: false, mode: 'large', fontScale: 1, diceMode: 'auto' };
  // At/above this panel width, auto-mode renders the bottom value as dice (vs a digit).
  const DICE_AUTO_W = 372;
  function diceFacesActive() {
    if (uiState.diceMode === 'faces') return true;
    if (uiState.diceMode === 'digits') return false;
    return !!panel && panel.offsetWidth >= DICE_AUTO_W;   // 'auto'
  }

  // Two saved layouts the panel toggles between — each a position + width (height
  // is auto, font tracks width). DEFAULT_PRESETS are the built-ins; dragging or
  // resizing updates the *active* one, and the ⋮ menu can overwrite or reset them.
  const DEFAULT_PRESETS = {
    large: { left: 16, top: 16, width: 400 },
    small: { left: 16, top: 16, width: 252 },
  };
  function getPresets() {
    const p = (loadUI().presets) || {};
    return {
      large: { ...DEFAULT_PRESETS.large, ...(p.large || {}) },
      small: { ...DEFAULT_PRESETS.small, ...(p.small || {}) },
    };
  }
  function updateActivePreset(patch) {
    const presets = getPresets();
    presets[uiState.mode] = { ...presets[uiState.mode], ...patch };
    saveUI({ presets });
  }

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
    const timerEl = host.querySelector('#cst-timer');
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
      if (timerEl) timerEl.style.display = 'none';
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
      const w = getPresets()[uiState.mode].width;   // restore to the active preset, not a stale default
      body.style.display = 'flex';
      host.style.resize = 'both';
      host.style.minWidth = '250px';
      title.style.display = '';
      if (timerEl) timerEl.style.display = '';
      if (controls) controls.style.display = 'flex';
      header.style.background = THEME.bgAlt;
      header.style.borderBottom = `1px solid ${THEME.border}`;
      header.style.padding = '8px 11px';
      header.style.justifyContent = 'space-between';
      header.style.height = '';
      host.style.background = THEME.bg;
      host.style.borderColor = THEME.border;
      host.style.boxShadow = '0 6px 20px rgba(40,30,10,0.30)';
      glyph.style.fontSize = '';
      glyph.style.transform = 'rotate(0deg)';
      // Measure the TRUE final height first, with the transition off: jump to
      // the final width, read scrollHeight, jump back. (Measuring while the
      // width was still animating from 36px read an in-between layout, which
      // made the expand look two-stage — open small, then stretch again.)
      // All within one JS turn, so nothing intermediate ever paints.
      host.style.transition = 'none';
      host.style.fontSize = fpx(w);
      host.style.width = w + 'px';
      host.style.height = 'auto';
      void host.offsetHeight;
      const targetH = host.scrollHeight;
      host.style.width = '36px';
      host.style.height = '36px';
      void host.offsetHeight;
      host.style.transition =
        'width .25s ease, height .25s ease, background-color .25s ease, border-color .25s ease, box-shadow .25s ease';
      host.style.width = w + 'px';
      host.style.height = targetH + 'px';
      setTimeout(() => {
        host.style.height = 'auto';
        host.style.overflow = 'hidden';   // host clips; the flex body scrolls
        host.style.transition = '';
      }, 260);
    }
  }

  // ---- Large / Small layout presets ----
  function sizeToggleIcon() {
    const btn = panel && panel.querySelector('#cst-size');
    if (btn) btn.innerHTML = uiState.mode === 'large' ? ICON_SHRINK : ICON_ENLARGE;
  }

  // Apply a saved preset (position + width) and remember it as the active mode.
  // The toggle icon then shows the *opposite* action (large → shrink, small → grow).
  // `animate` slides the panel to the preset with a one-shot transition, cleared
  // afterwards so live drag-resizing stays instant (the base style has none).
  let presetAnimTimer = null;
  function applyPreset(name, animate) {
    uiState.mode = name === 'small' ? 'small' : 'large';
    const p = getPresets()[uiState.mode];
    if (uiState.panelCollapsed) {
      // Expanding already animates to the (just-updated) active preset.
      setPanelCollapsed(false);
      sizeToggleIcon();
      return;
    }
    clearTimeout(presetAnimTimer);
    panel.style.transition = animate
      ? 'left .25s ease, top .25s ease, width .25s ease, font-size .25s ease'
      : '';
    panel.style.right = 'auto';
    panel.style.left = p.left + 'px';
    panel.style.top = p.top + 'px';
    panel.style.width = p.width + 'px';
    panel.style.height = 'auto';
    panel.style.fontSize = fpx(p.width);
    if (animate) presetAnimTimer = setTimeout(() => { panel.style.transition = ''; }, 260);
    sizeToggleIcon();
  }

  function toggleSize() {
    applyPreset(uiState.mode === 'large' ? 'small' : 'large', true);
  }

  // Overwrite a preset slot with the panel's CURRENT position + width.
  function saveCurrentAs(name) {
    const slot = name === 'small' ? 'small' : 'large';
    const r = panel.getBoundingClientRect();
    const presets = getPresets();
    presets[slot] = {
      left: Math.round(parseFloat(panel.style.left) || r.left),
      top: Math.round(parseFloat(panel.style.top) || r.top),
      width: Math.round(r.width) || DEFAULT_PRESETS[slot].width,
    };
    saveUI({ presets });
  }

  // Restore both presets (and the fold/appearance) to the built-in defaults.
  function resetPresets() {
    uiState.diceCollapsed = false;
    uiState.resCollapsed = false;
    uiState.fontScale = 1;
    uiState.diceMode = 'auto';
    saveUI({ presets: DEFAULT_PRESETS, diceCollapsed: false, resCollapsed: false, fontScale: 1, diceMode: 'auto' });
    panel.querySelector('#cst-body').style.display = 'flex';
    panel.querySelectorAll('.cst-chev').forEach((c) => { c.textContent = '▾'; });
    applySectionInit();
    applyPreset(uiState.mode);
    render();
  }

  // Independent text-size nudge (on top of the width-driven zoom), via the ⋮ menu.
  function changeFont(dir) {
    uiState.fontScale = Math.max(0.7, Math.min(1.6, Math.round((uiState.fontScale + dir * 0.1) * 10) / 10));
    saveUI({ fontScale: uiState.fontScale });
    refreshFont();
  }

  function createPanel() {
    if (panel) return;
    const ui = loadUI();
    uiState.panelCollapsed = !!ui.panelCollapsed;
    uiState.diceCollapsed = !!ui.diceCollapsed;
    uiState.resCollapsed = !!ui.resCollapsed;
    uiState.fontScale = ui.fontScale || 1;
    uiState.diceMode = ui.diceMode || 'auto';
    uiState.mode = 'large';                       // auto-enlarge to the large preset on appear
    const host = document.createElement('div');
    host.id = 'colonist-stats-tracker';
    const startP = getPresets().large;
    const place = `left:${startP.left}px;top:${startP.top}px;`;
    const width = startP.width;
    // resize:both → drag any corner/edge. Width drives the font size, so a wider
    // panel zooms everything; height adds vertical room. Height defaults to auto.
    host.style.cssText =
      `position:fixed;${place}width:${width}px;z-index:2147483647;` +
      'height:auto;min-width:250px;overflow:hidden;resize:both;' +
      // Flex column so the body can absorb extra drag-height as even spacing
      // (see #cst-body) instead of leaving blank space at the bottom.
      'display:flex;flex-direction:column;' +
      `background:${THEME.bg};color:${THEME.text};border:1px solid ${THEME.border};` +
      'border-radius:10px;box-shadow:0 6px 20px rgba(40,30,10,0.30);' +
      'font-family:"Open Sans",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;' +
      `font-size:${fpx(width)};user-select:none;` +
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
          <span id="cst-timer" title="Time since this game started"
                style="color:${THEME.textDim};font-size:0.74em;font-weight:600;font-variant-numeric:tabular-nums;"></span>
        </strong>
        <div id="cst-controls" style="display:flex;gap:4px;align-items:center;">
          ${ctrlBtn('cst-resync', ICON_SYNC, 'Deep re-sync: re-read the whole game log from the top')}
          ${ctrlBtn('cst-size', ICON_SHRINK, 'Toggle large / small layout')}
          ${ctrlBtn('cst-prefs', ICON_MORE, 'Layout presets')}
        </div>
        <div id="cst-menu" style="display:none;position:absolute;top:40px;right:10px;z-index:6;
             background:${THEME.bg};border:1px solid ${THEME.border};border-radius:8px;
             box-shadow:0 6px 18px rgba(40,30,10,.28);padding:5px;min-width:178px;">
          ${menuBtn('save-large', 'Save current as Large')}
          ${menuBtn('save-small', 'Save current as Small')}
          ${menuBtn('reset', 'Reset to defaults')}
          <div style="display:flex;align-items:center;gap:6px;padding:6px 8px 3px;margin-top:3px;border-top:1px solid ${THEME.border};">
            <span style="flex:1 1 auto;font-size:0.82em;color:${THEME.textDim};">Text size</span>
            <button data-act="font-down" title="Smaller text" style="display:inline-flex;align-items:center;justify-content:center;min-width:2.1em;height:1.8em;padding:0 .45em;border:1px solid ${THEME.border};background:transparent;color:${THEME.text};border-radius:5px;cursor:pointer;font-size:0.85em;line-height:1;white-space:nowrap;transition:background .12s;">A−</button>
            <button data-act="font-up" title="Larger text" style="display:inline-flex;align-items:center;justify-content:center;min-width:2.1em;height:1.8em;padding:0 .45em;border:1px solid ${THEME.border};background:transparent;color:${THEME.text};border-radius:5px;cursor:pointer;font-size:0.85em;line-height:1;white-space:nowrap;transition:background .12s;">A+</button>
          </div>
        </div>
      </div>
      <div id="cst-body" style="display:flex;flex-direction:column;flex:1 1 auto;min-height:0;
           overflow:auto;padding:12px 14px 13px;">
        <div id="cst-dice-head" data-fold="diceCollapsed" style="${secHead}flex:0 0 auto;margin-bottom:7px;">
          <strong style="color:${THEME.accent};"><span class="cst-chev">${uiState.diceCollapsed ? '▸' : '▾'}</span> Dice Rolls</strong>
          <span id="cst-dice-rolls" style="color:${THEME.textDim};font-size:0.82em;"></span>
        </div>
        <div id="cst-dice-wrap" style="flex:1 0 auto;min-height:0;display:flex;flex-direction:column;overflow:hidden;transition:max-height .28s ease;"><div id="cst-dice" style="flex:1 1 auto;display:flex;flex-direction:column;"></div></div>
        <div id="cst-res-head" data-fold="resCollapsed" style="${secHead}flex:0 0 auto;margin-top:14px;">
          <strong style="color:${THEME.accent};"><span class="cst-chev">${uiState.resCollapsed ? '▸' : '▾'}</span> Resources</strong>
        </div>
        <div id="cst-res-wrap" style="flex:1 0 auto;min-height:0;display:flex;flex-direction:column;overflow:hidden;transition:max-height .28s ease;"><div id="cst-resources" style="flex:1 1 auto;display:flex;flex-direction:column;"></div></div>
      </div>`;
    document.body.appendChild(host);
    panel = host;

    // Inject the :hover rule once (inline styles can't express :hover).
    if (!document.getElementById('cst-style')) {
      const st = document.createElement('style');
      st.id = 'cst-style';
      st.textContent = '#colonist-stats-tracker #cst-glyph:hover{filter:drop-shadow(0 2px 4px rgba(0,0,0,.5));}' +
        '#colonist-stats-tracker #cst-controls button:hover{background:rgba(0,0,0,.10)!important;border-color:' + THEME.accent + '!important;}' +
        '#colonist-stats-tracker #cst-menu button:hover{background:rgba(0,0,0,.08)!important;}' +
        '#colonist-stats-tracker .cst-active-cell{font-weight:700;}';
      (document.head || document.documentElement).appendChild(st);
    }

    // A zero-size SVG holding the shared gradient used by the physical dice faces
    // (dieFaceSVG). Defined once so every die can reference url(#cstDieGrad).
    if (!document.getElementById('cst-die-defs')) {
      const sv = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      sv.id = 'cst-die-defs';
      sv.setAttribute('width', '0');
      sv.setAttribute('height', '0');
      sv.style.position = 'absolute';
      sv.innerHTML = '<defs><linearGradient id="cstDieGrad" x1="0" y1="0" x2="0" y2="1">' +
        '<stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#e7dfc9"/>' +
        '</linearGradient></defs>';
      (document.body || document.documentElement).appendChild(sv);
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
      let rT, lastW = 0, lastFaces = null;
      new ResizeObserver(() => {
        if (uiState.panelCollapsed) return;
        const w = host.offsetWidth;
        if (w === lastW) return;
        lastW = w;
        host.style.fontSize = fpx(w);
        // In auto-mode, crossing the width threshold flips digits ⇄ dice live.
        const nowFaces = diceFacesActive();
        if (nowFaces !== lastFaces) { lastFaces = nowFaces; render(); }
        clearTimeout(rT);
        rT = setTimeout(() => updateActivePreset({ width: w }), 250);
      }).observe(host);
    }

    host.querySelector('#cst-resync').addEventListener('click', () => {
      deepRescrape();   // async; guards against concurrent runs internally
    });

    // Large / small layout toggle.
    host.querySelector('#cst-size').addEventListener('click', toggleSize);

    // Presets menu (⋮): save the current geometry as the large/small preset, or reset.
    const prefsBtn = host.querySelector('#cst-prefs');
    const menu = host.querySelector('#cst-menu');
    const closeMenu = () => { menu.style.display = 'none'; };
    prefsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
    });
    menu.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-act]');
      if (!b) return;
      const act = b.getAttribute('data-act');
      if (act === 'font-down') { changeFont(-1); return; }   // keep the menu open to step
      if (act === 'font-up') { changeFont(1); return; }
      if (act === 'save-large') saveCurrentAs('large');
      else if (act === 'save-small') saveCurrentAs('small');
      else if (act === 'reset') resetPresets();
      closeMenu();
    });
    document.addEventListener('click', (e) => {
      if (menu.style.display !== 'none' && !menu.contains(e.target) && !prefsBtn.contains(e.target)) closeMenu();
    });

    // Hover a resource COLUMN → highlight it with an overlay tinted in THAT
    // resource's own colour (soft fill + bright neon side bars + a fluorescent
    // glow), and bold its numbers (extra-bold where a player holds it). Detection
    // is by pointer-x against the header cells, so the WHOLE column strip is hot —
    // gaps between cells and rows included. The overlay lives in the stable
    // #cst-res-wrap so it survives render()'s innerHTML swaps.
    const RES_HL = {
      lumber: '66,170,45', brick: '203,90,68', wool: '146,196,74',
      grain: '238,194,60', ore: '143,179,166', unknown: '47,111,159',
    };
    const wrap = host.querySelector('#cst-res-wrap');
    wrap.style.position = 'relative';
    const resEl = host.querySelector('#cst-resources');
    resEl.style.position = 'relative';
    resEl.style.zIndex = '1';
    // The overlay sits ON TOP of the rows (z-index 2) with pointer-events:none, so
    // row separators and the active-row tint can't slice the neon bars. It's built
    // from three layers: a soft fill + two side bars, each a vertical gradient that
    // fades to transparent at the very top & bottom — no hard edge cutting the
    // colour block, and the bars read as one continuous (if soft-ended) line.
    const colHL = document.createElement('div');
    colHL.style.cssText = 'position:absolute;top:0;display:none;pointer-events:none;z-index:2;';
    const colFill = document.createElement('div');
    colFill.style.cssText = 'position:absolute;inset:0;';
    const colBarL = document.createElement('div');
    colBarL.style.cssText = 'position:absolute;left:0;top:0;bottom:0;width:2.5px;';
    const colBarR = document.createElement('div');
    colBarR.style.cssText = 'position:absolute;right:0;top:0;bottom:0;width:2.5px;';
    colHL.append(colFill, colBarL, colBarR);
    wrap.appendChild(colHL);
    const clearColHL = () => {
      colHL.style.display = 'none';
      resEl.querySelectorAll('[data-res]').forEach((el) => { el.style.fontWeight = ''; });
    };
    // Which resource column is under this x? Boundaries are the midpoints between
    // neighbouring header cells, so there are no dead gaps; x left of the first
    // resource column = the player-name column = no highlight.
    const columnAt = (clientX) => {
      const headRow = resEl.firstElementChild;
      if (!headRow) return null;
      const cells = [...headRow.querySelectorAll('[data-res]')];
      for (let i = 0; i < cells.length; i++) {
        const r = cells[i].getBoundingClientRect();
        const lb = i === 0 ? r.left - 4 : (cells[i - 1].getBoundingClientRect().right + r.left) / 2;
        const rb = i === cells.length - 1 ? r.right + 4 : (r.right + cells[i + 1].getBoundingClientRect().left) / 2;
        if (clientX >= lb && clientX <= rb) return { res: cells[i].getAttribute('data-res'), rect: r };
      }
      return null;
    };
    wrap.addEventListener('mousemove', (e) => {
      const hit = columnAt(e.clientX);
      if (!hit) { clearColHL(); return; }
      const rgb = RES_HL[hit.res] || '47,111,159';
      const wr = wrap.getBoundingClientRect();
      colHL.style.left = (hit.rect.left - wr.left) + 'px';
      colHL.style.width = hit.rect.width + 'px';
      colHL.style.height = resEl.offsetHeight + 'px';
      // Soft fill, fading to transparent at the very top & bottom (no abrupt cut).
      colFill.style.background =
        `linear-gradient(to bottom, rgba(${rgb},0) 0%, rgba(${rgb},.24) 13%, rgba(${rgb},.14) 87%, rgba(${rgb},0) 100%)`;
      // Neon side bars: bright through the middle, fading at the ends to match.
      const barGrad =
        `linear-gradient(to bottom, rgba(${rgb},0) 0%, rgb(${rgb}) 14%, rgb(${rgb}) 86%, rgba(${rgb},0) 100%)`;
      colBarL.style.background = barGrad;
      colBarR.style.background = barGrad;
      colHL.style.boxShadow = `0 0 12px 1px rgba(${rgb},.5)`;   // outer fluorescent bloom
      colHL.style.display = 'block';
      resEl.querySelectorAll('[data-res]').forEach((el) => {
        if (el.getAttribute('data-res') !== hit.res || el.querySelector('img')) { el.style.fontWeight = ''; return; }
        const v = parseInt(el.textContent, 10);
        el.style.fontWeight = (Number.isFinite(v) && v > 0) ? '800' : '700';
      });
    });
    wrap.addEventListener('mouseleave', clearColHL);

    // Custom dialog tooltip for the dice columns (replaces the native title). Lives on
    // <body> so the panel's translateZ layer doesn't trap its fixed positioning.
    const diceEl = host.querySelector('#cst-dice');
    let tip = document.getElementById('cst-tip');
    if (!tip) {
      tip = document.createElement('div');
      tip.id = 'cst-tip';
      // White "data" dialog (like a stock-chart tooltip) — dark text on light.
      tip.style.cssText = 'position:fixed;display:none;z-index:2147483647;pointer-events:none;' +
        `background:#ffffff;color:${THEME.text};padding:7px 11px;border-radius:8px;font-size:12px;line-height:1.5;` +
        `border:1px solid ${THEME.border};box-shadow:0 6px 18px rgba(40,30,10,.28);max-width:240px;text-align:left;` +
        'transform:translate(14px,16px);font-family:-apple-system,"Segoe UI",sans-serif;';
      document.body.appendChild(tip);
    }
    // Follow the cursor (mousemove, not a one-shot mouseover): wherever the mouse
    // is, the dialog trails just below-right — flipping to the left near the screen
    // edge so it never runs off-screen.
    // Only the count + bar zone (data-dietip) shows the dialog — NOT the % or the
    // value below it (that area is for the digit/dice toggle, not stats).
    diceEl.addEventListener('mousemove', (e) => {
      const zone = e.target.closest('[data-dietip]');
      if (!zone) { tip.style.display = 'none'; return; }
      tip.innerHTML = diceTipHTML(+zone.getAttribute('data-dietip'));
      // Trail below-right of the cursor, but flip horizontally near the right edge
      // and vertically near the bottom edge so it never runs off-screen.
      const tx = e.clientX > window.innerWidth - 260 ? 'calc(-100% - 14px)' : '14px';
      const ty = e.clientY > window.innerHeight - 90 ? 'calc(-100% - 14px)' : '16px';
      tip.style.transform = `translate(${tx},${ty})`;
      tip.style.left = e.clientX + 'px';
      tip.style.top = e.clientY + 'px';
      tip.style.display = 'block';
    });
    diceEl.addEventListener('mouseleave', () => { tip.style.display = 'none'; });

    // Click the bottom value → flip digits ⇄ dice (a sticky manual override of the
    // auto-by-width default), with a springy fade swap. Only the value spans are
    // touched (no full re-render) so the bars/spacing never jump.
    diceEl.addEventListener('click', (e) => {
      const t = e.target.closest('[data-dietoggle]');
      if (!t) return;
      uiState.diceMode = diceFacesActive() ? 'digits' : 'faces';
      saveUI({ diceMode: uiState.diceMode });
      animateDiceSwap();
    });

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
      // Dragging updates the active preset, so your position sticks to large/small.
      updateActivePreset({ left: parseInt(el.style.left, 10), top: parseInt(el.style.top, 10) });
    });
  }

  // "Rolls since the last N" — the drought for a given sum (0 if N was just rolled,
  // or the whole history length if N has never come up).
  function rollsSince(n) {
    const h = state.rollHistory;
    for (let i = h.length - 1, k = 0; i >= 0; i--, k++) if (h[i] === n) return k;
    return h.length;
  }

  // The "natural" two-dice pairing for each sum, used by the dice-faces view.
  const DICE_PAIR = {
    2: [1, 1], 3: [1, 2], 4: [2, 2], 5: [2, 3], 6: [3, 3], 7: [3, 4],
    8: [4, 4], 9: [4, 5], 10: [5, 5], 11: [5, 6], 12: [6, 6],
  };
  // A single die face drawn as a small rounded-square SVG with real pips — richer
  // and more "physical" than a flat glyph, echoing the brand dice icon and the
  // resource cards. Uses the shared #cstDieGrad gradient (injected once) for the
  // light face sheen, a warm stroke, and a soft drop shadow.
  const DIE_PIPS = {
    1: [[1, 1]],
    2: [[0, 0], [2, 2]],
    3: [[0, 0], [1, 1], [2, 2]],
    4: [[0, 0], [2, 0], [0, 2], [2, 2]],
    5: [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]],
    6: [[0, 0], [2, 0], [0, 1], [2, 1], [0, 2], [2, 2]],
  };
  function dieFaceSVG(v, em) {
    const pos = [6, 11, 16]; // pip centres on the 22-unit face (3×3 grid)
    // Asian-style dice: the 1 and 4 pips are red — gives adjacent faces a strong,
    // glanceable colour difference (and the lone 1-pip is enlarged like real dice).
    const red = (v === 1 || v === 4);
    const fill = red ? '#cf2f2f' : '#33301f';
    const r = v === 1 ? 2.7 : 2.1;
    const pips = (DIE_PIPS[v] || []).map(
      ([gx, gy]) => `<circle cx="${pos[gx]}" cy="${pos[gy]}" r="${r}" fill="${fill}"/>`
    ).join('');
    return `<svg viewBox="0 0 22 22" width="${em}em" height="${em}em" aria-hidden="true" ` +
      `style="display:block;filter:drop-shadow(0 1px 1.5px rgba(40,30,10,.3));">` +
      `<rect x="1.5" y="1.5" width="19" height="19" rx="4.5" fill="url(#cstDieGrad)" ` +
      `stroke="#c9b079" stroke-width="1"/>${pips}</svg>`;
  }
  // The bottom-row value: a small, de-emphasised digit (the COUNT above is the
  // headline), or — when `faces` is on — the two physical dice that sum to it
  // (sized to sit comfortably inside a narrow column).
  function dieValueHTML(n, faces) {
    if (!faces) {
      return `<span style="font-size:0.82em;font-weight:600;font-variant-numeric:tabular-nums;color:${n === 7 ? THEME.bad : THEME.textDim};">${n}</span>`;
    }
    const [a, b] = DICE_PAIR[n];
    return `<span style="display:inline-flex;gap:0.16em;align-items:center;justify-content:center;">${dieFaceSVG(a, 0.84)}${dieFaceSVG(b, 0.84)}</span>`;
  }
  // Flip the bottom value (digit ⇄ dice) in place with a springy fade — updating
  // ONLY the value spans (not a full render) so the bars/spacing never reflow.
  function animateDiceSwap() {
    if (!panel) return;
    const faces = diceFacesActive();
    panel.querySelectorAll('#cst-dice [data-dietoggle]').forEach((sp) => {
      const n = +sp.getAttribute('data-dietoggle');
      sp.style.transition = 'opacity .12s ease, transform .12s ease';
      sp.style.opacity = '0';
      sp.style.transform = 'scale(.55)';                       // fade + shrink out
      setTimeout(() => {
        // A render() (a roll / resize) during the swap window replaces #cst-dice,
        // orphaning this span — skip it; the fresh render already shows the right
        // mode (diceMode was set before the animation started).
        if (!sp.isConnected) return;
        sp.innerHTML = dieValueHTML(n, faces);
        sp.style.transition = 'opacity .18s ease, transform .28s cubic-bezier(.34,1.7,.5,1)';
        sp.style.opacity = '1';
        sp.style.transform = 'scale(1)';                       // springy pop in
      }, 130);
    });
  }
  // Content for the dialog over a dice column's count/bar. Deliberately omits the
  // sum, its tally and current % — those are already on screen (count above the
  // bar, % below it). It surfaces only what ISN'T visible: the drought (rolls
  // since this sum last came up) and the fair-dice expected %.
  function diceTipHTML(n) {
    if (!state.totalRolls) return `Expected <b>${EXPECTED_PCT[n]}%</b>`;
    return `<span style="color:#b5730a;font-weight:700;">${rollsSince(n)} rolls</span> since last <b>${n}</b>` +
      `<br><span style="color:${THEME.textDim};">Expected ${EXPECTED_PCT[n]}%</span>`;
  }

  // The last ~12 rolls as a left→right strip (newest on the right, with an
  // accent ring; 7s flagged in red) so you can read the RUN of rolls during a
  // turn/trade — not just the frequency histogram. Hidden until the first roll.
  const ROLL_STRIP_N = 12;
  function renderRollStrip() {
    const recent = state.rollHistory.slice(-ROLL_STRIP_N);
    if (!recent.length) return '';
    const chips = recent.map((n, i) => {
      const newest = i === recent.length - 1;
      const seven = n === 7;
      return `<span style="display:inline-flex;align-items:center;justify-content:center;` +
        `min-width:1.55em;height:1.55em;padding:0 0.2em;border-radius:0.35em;` +
        `font-size:0.78em;font-weight:700;font-variant-numeric:tabular-nums;` +
        `background:${seven ? THEME.bad : '#fbf9f4'};color:${seven ? '#fff' : THEME.text};` +
        `border:1px solid ${seven ? THEME.bad : THEME.border};` +
        `${newest ? `box-shadow:0 0 0 2px ${THEME.accent}55;` : 'opacity:.9;'}">${n}</span>`;
    }).join('');
    return `<div title="Last ${recent.length} rolls (oldest → newest)" ` +
      `style="display:flex;gap:0.25em;align-items:center;justify-content:flex-end;` +
      `overflow:hidden;margin:0 0 0.6em;flex:0 0 auto;">` +
      `<span style="color:${THEME.textDim};font-size:0.7em;margin-right:auto;white-space:nowrap;">Roll order</span>${chips}</div>`;
  }

  // Dice histogram bars (the section header lives in the static skeleton).
  // Top→bottom per column: the roll count, the bar, the %, then the sum (2–12,
  // shown as a digit or — toggled by clicking it — the two dice faces). Hovering a
  // column shows its tally + how many rolls since that sum last came up.
  function renderDiceBars() {
    let maxCount = 0;
    for (let n = 2; n <= 12; n++) maxCount = Math.max(maxCount, state.diceCounts[n]);
    const faces = diceFacesActive();
    const cols = [];
    for (let n = 2; n <= 12; n++) {
      const c = state.diceCounts[n];
      const pct = state.totalRolls ? (c / state.totalRolls * 100) : 0;
      const expected = EXPECTED_PCT[n];
      const barH = maxCount ? Math.round((c / maxCount) * 100) : 0;
      const delta = pct - expected;
      const barColor = Math.abs(delta) < 2 ? THEME.bar : (delta > 0 ? THEME.good : THEME.bad);
      // The column is a flex stack with justify:space-evenly, so as the panel is
      // dragged taller the extra height flows into the gaps (bar ↔ % ↔ value),
      // i.e. the whole column "breathes" rather than parking blank space below.
      cols.push(`
        <div data-die="${n}"
             style="flex:1 1 0;display:flex;flex-direction:column;align-items:center;justify-content:space-evenly;gap:0.6em;min-width:0;">
          <div data-dietip="${n}" style="display:flex;flex-direction:column;align-items:center;gap:0.6em;width:100%;flex:0 0 auto;cursor:default;">
            <span style="font-size:0.96em;font-weight:700;font-variant-numeric:tabular-nums;color:${THEME.text};">${c}</span>
            <div style="width:100%;height:3.9em;display:flex;align-items:flex-end;justify-content:center;">
              <div style="width:74%;height:${barH}%;min-height:2px;background:${barColor};border-radius:3px 3px 0 0;transition:height .2s;"></div>
            </div>
          </div>
          <span style="font-size:0.7em;font-weight:600;font-variant-numeric:tabular-nums;color:${barColor};flex:0 0 auto;">${Math.round(pct)}%</span>
          <span data-dietoggle="${n}" title="Click to switch digits / dice"
                style="display:inline-flex;align-items:center;justify-content:center;height:1.7em;line-height:1;flex:0 0 auto;cursor:pointer;transform-origin:center;">${dieValueHTML(n, faces)}</span>
        </div>`);
    }
    return renderRollStrip() +
      `<div style="display:flex;align-items:stretch;gap:3px;flex:1 1 auto;">${cols.join('')}</div>`;
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
    // Wide player column (avatar + name + hand total) and slim single-digit
    // resource columns so names have room.
    const cols = `minmax(120px,2.6fr) repeat(${RESOURCES.length}, 0.8fr) 0.8fr`;

    const iconCell = (r) => {
      const low = bank[r] <= 2;
      return `<span data-res="${r}" style="text-align:center;border-radius:5px;padding:2px 0;">
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
      <div style="display:grid;grid-template-columns:${cols};gap:4px;align-items:end;padding:0.9em 3px 0.7em 11px;flex:0 0 auto;">
        <span style="color:${THEME.textDim};font-size:0.8em;">Player</span>
        ${RESOURCES.map(iconCell).join('')}
        <span data-res="unknown" style="text-align:center;border-radius:5px;padding:2px 0;" title="Unknown (stolen) cards">${iconImg('unknown', 1.55)}</span>
      </div>`;

    if (state.players.size === 0) {
      return head + `<div style="color:${THEME.textDim};padding:5px 3px;flex:0 0 auto;">Waiting for first move…</div>`;
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
      const active = p.name === state.currentTurn;
      const actCls = active ? 'cst-active-cell' : '';
      rows.push(`
        <div data-prow="${escapeHtml(p.name)}" style="display:grid;grid-template-columns:${cols};gap:4px;align-items:center;flex:1 1 auto;
             padding:5px 3px 5px 11px;border-top:1px solid ${THEME.rowLine};${active ? `background:rgba(47,111,159,.12);box-shadow:inset 3px 0 0 ${THEME.accent};` : ''}">
          <span style="display:flex;align-items:center;gap:4px;min-width:0;color:${escapeAttr(p.color)};font-weight:700;" title="${escapeHtml(p.name)}${active ? ' — current turn' : ''}">${avatar}<span style="flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(p.name)}</span><span title="Total cards in hand" style="flex:0 0 auto;font-size:0.78em;font-weight:700;font-variant-numeric:tabular-nums;color:${THEME.text};background:#fbf9f4;border:1px solid ${THEME.border};border-radius:0.6em;padding:0 0.4em;">${playerTotal(p)}</span></span>
          ${RESOURCES.map((r) =>
            `<span data-res="${r}" class="${actCls}" style="text-align:center;border-radius:5px;font-variant-numeric:tabular-nums;${p.resources[r] === 0 ? `color:${THEME.textDim};opacity:.4;` : ''}">${p.resources[r]}</span>`
          ).join('')}
          <span data-res="unknown" class="${actCls}" style="text-align:center;border-radius:5px;font-variant-numeric:tabular-nums;color:${p.unknown ? THEME.accent : THEME.textDim};${p.unknown ? '' : 'opacity:.4;'}">${p.unknown}</span>
        </div>`);
    }
    return head + rows.join('');
  }

  // ---- game-style floating "+N" / "−N" over changed resource cells ----
  // lastCounts is the per-player snapshot from the previous render; null means
  // "don't float on the next render" (set after reset/restore/deep re-scrape,
  // where diffing from scratch would shower the panel in floats).
  let lastCounts = null;
  function countsSnapshot() {
    const snap = {};
    for (const p of state.players.values()) {
      snap[p.name] = {
        lumber: p.resources.lumber, brick: p.resources.brick, wool: p.resources.wool,
        grain: p.resources.grain, ore: p.resources.ore, unknown: p.unknown,
      };
    }
    return snap;
  }

  // Floats live in the stable #cst-res-wrap layer (the same home as the column
  // highlight) so render()'s innerHTML swaps can't kill them mid-flight.
  function spawnGainFloats() {
    if (!panel || uiState.panelCollapsed || uiState.resCollapsed) { lastCounts = countsSnapshot(); return; }
    const wrap = panel.querySelector('#cst-res-wrap');
    const resEl = panel.querySelector('#cst-resources');
    if (!wrap || !resEl) return;
    const prev = lastCounts;
    lastCounts = countsSnapshot();
    if (!prev) return;
    const rows = [...resEl.querySelectorAll('[data-prow]')];
    const wr = wrap.getBoundingClientRect();
    for (const [name, cur] of Object.entries(lastCounts)) {
      const old = prev[name];
      if (!old) continue;                       // brand-new player row — no float
      const row = rows.find((el) => el.getAttribute('data-prow') === name);
      if (!row) continue;
      for (const k of [...RESOURCES, 'unknown']) {
        const d = cur[k] - old[k];
        if (!d) continue;
        const cell = row.querySelector(`[data-res="${k}"]`);
        if (!cell) continue;
        const cr = cell.getBoundingClientRect();
        const f = document.createElement('span');
        f.textContent = (d > 0 ? '+' : '−') + Math.abs(d);
        f.style.cssText = 'position:absolute;z-index:3;pointer-events:none;' +
          `left:${cr.left - wr.left + cr.width / 2}px;top:${cr.top - wr.top}px;` +
          'transform:translate(-50%,0);font-size:0.85em;font-weight:800;line-height:1;' +
          `color:${d > 0 ? THEME.good : THEME.bad};text-shadow:0 1px 2px rgba(255,255,255,.85);` +
          'opacity:1;transition:transform .7s ease-out, opacity .7s ease-out;';
        wrap.appendChild(f);
        void f.offsetHeight;                    // start the drift-up + fade
        f.style.transform = 'translate(-50%,-1.15em)';
        f.style.opacity = '0';
        setTimeout(() => f.remove(), 750);
      }
    }
  }

  function render() {
    if (!panel) return;
    const d = panel.querySelector('#cst-dice');
    if (d) d.innerHTML = renderDiceBars();
    const r = panel.querySelector('#cst-resources');
    if (r) r.innerHTML = renderResTable();
    spawnGainFloats();
    const rolls = panel.querySelector('#cst-dice-rolls');
    if (rolls) rolls.textContent = `${state.totalRolls} rolls`;
    updateTimer();
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
    restoreState();   // bring back the in-progress game (page reload / reconnect)
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

    // Once a second:
    //  1. drop stale data if the page is now a different game (maybeNewGame);
    //  2. re-scan mounted rows — colonist's log is a *recycling* virtual list, so
    //     some new messages replace a row's content instead of adding a node and
    //     the MutationObserver misses them (processItem de-dups by data-index);
    //  3. reconcile each player's total against colonist's authoritative panel.
    setInterval(() => {
      if (state.paused) return;
      evalLifecycle();
      maybeNewGame();
      updateTimer();
      if (observedContainer) scanExisting(observedContainer);
      if (syncFromPanel()) renderSoon();
    }, 1000);

    // Let the toolbar popup drive a hard reset of the current game.
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
      chrome.runtime.onMessage.addListener((msg, sender, reply) => {
        if (!msg) return;
        if (msg.cmd === 'cst-ping') { reply({ ok: true }); return; }
        if (msg.cmd === 'cst-new-game') { newGameReset(); reply({ ok: true }); return; }
      });
    }
  }

  // New-game detection state: the live-roster signature of the game we're tracking,
  // and the previous tick's live roster (so a roster change must settle before we act).
  let gameSig = '';
  let lastLiveSig = '';

  // Reset all tracked stats. Shared by new-game detection, the panel, and tests.
  function resetState() {
    for (const k of Object.keys(state.diceCounts)) state.diceCounts[k] = 0;
    state.totalRolls = 0;
    state.players.clear();
    state.seenIndices = new Set();
    state.selfName = null;
    state.paused = false;
    state.rollHistory = [];
    state.currentTurn = null;
    state.gameStartTs = Date.now(); // a reset = a new game begins now
    state.gameEndTs = null;
    gameSig = '';
    lastLiveSig = '';
    lastCounts = null;  // don't shower "+N" floats diffing against the old game
  }

  // ---- persistence of the live game (survives page reloads / reconnects) ----
  const STATE_KEY = 'colonist-stats-tracker:game';
  let justRestored = false; // skip the first attach's seenIndices reset after a restore
  let persistTimer = null;

  function persistState() {
    try {
      localStorage.setItem(STATE_KEY, JSON.stringify({
        sig: [...state.players.keys()].sort().join('|'),
        diceCounts: state.diceCounts,
        totalRolls: state.totalRolls,
        rollHistory: state.rollHistory,
        currentTurn: state.currentTurn,
        gameStartTs: state.gameStartTs,
        gameEndTs: state.gameEndTs,
        selfName: state.selfName,
        seenIndices: [...state.seenIndices],
        players: [...state.players.values()].map((p) => ({
          name: p.name, color: p.color, unknown: p.unknown, resources: p.resources,
        })),
      }));
    } catch (e) { /* storage unavailable — non-fatal */ }
  }

  function schedulePersist() {
    if (persistTimer) return;
    persistTimer = setTimeout(() => { persistTimer = null; persistState(); }, 600);
  }

  function restoreState() {
    let d;
    try { d = JSON.parse(localStorage.getItem(STATE_KEY)); } catch (e) { return; }
    if (!d || !Array.isArray(d.players)) return;
    state.totalRolls = d.totalRolls || 0;
    for (let n = 2; n <= 12; n++) state.diceCounts[n] = (d.diceCounts && d.diceCounts[n]) || 0;
    state.rollHistory = Array.isArray(d.rollHistory) ? d.rollHistory : [];
    state.currentTurn = d.currentTurn || null;
    state.gameStartTs = Number.isFinite(d.gameStartTs) ? d.gameStartTs : null;
    state.gameEndTs = Number.isFinite(d.gameEndTs) ? d.gameEndTs : null;
    state.selfName = d.selfName || null;
    state.seenIndices = new Set(d.seenIndices || []);
    state.players = new Map();
    for (const p of d.players) {
      const res = p.resources || {};
      state.players.set(p.name, {
        name: p.name,
        color: p.color || '#888',
        unknown: p.unknown || 0,
        resources: {
          lumber: res.lumber || 0, brick: res.brick || 0, wool: res.wool || 0,
          grain: res.grain || 0, ore: res.ore || 0,
        },
      });
    }
    justRestored = state.players.size > 0;
    lastCounts = null;  // restored counts are not "gains" — no floats
  }

  function rosterSig(list) {
    return list.map((p) => p.name).sort().join('|');
  }

  // Drop stale data when the page is a DIFFERENT game. The local player is in
  // every game, so "no players in common" never fires — instead we reset when a
  // tracked player is no longer on colonist's live panel, or when the live roster
  // settles on a new set (a new game started in the same tab).
  function maybeNewGame() {
    const live = readPlayerPanel();
    if (!live || !live.length) return;        // panel not ready yet — re-check later
    const liveSig = rosterSig(live);

    if (!gameSig) {
      // First live roster this session. If we restored players who aren't in THIS
      // game's panel, that data belongs to a previous game — drop it.
      const liveNames = new Set(live.map((p) => p.name));
      if (state.players.size && [...state.players.keys()].some((n) => !liveNames.has(n))) {
        startNextGame();
      }
      gameSig = liveSig;
      lastLiveSig = liveSig;
      return;
    }

    // A different roster, stable for one tick, means a new game.
    if (liveSig !== gameSig && liveSig === lastLiveSig) {
      startNextGame();
      gameSig = liveSig;
    }
    lastLiveSig = liveSig;
  }

  // Manual "this is a new game": clear tracking and re-read the current game.
  function newGameReset() {
    resetState();
    lifecycle = inGameNow() ? LIFE.PLAYING : LIFE.LOBBY;
    const live = readPlayerPanel();
    gameSig = live ? rosterSig(live) : '';
    lastLiveSig = gameSig;
    if (observedContainer) scanExisting(observedContainer);
    syncFromPanel();
    persistState();
    if (panel) render();
  }

  // =============================================================
  // Game lifecycle (LOBBY / PLAYING / ENDED)
  //
  // Drives the automatic panel posture + the game clock. All automatic
  // actions fire ONCE, on a state transition edge — never re-asserted per
  // tick — so a manual expand in the lobby or a manual collapse mid-game
  // sticks until the next transition.
  // =============================================================
  const LIFE = { LOBBY: 'lobby', PLAYING: 'playing', ENDED: 'ended' };
  let lifecycle = null;     // null until the first evaluation adopts the page state
  let notInGameTicks = 0;   // SPA remounts flicker; require 2 settled ticks to leave

  function inGameNow() {
    return !!(findLogContainer() || readPlayerPanel());
  }

  // Collapse/expand only when it would change something (idempotent, panel-safe).
  function autoSetCollapsed(collapsed) {
    if (panel && uiState.panelCollapsed !== collapsed) setPanelCollapsed(collapsed);
  }

  function evalLifecycle() {
    const inGame = inGameNow();
    if (lifecycle === null) {
      // First evaluation (boot): adopt the page's state without transition
      // actions — EXCEPT the panel posture (lobby/end-screen collapsed, live
      // game expanded). A restored gameEndTs means we re-booted on a finished
      // game's end screen.
      lifecycle = inGame ? (state.gameEndTs ? LIFE.ENDED : LIFE.PLAYING) : LIFE.LOBBY;
      autoSetCollapsed(lifecycle !== LIFE.PLAYING);
      if (lifecycle === LIFE.PLAYING && !state.gameStartTs) state.gameStartTs = Date.now();
      return;
    }
    if (inGame) {
      notInGameTicks = 0;
      if (lifecycle === LIFE.LOBBY) {
        // Entered a game. Stats resets stay owned by maybeNewGame (roster-based)
        // so a mid-game refresh keeps its restored data; here we just open the
        // panel and start the clock if this game doesn't have one yet.
        lifecycle = LIFE.PLAYING;
        if (!state.gameStartTs) { state.gameStartTs = Date.now(); state.gameEndTs = null; }
        autoSetCollapsed(false);
      }
      return;
    }
    if (lifecycle === LIFE.LOBBY) return;
    notInGameTicks += 1;
    if (notInGameTicks >= 2) {        // left the game (back to lobby / home)
      lifecycle = LIFE.LOBBY;
      notInGameTicks = 0;
      autoSetCollapsed(true);
    }
  }

  // The winner line ("X won the game!") was seen: freeze the clock and get out
  // of the way so the end-of-game screen is fully clickable.
  function onGameWon() {
    if (lifecycle === LIFE.ENDED) return;   // idempotent (re-scrape re-reads it)
    lifecycle = LIFE.ENDED;
    state.gameEndTs = Date.now();
    autoSetCollapsed(true);
    schedulePersist();
    renderSoon();
  }

  // A new game is starting (next-game flow / roster change): wipe the previous
  // game's stats, restart the clock (inside resetState) and re-open the panel.
  function startNextGame() {
    resetState();
    lifecycle = LIFE.PLAYING;
    autoSetCollapsed(false);
    renderSoon();
  }

  // ---- game clock ----
  function timerText() {
    if (!state.gameStartTs) return '';
    const end = state.gameEndTs || Date.now();
    const total = Math.floor((end - state.gameStartTs) / 1000);
    if (!Number.isFinite(total) || total < 0) return '';
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  }

  function updateTimer() {
    if (!panel) return;
    const el = panel.querySelector('#cst-timer');
    if (!el) return;
    const t = timerText();
    el.textContent = t ? `⏱ ${t}` : '';
  }

  // =============================================================
  // Deep re-scrape (the 🔄 button)
  //
  // colonist's log is a virtual list — only mounted rows are readable. To
  // recover from a disconnect/refresh gap we wipe the stats (keeping the game
  // identity + clock), scroll the log to the top, and step back down so every
  // row mounts once and is processed top-to-bottom in data-index order.
  // =============================================================
  function sleep(ms) { return new Promise((res) => setTimeout(res, ms)); }

  // The element that actually scrolls the log: usually the virtualScroller
  // itself, otherwise the nearest scrollable ancestor.
  function scrollableOf(el) {
    let cur = el;
    while (cur && cur !== document.body) {
      if (cur.scrollHeight > cur.clientHeight + 4) return cur;
      cur = cur.parentElement;
    }
    return el;
  }

  let rescraping = false;
  async function deepRescrape() {
    if (rescraping) return;
    const container = findLogContainer();
    if (!container) {                 // no log (lobby): just reconcile totals
      syncFromPanel();
      render();
      return;
    }
    rescraping = true;
    try {
      // This is a re-read of the SAME game: keep its identity and clock
      // (resetState would start a fresh clock + clear the roster signature).
      const keep = {
        start: state.gameStartTs, end: state.gameEndTs,
        sig: gameSig, life: lifecycle,
      };
      resetState();
      state.gameStartTs = keep.start;
      state.gameEndTs = keep.end;
      gameSig = keep.sig;
      lastLiveSig = keep.sig;
      lifecycle = keep.life;

      const sc = scrollableOf(container);
      const prevTop = sc.scrollTop;
      sc.scrollTop = 0;
      await sleep(160);
      let guard = 0;
      while (container.isConnected && guard++ < 400) {
        scanExisting(container);
        if (sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 2) break;
        const before = sc.scrollTop;
        sc.scrollTop = before + Math.max(40, sc.clientHeight * 0.8);
        await sleep(160);
        if (sc.scrollTop === before) break;   // can't scroll further
      }
      if (container.isConnected) scanExisting(container);
      sc.scrollTop = prevTop;
    } finally {
      rescraping = false;
    }
    syncFromPanel();
    persistState();
    render();
  }

  // ---- reconcile our counts against colonist's authoritative panel totals ----
  function panelHandTotal(row) {
    const el = row.querySelector('[data-resource-card] [class*="count"]');
    const n = el ? parseInt((el.textContent || '').trim(), 10) : NaN;
    return Number.isFinite(n) ? n : null;
  }

  // Force a player's tracked card count to `target`: a shortfall becomes unknown
  // cards; an excess is removed (unknown first, then the largest known piles).
  function reconcileTotal(p, target) {
    const cur = playerTotal(p);
    if (cur === target) return false;
    if (cur < target) {
      p.unknown += target - cur;
      return true;
    }
    let excess = cur - target;
    const fromUnknown = Math.min(p.unknown, excess);
    p.unknown -= fromUnknown;
    excess -= fromUnknown;
    while (excess > 0) {
      let best = null;
      for (const r of RESOURCES) {
        if (p.resources[r] > 0 && (best === null || p.resources[r] > p.resources[best])) best = r;
      }
      if (best === null) break;
      p.resources[best] -= 1;
      excess -= 1;
    }
    return true;
  }

  // Sync every tracked player's TOTAL to colonist's player panel (authoritative).
  function syncFromPanel() {
    let changed = false;
    document.querySelectorAll('[data-player-color]').forEach((row) => {
      const nameEl = row.querySelector('[class*="username"]');
      if (!nameEl) return;
      const p = state.players.get((nameEl.textContent || '').trim());
      if (!p) return;
      const total = panelHandTotal(row);
      if (total != null && reconcileTotal(p, total)) changed = true;
    });
    return changed;
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
      reconcileTotal,
      syncFromPanel,
      maybeNewGame,
      newGameReset,
      persistState,
      restoreState,
      // Lifecycle / timer (auto collapse-expand state machine).
      LIFE,
      evalLifecycle,
      onGameWon,
      startNextGame,
      getLifecycle: () => lifecycle,
      timerText,
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
        evalLifecycle();   // URL changed — re-evaluate the lobby/game posture now
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
  }
})();
