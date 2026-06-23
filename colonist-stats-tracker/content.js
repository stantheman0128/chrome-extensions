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

  // ---- live game model from the WebSocket (board-model migration) ----
  // ws-inspector.js (main world) relays decoded id=130 frames; board.js turns the
  // full state + diffs into an exact model. Used for ⛔ today; the log keeps
  // running as the oracle. Absent under Node (board.js isn't required there).
  const wsBoard = (typeof __cstBoard !== 'undefined') ? __cstBoard.createBoard() : null;
  if (wsBoard && typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('message', (e) => {
      if (!e.data || e.data.__cstWS !== 'state') return;
      const m = e.data.msg;
      if (!m || m.id !== '130' || !m.data) return;
      const d = m.data;
      try {
        if (d.type === 4) {
          __cstBoard.applyFullState(wsBoard, d.payload);
          // a new game arrived via the WS — drop a Victory override that belongs to a
          // DIFFERENT game. Compare the override's OWN captured game id (not the board's
          // previous id, which is null on a cold boot or a legacy blob), so a restored
          // previous-game value can't linger on the new board for a beat.
          const gid = wsBoard.gameId;
          if (state.endgameBlocked && gid != null && state.endgameBlockedGid !== gid) {
            state.endgameBlocked = null;
            state.endgameBlockedGid = null;
          }
        } else if (d.type === 91 && d.payload) {
          const before = totalBlocked();
          __cstBoard.applyDiff(wsBoard, d.payload.diff);
          if (totalBlocked() > before) persistState();   // a block just landed — make it durable now (F5-proof)
        }
      } catch (err) { /* malformed frame — ignore, the log keeps us safe */ }
      // Push the just-applied state to the panel NOW, not on the next 1s tick — so an
      // opponent's freshly-broadcast production (type-47) shows on its exact resource
      // immediately, instead of lingering up to a second as a phantom "unknown".
      try {
        if (panel && wsBoard && __cstBoard.ready(wsBoard)) {   // no panel → nothing to push to (renderSoon would no-op anyway)
          let ch = syncFromWS();
          if (syncStatsFromWS()) ch = true;
          if (syncDiceFromWS()) ch = true;
          if (ch) renderSoon();
        }
      } catch (e) { /* sync is best-effort; the 1s tick retries */ }
    });
  }
  function wsColorOf(name) {
    if (!wsBoard) return null;
    for (const k of Object.keys(wsBoard.colorToName)) {
      if (wsBoard.colorToName[k] === name) return parseInt(k, 10);
    }
    return null;
  }

  // A fresh { lumber:0, brick:0, … } each call (callers mutate it in place),
  // derived from RESOURCES so the five count buckets can never drift from the
  // canonical resource list.
  function zeroResources() {
    const o = {};
    for (const r of RESOURCES) o[r] = 0;
    return o;
  }
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

  // Real dice face art (1-6), cached from the live roll log the same self-healing
  // way as RESOURCE_ICON. Empty until the first roll is seen; the dice-face view
  // falls back to the built-in SVG dice for any face not (yet) in here, so
  // preview.html / pre-first-roll / a post-redeploy 404 all degrade gracefully.
  const DICE_ICON = {};

  // i18n: panel strings follow the browser UI language via chrome.i18n
  // (_locales/en + zh_TW). The English fallbacks keep preview.html and the
  // Node tests working where chrome.i18n doesn't exist. {x} placeholders are
  // substituted here (not Chrome's $1$ scheme) so both paths behave the same.
  function t(key, fallback, subs) {
    let msg = fallback;
    try {
      if (typeof chrome !== 'undefined' && chrome.i18n) {
        const m = chrome.i18n.getMessage(key);
        if (m) msg = m;
      }
    } catch (e) { /* not an extension context */ }
    if (subs) for (const k of Object.keys(subs)) msg = msg.split('{' + k + '}').join(subs[k]);
    return msg;
  }

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
    sevenRollers: {},    // name -> how many 7s that player rolled
    discardLimitValue: 0, // colonist's Card Discard Limit, cached when Settings was open (0 = unknown)
    currentTurn: null,   // last player to roll = whose turn it (probably) is
    lastRoller: null,    // who rolled last + when, to time turns (live only)
    lastRollTs: null,
    players: new Map(), // name -> { color, resources:{}, unknown:number }
    seenIndices: new Set(), // log message data-index values already processed
    selfName: null, // local human player; messages with avatar=icon_player.svg
    paused: false,
    // Live per-player event tally (steals / discards / income / dev cards) and
    // the global robber-blocked-yield counter — colonist only shows these on
    // the end-of-game summary; we surface them live in the Stats section.
    tally: {},   // name -> per-player event tally; see tallyOf() for the full shape
    blocked: { count: 0, byKey: {} }, // byKey: "6 brick" -> times blocked (legacy/compat)
    // Differential block-loss: blockEvents freezes "round N, res R was blocked,
    // and each player got G of R that round"; blockLossOf derives the loss as
    // max(0, produces[N][R] − G) using the CURRENT produces (so backfill holds).
    blockEvents: [],
    roundGot: {},     // this round: name -> { res: cards got } (reset each roll)
    roundBlocks: [],  // this round: [{ roll, res }] blocked tiles, settled at round end
    endgameBlocked: null, // {name: cards} read from colonist's Victory table — EXACT, overrides the estimate
    endgameBlockedGid: null, // the gameSettings.id those Victory values belong to (so a new game drops them)
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
        resources: zeroResources(),
        unknown: 0,
      };
      state.players.set(name, p);
    } else if (color && !p.color) {
      p.color = color;
    }
    return p;
  }

  // colonist's "Card Discard Limit" (a rolled 7 forces players ABOVE it to
  // discard half). The exact value lives in the Settings body, which colonist
  // only mounts while Settings is OPEN — so we read it whenever it's available
  // and cache it for the rest of the game. When it's never been open, fall back
  // to the headcount rule (2-player tables use 10; everyone else 7).
  function discardLimit() {
    const labels = document.querySelectorAll('[class*="gameSettingsContainer"] [class*="label"]');
    for (const lab of labels) {
      if (/discard/i.test(lab.textContent || '')) {
        const v = lab.nextElementSibling;
        const n = v ? parseInt((v.textContent || '').trim(), 10) : NaN;
        if (Number.isFinite(n) && n >= 5 && n <= 20) { state.discardLimitValue = n; return n; }
      }
    }
    if (state.discardLimitValue) return state.discardLimitValue;   // cached from an earlier open
    return state.players.size === 2 ? 10 : 7;                       // headcount fallback (Stan's rule)
  }

  function playerTotal(p) {
    return RESOURCES.reduce((s, r) => s + p.resources[r], 0) + p.unknown;
  }

  // ---- live event tally (Stats section) ----
  function tallyOf(name) {
    if (!state.tally[name]) {
      state.tally[name] = {
        // KNIGHT/robber steals only (1 unknown card each) — Monopoly is tracked
        // separately below so the ⚔️/💔 numbers read as "times robbed".
        stole: 0, lost: 0,       // knight cards taken from others / lost to thieves
        stoleFrom: {}, lostTo: {}, // per-opponent knight breakdown (name -> cards)
        stoleRes: {}, lostRes: {}, // per-resource knight breakdown from WS 14/15
        // (exact for self always, and for the opponent in a 2p game; the DOM log
        // can't see stolen card types, so this is WS-only — left empty otherwise)
        // Monopoly, kept apart so it can be labelled "who Mono'd what".
        monoTook: {},            // resource -> cards I took via my own Monopoly
        monoLost: {},            // thiefName -> { resource -> cards } lost to theirs
        discards: 0, discardCards: 0, discardRes: {}, //棄牌:次數/張數/各資源細分
        gained: 0,               // cards gained from rolls / placements / YoP
        gainedRes: {},           // ...broken down per resource (feeds the hover pie)
        devCards: 0,             // tracked + archived, not displayed (dashboard has it)
        builds: 0,               // tracked + archived, not displayed
        turnMs: 0, turns: 0,     // total timed turn duration + count → average
        tradeGave: {}, tradeGot: {}, // executed-trade cards per opponent (flow)
        // Per-number yield learned from CLEAN rolls (no block on that number):
        // number -> { resource -> cards }. Feeds the block-loss derivation.
        produces: {},
      };
    }
    return state.tally[name];
  }

  // Knight / robber steal (rolled-7 robber move OR a Knight card — same thing):
  // one unknown card, so cards == events and the ⚔️/💔 totals read as "times".
  function recordSteal(thiefName, victimName, n) {
    if (!n) return;
    if (thiefName) {
      const t = tallyOf(thiefName);
      t.stole += n;
      if (victimName) t.stoleFrom[victimName] = (t.stoleFrom[victimName] || 0) + n;
    }
    if (victimName) {
      const v = tallyOf(victimName);
      v.lost += n;
      if (thiefName) v.lostTo[thiefName] = (v.lostTo[thiefName] || 0) + n;
    }
  }

  // Monopoly — kept OUT of the knight tallies so it can be labelled "who Mono'd
  // what". Recorded per (taker, victim, resource): the taker's monoTook and the
  // victim's monoLost[taker].
  function recordMonopoly(takerName, victimName, res, n) {
    if (!n || !res) return;
    if (takerName) {
      const t = tallyOf(takerName);
      t.monoTook[res] = (t.monoTook[res] || 0) + n;
    }
    if (victimName) {
      const v = tallyOf(victimName);
      const by = (v.monoLost[takerName] = v.monoLost[takerName] || {});
      by[res] = (by[res] || 0) + n;
    }
  }

  // ---- turn timing (Stats ⏱) ----
  // Each roll marks the start of a turn, so the gap between consecutive rolls is
  // the PREVIOUS roller's turn. Gaps over the cap (AFK / disconnect / a fresh
  // page after a reload) are dropped so they don't wreck the average. Called
  // with live timestamps only — never during a deep re-scrape, where messages
  // replay back-to-back and every "turn" would read as milliseconds.
  const TURN_CAP_MS = 180000; // 3 min — beyond this it isn't really a turn
  function recordTurn(roller, now) {
    if (state.lastRoller && state.lastRollTs != null) {
      const ms = now - state.lastRollTs;
      if (ms > 0 && ms <= TURN_CAP_MS) {
        const ty = tallyOf(state.lastRoller);
        ty.turnMs += ms;
        ty.turns += 1;
      }
    }
    state.lastRoller = roller;
    state.lastRollTs = now;
  }

  // ---- executed-trade flow (Stats 🤝) ----
  // Record cards moving between two players in a completed trade, from BOTH
  // sides, so each player's hover shows who they fed and who fed them.
  function recordTrade(actorName, otherName, gaveN, gotN) {
    if (!actorName || !otherName) return;
    const a = tallyOf(actorName), o = tallyOf(otherName);
    if (gaveN > 0) {
      a.tradeGave[otherName] = (a.tradeGave[otherName] || 0) + gaveN;
      o.tradeGot[actorName] = (o.tradeGot[actorName] || 0) + gaveN;
    }
    if (gotN > 0) {
      a.tradeGot[otherName] = (a.tradeGot[otherName] || 0) + gotN;
      o.tradeGave[actorName] = (o.tradeGave[actorName] || 0) + gotN;
    }
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

  // Remove one card from a player's LARGEST known resource pile (ties broken by
  // RESOURCES order). Returns false if they hold no known cards. Shared by
  // transferUnknown (an untyped steal) and reconcileTotal (trimming an over-count)
  // so the argmax-then-decrement lives in one place.
  function takeLargestKnown(p) {
    let best = null;
    for (const r of RESOURCES) {
      if (p.resources[r] > 0 && (best === null || p.resources[r] > p.resources[best])) best = r;
    }
    if (best === null) return false;
    p.resources[best] -= 1;
    return true;
  }

  function transferUnknown(fromP, toP) {
    if (!fromP || !toP) return;
    if (fromP.unknown > 0) {
      fromP.unknown -= 1;
    } else {
      // No unknown card to move — pull from their largest known pile instead, so
      // the stolen card becomes one of our unknowns (minimises surprise).
      takeLargestKnown(fromP);
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
    const rawSrc = img.getAttribute('src') || '';
    const txt = [img.getAttribute('alt'), img.className || '', rawSrc].join(' ');
    const m = txt.match(/dice[_-]?(\d)/i);
    if (!m) return null;
    const n = parseInt(m[1], 10);
    // Cache colonist's live dice art — but ONLY from a genuine dice image URL, so
    // an alt/class "dice" match on some other <img> can't poison the cache.
    if (n >= 1 && n <= 6 && /dice[_-]?\d/i.test(rawSrc)) DICE_ICON[n] = rawSrc;
    return n;
  }

  // The avatar <img> sits inside the feedMessage but outside messagePart.
  // Scoping image scans to messagePart keeps the avatar from leaking in.
  function getMessagePart(msgEl) {
    return msgEl.querySelector('[class*="messagePart"]') || msgEl;
  }

  function countResources(msgEl) {
    const counts = zeroResources();
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
      onGameWon(firstPlayerRef(msgEl).name);   // "Bradly won the game!" — the name is the coloured span
      return;
    }

    // --- Robber-blocked yield ---
    // Live format: "[prob_6] brick tile is blocked by the Robber. No resources
    // produced" — the tile's number is the prob_N token IMAGE, the resource is a
    // plain word. No player is named, so this is a global counter only.
    if (text.includes('blocked by the robber') || text.includes('no resources produced')) {
      let num = null;
      getMessagePart(msgEl).querySelectorAll('img').forEach((img) => {
        const blob = (img.getAttribute('src') || '') + ' ' + (img.getAttribute('alt') || '') +
          ' ' + (img.className || '');
        const m = blob.match(/prob[_-]?(\d+)/i);
        if (m) num = parseInt(m[1], 10);
      });
      if (num == null) {
        const m = text.match(/prob[_ -]?(\d+)/);   // fallback: token rendered as text
        if (m) num = parseInt(m[1], 10);
      }
      let res = null;
      getMessagePart(msgEl).querySelectorAll('img').forEach((img) => {
        const blob = (img.getAttribute('src') || '') + ' ' + (img.getAttribute('alt') || '');
        const m = blob.match(/generated_tile_(\w+)/i) || blob.match(/\b(lumber|brick|wool|grain|ore)\b/i);
        if (m && RESOURCES.includes(m[1].toLowerCase())) res = m[1].toLowerCase();
      });
      if (!res) for (const r of RESOURCES) if (text.includes(r)) { res = r; break; }
      state.blocked.count += 1;
      const key = `${num != null ? num + ' ' : ''}${res || 'tile'}`;
      state.blocked.byKey[key] = (state.blocked.byKey[key] || 0) + 1;
      // Stash for round-end settlement (differential loss = expected − got).
      if (num != null && res) state.roundBlocks.push({ roll: num, res });
      renderSoon();
      return;
    }

    const primary = firstPlayerRef(msgEl);
    const player = getPlayer(primary.name, primary.color);

    // Identify the local player. The player panel is authoritative — your row is
    // the one WITHOUT the `opponentPlayerRow` class (selfFromPanel) — so it wins
    // and locks. Only before the panel exists do we fall back to the old avatar
    // guess (first `icon_player` name), which is unreliable in multi-human games
    // (you and other humans share that avatar) and would otherwise mis-tag an
    // opponent as self, producing "stole from self / to self" steal paths.
    if (!selfLocked) {
      const sp = selfFromPanel();
      if (sp) {
        state.selfName = sp;
        selfLocked = true;
      } else if (!state.selfName && player && !text.startsWith('you ')) {
        const avatar = msgEl.querySelector('img[src*="icon_player"]');
        if (avatar) state.selfName = player.name;
      }
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
        recordSteal(thief.name, victim.name, total);
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
        settleRound();   // close the previous round before this one opens
        state.diceCounts[sum] += 1;
        state.totalRolls += 1;
        state.rollHistory.push(sum);
        // Only the last ~12 feed the roll strip and rollsSince() just needs the
        // most recent occurrence of each sum (2/12 recur ~every 36 rolls), so a
        // 256 cap is ample and keeps memory + the persisted blob bounded on very
        // long / abandoned tables.
        if (state.rollHistory.length > 256) state.rollHistory = state.rollHistory.slice(-256);
        lastRoll = sum;
        // Who rolled the 7s (drives the robber) — shown in the Cards-lost hover.
        if (sum === 7 && player) state.sevenRollers[player.name] = (state.sevenRollers[player.name] || 0) + 1;
        if (player) {
          state.currentTurn = player.name;
          // Time turns from live rolls only — a deep re-scrape replays the log
          // back-to-back, so timing it would record millisecond "turns".
          if (!rescraping) recordTurn(player.name, Date.now());
        }
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
        let gaveN = 0, gotN = 0;
        for (const r of RESOURCES) {
          if (give[r]) { takeResource(actor, r, give[r]); giveResource(other, r, give[r]); gaveN += give[r]; }
          if (recv[r]) { giveResource(actor, r, recv[r]); takeResource(other, r, recv[r]); gotN += recv[r]; }
        }
        recordTrade(actor.name, other.name, gaveN, gotN);
        renderSoon();
        return;
      }
      // Trade SHAPE claimed even when a participant isn't coloured (refs < 2):
      // never fall through to the generic " got " gain branch, which would count
      // the given-away AND received cards as a net gain (double-count).
      return;
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
        const ty = tallyOf(player.name);
        ty.gained += total;
        for (const r of RESOURCES) {
          if (counts[r]) ty.gainedRes[r] = (ty.gainedRes[r] || 0) + counts[r];
        }
        // Learn the yield map ONLY from bare-"got" roll production (not initial
        // "received starting resources", not YoP "took from bank"). Per-resource
        // assignment: a fully-blocked resource sends nothing (counts 0, skipped),
        // and a partially-blocked round sends fewer cards — overwriting with that
        // smaller count would erase the clean baseline the differential block-loss
        // needs (loss = expected − got), so keep the MAX (clean) yield seen.
        const isRollYield = lastRoll != null &&
          !text.includes('received') && !text.includes('took from bank');
        if (isRollYield) {
          ty.produces[lastRoll] = ty.produces[lastRoll] || {};
          for (const r of RESOURCES) if (counts[r]) ty.produces[lastRoll][r] = Math.max(ty.produces[lastRoll][r] || 0, counts[r]);
          // Track this player's actual yield this round, so settleRound can derive
          // "expected − got" for any tile blocked this round.
          const rg = state.roundGot[player.name] || (state.roundGot[player.name] = zeroResources());
          for (const r of RESOURCES) if (counts[r]) rg[r] += counts[r];
        }
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
      tallyOf(player.name).builds += 1;
      renderSoon();
      return;
    }

    // --- Bought dev card ---
    // Text only contains "X bought " (the "Development Card" label is in the
    // image alt, not in textContent), so don't gate on substring matches —
    // dev cards are the only "buy" action in Catan.
    if (text.includes('bought') || text.includes('購買')) {
      if (player) {
        spend(player, BUILD_COST.devcard);
        tallyOf(player.name).devCards += 1;
      }
      renderSoon();
      return;
    }

    // --- Discarded (robber) ---
    if (text.includes('discarded') || text.includes('棄了') || text.includes('棄牌')) {
      const { counts, total } = countResources(msgEl);
      if (total > 0 && player) {
        for (const r of RESOURCES) takeResource(player, r, counts[r]);
        const t = tallyOf(player.name);
        t.discards += 1;
        t.discardCards += total;
        renderSoon();
        return;
      }
    }

    // --- Stole (knight / robber moves or Monopoly) ---
    if (text.includes('stole') || text.includes('偷走') || text.includes('偷了')) {
      const refs = allPlayerRefs(msgEl);
      const { counts, total } = countResources(msgEl);

      // "Itin stole [brick] from you" — the LOCAL player is the victim, and the
      // stolen card is revealed to the victim, so a real card img is present.
      // Without this branch the message falls into the Monopoly handler below
      // (one ref + one icon) and wrongly zeroes every OTHER player's pile.
      if (text.includes('from you') && refs.length === 1) {
        const thief = getPlayer(refs[0].name, refs[0].color);
        const victim = state.selfName ? getPlayer(state.selfName) : null;
        if (total > 0) {
          for (const r of RESOURCES) {
            if (counts[r] > 0) {
              giveResource(thief, r, counts[r]);
              if (victim) takeResource(victim, r, counts[r]);
            }
          }
        } else if (thief && victim) {
          // No card img in the message (colonist usually reveals your own
          // loss, but don't bet on it) — still move one unknown card so the
          // hand totals and the steal matrix stay right.
          transferUnknown(victim, thief);
        }
        recordSteal(thief && thief.name, victim && victim.name, total || 1);
        renderSoon();
        return;
      }

      // Knight/robber steal: "X stole from Y" (two players, no visible card type)
      if (refs.length >= 2) {
        const thief  = getPlayer(refs[0].name, refs[0].color);
        const victim = getPlayer(refs[1].name, refs[1].color);
        transferUnknown(victim, thief);
        recordSteal(thief.name, victim.name, 1);
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
            const lostN = other.resources[r];
            if (lostN > 0) {
              other.resources[r] = 0;
              recordMonopoly(player.name, other.name, r, lostN);
            }
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
    const give = zeroResources();
    const recv = zeroResources();
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
    const msg = itemEl.querySelector('[class*="feedMessage"]');
    // A virtual row can mount EMPTY (data-index set) and receive its content a
    // frame later as inner nodes — which don't re-trigger the observer's
    // scrollItemContainer path. Committing the dedup now would lose that row's
    // event (a roll / got / block) forever. Only mark it seen once real text is
    // present; until then leave it unseen so the next scan re-reads it.
    if (!msg || !(msg.textContent || '').trim()) return;
    state.seenIndices.add(idx);
    processMessage(msg);
  }

  function scanExisting(container) {
    container.querySelectorAll('[class*="scrollItemContainer"]').forEach(processItem);
  }

  let observer = null;
  let observedContainer = null;
  // True when a freshly-found container is the SAME log merely re-wrapped (a karma
  // vote / colonist re-render injected UI and moved the feed into a new node): it
  // still renders at least one row we've already processed. Distinguishes that
  // from a genuine reconnect (all-new indices), so a harmless re-wrap doesn't
  // needlessly wipe dedup + trigger a (non-deterministic) rescrape.
  function logIsContinuation(container) {
    if (!container) return false;
    const items = container.querySelectorAll('[class*="scrollItemContainer"]');
    // A karma vote (etc.) injecting UI can leave the log container momentarily
    // EMPTY. That's a transient, not a new game — keep our state, don't rescrape.
    if (items.length === 0) return true;
    for (const it of items) {
      const idx = it.getAttribute('data-index');
      if (idx != null && state.seenIndices.has(idx)) return true;
    }
    return false;
  }

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
      } else if (justRestored) {
        // Refreshed mid-game: colonist may renumber data-index after a reload,
        // so the restored dedup set can't be fully trusted. Keep it for the
        // interim (avoids obvious double counts), then rebuild everything from
        // the actual log once it settles.
        scheduleAutoRescrape();
      } else if (observedContainer && lifecycle === LIFE.PLAYING) {
        // The log container NODE changed mid-game. If it's the same log merely
        // re-wrapped (a karma vote / re-render injected UI but the feed is
        // continuous — we still see a row we've processed), keep our state and
        // just re-attach. Only a genuine reconnect (all-new indices) warrants
        // wiping dedup + a full, non-deterministic rescrape.
        if (!logIsContinuation(container)) {
          state.seenIndices = new Set();
          scheduleAutoRescrape();
        }
      } else {
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
            const inner = n.querySelectorAll('[class*="scrollItemContainer"]');
            if (inner.length) { inner.forEach(processItem); return; }
            // Content filled INTO an already-mounted row (inner spans/imgs that
            // aren't themselves a row) — re-read the enclosing row so a row that
            // mounted as an empty shell isn't lost when it finally gets its text.
            const row = n.closest && n.closest('[class*="scrollItemContainer"]');
            if (row) processItem(row);
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
    return `<button id="${id}" data-tip="${title}" aria-label="${title}" style="display:inline-flex;` +
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
  const ICON_HELP = svgIcon('<circle cx="12" cy="12" r="10"/>' +
    '<path d="M9.1 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>');     // ? → how-to overlay
  // One row in the how-to overlay: an emoji marker + a bold title + a dim body.
  function helpItem(icon, title, body) {
    return `<div style="display:flex;gap:9px;margin:9px 0;">` +
      `<span style="flex:0 0 auto;font-size:15px;line-height:1.35;">${icon}</span>` +
      `<div><div style="font-weight:700;margin-bottom:1px;">${title}</div>` +
      `<div style="color:${THEME.textDim};font-size:12px;">${body}</div></div></div>`;
  }

  // The extension version (from the manifest), shown in the ⋮ menu footer so a
  // reload can be confirmed at a glance — the manifest reloads with the extension.
  function extVersion() {
    return (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest)
      ? chrome.runtime.getManifest().version : '';
  }
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
    // draggable="false": these card icons double as the column-drag handles in the
    // Resources header. A native <img> drag would hijack our pointer reorder
    // gesture (Stats columns use text emoji and were unaffected).
    return `<img src="${escapeAttr(RESOURCE_ICON[r])}" alt="${RESOURCE_LABEL[r]}" draggable="false" ` +
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
  // resView: the player table shows resource columns ('cards') or the live
  // event stats ('stats') — same players, same rows, switched via header tabs.
  const uiState = { panelCollapsed: false, diceCollapsed: false, resCollapsed: false, resView: 'cards', mode: 'large', fontScale: 1, diceMode: 'auto', resOrder: ['lumber', 'brick', 'wool', 'grain', 'ore', 'unknown'], statOrder: ['s-block', 's-lost', 's-disc', 's-gain', 's-turn', 's-stolen'], highlights: [], diceHighlights: [], resColHighlights: [], pipPlayers: [], pipMode: 'unweighted' };
  // True only while a LEFT/RIGHT edge is being dragged: that gesture changes the
  // panel WIDTH without rescaling the text (the width→font zoom is reserved for
  // the bottom-right corner). The ResizeObserver checks this to skip the zoom.
  let pureWidthResize = false;
  // colonist's current discard limit, refreshed once per render() (so nameCell
  // doesn't re-query the Settings DOM per row).
  let discardCap = 7;
  // Once selfName is fixed from the authoritative player panel we stop guessing.
  let selfLocked = false;
  // Most recent rolled sum (2..12). A bare "got" production message is attributed
  // to this number to learn the yield map. Reset on new game.
  let lastRoll = null;
  let dragging = false;   // true while a column is being dragged (suppresses tooltips/highlight)
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

  // Highlight the active Resources · Stats tab (accent + underline).
  function updateViewTabs() {
    if (!panel) return;
    panel.querySelectorAll('.cst-vtab').forEach((el) => {
      const active = el.getAttribute('data-resview') === uiState.resView;
      el.style.color = active ? THEME.accent : THEME.textDim;
      el.style.borderBottomColor = active ? THEME.accent : 'transparent';
    });
  }

  // Switch the Resources ⇄ Stats view. Both views share ONE grid (TABLE_GRID),
  // so the Player column never moves; only the six VALUE cells change. The
  // animation reflects that — it slides+fades just the value cells (every
  // [data-res] cell: the six column headers + each row's six values), leaving
  // the Player column (header text + each name cell) perfectly still.
  const valueCells = () => panel
    ? [...panel.querySelectorAll('#cst-resources [data-res]')]
    : [];
  function switchResView(v) {
    if (!panel || v === uiState.resView) return;
    const goingStats = v === 'stats';
    uiState.resView = v;
    saveUI({ resView: v });
    lastCounts = null;            // a view switch is not a "gain" — no floats
    updateViewTabs();
    const tbl = panel.querySelector('#cst-resources');
    if (!tbl) { render(); return; }
    // Fade the OLD value cells out (the Player column is left untouched).
    valueCells().forEach((c) => {
      c.style.transition = 'opacity .12s ease, transform .12s ease';
      c.style.opacity = '0';
      c.style.transform = `translateX(${goingStats ? -12 : 12}px)`;
    });
    setTimeout(() => {
      render();                   // rebuilds the table; Player column is identical
      panel.style.height = 'auto';
      const cells = valueCells();
      cells.forEach((c) => {      // place the NEW value cells off-screen, transition off
        c.style.transition = 'none';
        c.style.opacity = '0';
        c.style.transform = `translateX(${goingStats ? 12 : -12}px)`;
      });
      if (cells.length) void tbl.offsetHeight; // commit the entry position
      cells.forEach((c) => {      // ...then slide+fade them in
        c.style.transition = 'opacity .2s ease, transform .24s cubic-bezier(.2,.8,.3,1)';
        c.style.opacity = '1';
        c.style.transform = 'translateX(0)';
        setTimeout(() => { c.style.transition = ''; c.style.transform = ''; }, 250);
      });
    }, 130);
  }

  // Collapse / expand a foldable section (Dice / Resources) by its data-fold key.
  // Shared by the header click and the keyboard, so both stay in sync.
  function toggleFold(key) {
    if (!panel) return;
    const head = panel.querySelector('[data-fold="' + key + '"]');
    if (!head) return;
    uiState[key] = !uiState[key];
    saveUI({ [key]: uiState[key] });
    const open = !uiState[key];
    setSectionOpen(head.nextElementSibling, open, true);
    panel.style.height = 'auto';
    const chev = head.querySelector('.cst-chev');
    if (chev) chev.textContent = open ? '▾' : '▸';
  }

  // R / S: jump to that view; press again (already showing it) to collapse the
  // shared Resources/Stats section.
  function sectionKey(view) {
    if (uiState.resView !== view) {
      if (uiState.resCollapsed) toggleFold('resCollapsed'); // open it so the switch is visible
      switchResView(view);
    } else {
      toggleFold('resCollapsed');
    }
  }

  // Keyboard shortcuts: C = whole panel, D = Dice section, R = Resources, S =
  // Stats (R/S jump to the view, then collapse it when pressed again). All
  // ignored while typing (colonist's chat box / any input / contenteditable) or
  // with a modifier held. D/R/S need the panel open; C works either way.
  let keysBound = false;
  function bindKeys() {
    if (keysBound || typeof document === 'undefined') return;
    keysBound = true;
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.altKey || e.metaKey || !panel) return;
      const el = e.target;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (key === 'c') { setPanelCollapsed(!uiState.panelCollapsed); return; }
      if (uiState.panelCollapsed) return;   // section keys only make sense when open
      if (key === 'd') toggleFold('diceCollapsed');
      else if (key === 'r') sectionKey('cards');
      else if (key === 's') sectionKey('stats');
    });
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
    host.querySelectorAll('.cst-rz').forEach((g) => { g.style.display = collapsed ? 'none' : ''; });
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
    uiState.resOrder = RES_ORDER_DEF.slice();
    uiState.statOrder = STAT_ORDER_DEF.slice();
    saveUI({ presets: DEFAULT_PRESETS, diceCollapsed: false, resCollapsed: false, fontScale: 1, diceMode: 'auto', resOrder: RES_ORDER_DEF.slice(), statOrder: STAT_ORDER_DEF.slice() });
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

  // Repaint the pinned resource-column bands. Assigned inside createPanel (it needs
  // the panel-local overlay layer); a no-op until then. render() calls it so the
  // bands track the columns across re-renders / drag-reorders.
  let refreshPinnedCols = () => {};

  function createPanel() {
    if (panel) return;
    const ui = loadUI();
    uiState.panelCollapsed = !!ui.panelCollapsed;
    uiState.diceCollapsed = !!ui.diceCollapsed;
    uiState.resCollapsed = !!ui.resCollapsed;
    uiState.resView = ui.resView === 'stats' ? 'stats' : 'cards';
    uiState.resOrder = reconcileOrder(ui.resOrder, RES_ORDER_DEF);
    uiState.statOrder = reconcileOrder(ui.statOrder, STAT_ORDER_DEF);
    uiState.fontScale = ui.fontScale || 1;
    uiState.diceMode = ui.diceMode || 'auto';
    uiState.highlights = Array.isArray(ui.highlights) ? ui.highlights : [];
    uiState.diceHighlights = Array.isArray(ui.diceHighlights) ? ui.diceHighlights : [];
    uiState.resColHighlights = Array.isArray(ui.resColHighlights) ? ui.resColHighlights : [];
    uiState.pipMode = ui.pipMode === 'expected' ? 'expected' : 'unweighted';
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
        <strong style="font-size:1.05em;color:${THEME.accent};white-space:nowrap;display:flex;align-items:center;gap:7px;">
          <span id="cst-glyph" data-tip="${t('tipCollapse', 'Click to collapse / expand')}" style="cursor:pointer;display:inline-block;transition:transform .35s ease, font-size .25s ease, filter .15s ease;">🎲</span>
          <span id="cst-title" style="font-size:1.08em;font-weight:800;letter-spacing:.2px;color:${THEME.accent};">Colonist Stats</span>
          <span id="cst-timer" data-tip="${t('tipTimer', 'Time since this game started')}"
                style="color:${THEME.textDim};font-size:0.72em;font-weight:600;font-variant-numeric:tabular-nums;line-height:1;align-self:center;position:relative;top:.5px;"></span>
        </strong>
        <div id="cst-controls" style="display:flex;gap:4px;align-items:center;">
          ${ctrlBtn('cst-resync', ICON_SYNC, t('tipResync', 'Deep re-sync: re-read the whole game log from the top'))}
          ${ctrlBtn('cst-size', ICON_SHRINK, t('tipSizeToggle', 'Toggle large / small layout'))}
          ${ctrlBtn('cst-help', ICON_HELP, t('tipHelp', 'How to use — the click actions worth knowing'))}
          ${ctrlBtn('cst-prefs', ICON_MORE, t('tipPresets', 'Layout presets'))}
        </div>
        <div id="cst-menu" style="display:none;position:absolute;top:40px;right:10px;z-index:6;
             background:${THEME.bg};border:1px solid ${THEME.border};border-radius:8px;
             box-shadow:0 6px 18px rgba(40,30,10,.28);padding:5px;min-width:178px;">
          ${menuBtn('save-large', t('menuSaveLarge', 'Save current as Large'))}
          ${menuBtn('save-small', t('menuSaveSmall', 'Save current as Small'))}
          ${menuBtn('reset', t('menuReset', 'Reset to defaults'))}
          <div style="display:flex;align-items:center;gap:6px;padding:6px 8px 3px;margin-top:3px;border-top:1px solid ${THEME.border};">
            <span style="flex:1 1 auto;font-size:0.82em;color:${THEME.textDim};">${t('textSize', 'Text size')}</span>
            <button data-act="font-down" data-tip="${t('tipSmallerText', 'Smaller text')}" style="display:inline-flex;align-items:center;justify-content:center;min-width:2.1em;height:1.8em;padding:0 .45em;border:1px solid ${THEME.border};background:transparent;color:${THEME.text};border-radius:5px;cursor:pointer;font-size:0.85em;line-height:1;white-space:nowrap;transition:background .12s;">A−</button>
            <button data-act="font-up" data-tip="${t('tipLargerText', 'Larger text')}" style="display:inline-flex;align-items:center;justify-content:center;min-width:2.1em;height:1.8em;padding:0 .45em;border:1px solid ${THEME.border};background:transparent;color:${THEME.text};border-radius:5px;cursor:pointer;font-size:0.85em;line-height:1;white-space:nowrap;transition:background .12s;">A+</button>
          </div>
          <div style="padding:6px 8px 2px;margin-top:3px;border-top:1px solid ${THEME.border};font-size:0.72em;color:${THEME.textDim};text-align:right;" data-tip="${t('tipVersion', 'Extension version — confirm this updated after reloading the extension')}">v${extVersion()}</div>
        </div>
      </div>
      <div id="cst-help-overlay" style="display:none;position:fixed;inset:0;z-index:2147483646;background:rgba(20,14,4,.45);align-items:center;justify-content:center;">
        <div style="background:${THEME.bg};color:${THEME.text};max-width:340px;width:86vw;max-height:80vh;overflow:auto;border:1px solid ${THEME.border};border-radius:12px;box-shadow:0 12px 40px rgba(30,20,5,.5);padding:16px 18px;">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
            <strong style="font-size:15px;color:${THEME.accent};">${t('helpTitle', 'How to use')}</strong>
            <button id="cst-help-close" aria-label="${t('close', 'Close')}" style="background:transparent;border:0;color:${THEME.textDim};font-size:18px;line-height:1;cursor:pointer;padding:0 2px;">✕</button>
          </div>
          <p style="margin:.1em 0 .6em;color:${THEME.textDim};font-size:12px;line-height:1.5;">${t('helpIntro', 'Most things explain themselves on hover. These are the click actions worth knowing:')}</p>
          ${helpItem('🖱️', t('help1Title', 'Highlight a number'), t('help1Body', 'Click any value cell, or a dice column, to pin a soft highlight you can follow through the game. Click it again to clear.'))}
          ${helpItem('👤', t('help2Title', 'A player’s setup pips'), t('help2Body', 'Click a player’s name to show their ⚅ pips (board strength) with a per-resource breakdown. Click the ⚅ number to switch coverage ⇄ expected cards per roll. Click the name again to hide.'))}
          ${helpItem('📊', t('help3Title', 'Opponents’ holding of a resource'), t('help3Body', 'Click a resource icon header to highlight that column down every opponent and show their total of it — what a Monopoly would take. Click again to unpin.'))}
          ${helpItem('🔀', t('help4Title', 'Switch & collapse'), t('help4Body', 'Click “Resources / Stats” to switch tables. Click a section header (or press R / S / D) to fold it, and the 🎲 in the corner (or press C) to collapse the whole panel.'))}
          ${helpItem('🔄', t('help5Title', 'Reload'), t('help5Body', 'Re-syncs the panel from the live game. Back at the lobby with a finished game still shown, it clears it instead. A small tag confirms it ran.'))}
          <div style="margin-top:12px;text-align:right;color:${THEME.textDim};font-size:11px;">v${extVersion()}</div>
        </div>
      </div>
      <div id="cst-body" style="display:flex;flex-direction:column;flex:1 1 auto;min-height:0;
           overflow:auto;padding:12px 14px 13px;">
        <div id="cst-dice-head" data-fold="diceCollapsed" style="${secHead}flex:0 0 auto;margin-bottom:7px;">
          <strong data-tip="${t('tipDiceFold', 'Click (or press D) to collapse / expand')}" style="color:${THEME.accent};"><span class="cst-chev">${uiState.diceCollapsed ? '▸' : '▾'}</span> ${t('diceRolls', 'Dice Rolls')}</strong>
          <span id="cst-dice-rolls" style="color:${THEME.textDim};font-size:0.82em;"></span>
        </div>
        <div id="cst-dice-wrap" style="flex:1 0 auto;min-height:0;display:flex;flex-direction:column;overflow:hidden;transition:max-height .28s ease;"><div id="cst-dice" style="flex:1 1 auto;display:flex;flex-direction:column;"></div></div>
        <div id="cst-res-head" data-fold="resCollapsed" style="${secHead}flex:0 0 auto;margin-top:14px;">
          <strong style="color:${THEME.accent};display:flex;align-items:baseline;gap:6px;">
            <span class="cst-chev">${uiState.resCollapsed ? '▸' : '▾'}</span>
            <span class="cst-vtab" data-resview="cards" data-tip="${t('tipResTab', 'Resources (press R · again to collapse)')}">${t('resourcesTab', 'Resources')}</span>
            <span style="color:${THEME.textDim};font-weight:400;">·</span>
            <span class="cst-vtab" data-resview="stats" data-tip="${t('tipStatsTab', 'Stats (press S · again to collapse)')}">${t('statsTab', 'Stats')}</span>
          </strong>
        </div>
        <div id="cst-res-wrap" style="flex:1 0 auto;min-height:0;display:flex;flex-direction:column;overflow:hidden;transition:max-height .28s ease;"><div id="cst-resources" style="flex:1 1 auto;display:flex;flex-direction:column;"></div></div>
      </div>`;
    document.body.appendChild(host);
    panel = host;
    bindKeys();

    // Inject the :hover rule once (inline styles can't express :hover).
    if (!document.getElementById('cst-style')) {
      const st = document.createElement('style');
      st.id = 'cst-style';
      st.textContent = '#colonist-stats-tracker #cst-glyph:hover{filter:drop-shadow(0 2px 4px rgba(0,0,0,.5));}' +
        '#colonist-stats-tracker #cst-controls button:hover{background:rgba(0,0,0,.10)!important;border-color:' + THEME.accent + '!important;}' +
        '#colonist-stats-tracker #cst-menu button:hover{background:rgba(0,0,0,.08)!important;}' +
        '#colonist-stats-tracker .cst-active-cell{font-weight:700;}' +
        '#colonist-stats-tracker .cst-vtab{cursor:pointer;border-bottom:2px solid transparent;padding-bottom:1px;transition:color .15s ease,border-color .15s ease;}' +
        '#colonist-stats-tracker .cst-vtab:hover{color:' + THEME.accent + '!important;}' +
        // Resync feedback: the 🔄 icon spins and the body dims while a re-sync runs,
        // fading back in on completion — a clean "reloaded" beat even when the WS
        // path finishes instantly. Honest: it tracks the real operation's duration.
        '#colonist-stats-tracker #cst-body{transition:opacity .25s ease;}' +
        '#colonist-stats-tracker.cst-syncing #cst-body{opacity:.45;}' +
        '#colonist-stats-tracker.cst-syncing #cst-resync svg{animation:cst-spin .6s linear infinite;}' +
        '@keyframes cst-spin{to{transform:rotate(360deg);}}';
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
      // Resources · Stats view tabs (inside the foldable header, so they must
      // claim the click before the fold logic below sees it).
      const vt = e.target.closest && e.target.closest('[data-resview]');
      if (vt && host.contains(vt)) {
        switchResView(vt.getAttribute('data-resview') === 'stats' ? 'stats' : 'cards');
        return;
      }
      const head = e.target.closest && e.target.closest('[data-fold]');
      if (!head || !host.contains(head)) return;
      toggleFold(head.getAttribute('data-fold'));
    });

    // Width drives font size FROM THE CORNER (resize:both) — a wider corner-drag
    // zooms everything. A LEFT/RIGHT EDGE drag instead changes only the width
    // (pureWidthResize): the text stays put and the columns just get more room;
    // that gesture saves the width + a compensating fontScale itself, on mouseup.
    if (typeof ResizeObserver !== 'undefined') {
      let rT, lastW = 0, lastFaces = null;
      new ResizeObserver(() => {
        if (uiState.panelCollapsed) return;
        const w = host.offsetWidth;
        if (w === lastW) return;
        lastW = w;
        if (!pureWidthResize) host.style.fontSize = fpx(w);   // corner zoom only
        // In auto-mode, crossing the width threshold flips digits ⇄ dice live.
        const nowFaces = diceFacesActive();
        if (nowFaces !== lastFaces) { lastFaces = nowFaces; render(); }
        if (!pureWidthResize) {
          clearTimeout(rT);
          rT = setTimeout(() => updateActivePreset({ width: w }), 250);
        }
      }).observe(host);
    }

    host.querySelector('#cst-resync').addEventListener('click', () => {
      runResync();   // async; spins the icon + dims the body, guards re-entrancy
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

    // How-to (?) overlay: open from the header button, close via ✕ or a backdrop click.
    const helpBtn = host.querySelector('#cst-help');
    const helpOverlay = host.querySelector('#cst-help-overlay');
    if (helpBtn && helpOverlay) {
      helpBtn.addEventListener('click', (e) => { e.stopPropagation(); helpOverlay.style.display = 'flex'; });
      helpOverlay.addEventListener('click', (e) => {
        if (e.target === helpOverlay || (e.target.closest && e.target.closest('#cst-help-close'))) {
          helpOverlay.style.display = 'none';
        }
      });
    }

    // Hover a resource COLUMN → highlight it with an overlay tinted in THAT
    // resource's own colour (soft fill + bright neon side bars + a fluorescent
    // glow), and bold its numbers (extra-bold where a player holds it). Detection
    // is by pointer-x against the header cells, so the WHOLE column strip is hot —
    // gaps between cells and rows included. The overlay lives in the stable
    // #cst-res-wrap so it survives render()'s innerHTML swaps.
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
    colFill.style.cssText = 'position:absolute;inset:0;pointer-events:none;';
    const colBarL = document.createElement('div');
    colBarL.style.cssText = 'position:absolute;left:0;top:0;bottom:0;width:2.5px;pointer-events:none;';
    const colBarR = document.createElement('div');
    colBarR.style.cssText = 'position:absolute;right:0;top:0;bottom:0;width:2.5px;pointer-events:none;';
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
      if (dragging) return;
      const hit = columnAt(e.clientX);
      if (!hit) { clearColHL(); return; }
      const rgb = RES_HL[hit.res] || '47,111,159';
      const wr = wrap.getBoundingClientRect();
      colHL.style.left = (hit.rect.left - wr.left) + 'px';
      colHL.style.width = hit.rect.width + 'px';
      colHL.style.height = resEl.offsetHeight + 'px';
      // Soft fill with LONG fades at both ends — the previous short 13% ramp
      // ended right where the rectangular box-shadow glow didn't, which read
      // as a hard line / a bump sticking out at the top.
      colFill.style.background =
        `linear-gradient(to bottom, rgba(${rgb},0) 0%, rgba(${rgb},.22) 22%, rgba(${rgb},.13) 78%, rgba(${rgb},0) 100%)`;
      // Neon side bars: bright through the middle, fading at the ends to match.
      const barGrad =
        `linear-gradient(to bottom, rgba(${rgb},0) 0%, rgb(${rgb}) 22%, rgb(${rgb}) 78%, rgba(${rgb},0) 100%)`;
      colBarL.style.background = barGrad;
      colBarR.style.background = barGrad;
      // The bloom is a drop-shadow on the bars themselves: it follows their
      // gradient alpha, so the glow fades out WITH the bar instead of being a
      // rectangle clipped at the highlight's bounds.
      const bloom = `drop-shadow(0 0 5px rgba(${rgb},.6))`;
      colBarL.style.filter = bloom;
      colBarR.style.filter = bloom;
      colHL.style.boxShadow = 'none';
      colHL.style.display = 'block';
      resEl.querySelectorAll('[data-res]').forEach((el) => {
        if (el.getAttribute('data-res') !== hit.res || el.querySelector('img')) { el.style.fontWeight = ''; return; }
        // 700 (not 800) so hovering an already-bold current-turn row doesn't compound
        // into an even-heavier weight — both effects settle at the same 700.
        el.style.fontWeight = '700';
      });
    });
    wrap.addEventListener('mouseleave', clearColHL);

    // PINNED columns: clicking a resource icon (handled in the drag handler) toggles
    // uiState.resColHighlights. Each pinned column gets a persistent neon band — the
    // same look as the hover highlight, but it stays lit. Bands live in #cst-res-wrap
    // (survives render's innerHTML swaps) and are repainted after every render via
    // refreshPinnedCols, since a re-render / reorder moves the column rects.
    const bandStyle = (rgb) => ({
      fill: `linear-gradient(to bottom, rgba(${rgb},0) 0%, rgba(${rgb},.22) 22%, rgba(${rgb},.13) 78%, rgba(${rgb},0) 100%)`,
      bar: `linear-gradient(to bottom, rgba(${rgb},0) 0%, rgb(${rgb}) 22%, rgb(${rgb}) 78%, rgba(${rgb},0) 100%)`,
      bloom: `drop-shadow(0 0 5px rgba(${rgb},.6))`,
    });
    function makeBand(rgb) {
      const s = bandStyle(rgb);
      const root = document.createElement('div');
      root.style.cssText = 'position:absolute;top:0;pointer-events:none;z-index:2;';
      const fill = document.createElement('div'); fill.style.cssText = 'position:absolute;inset:0;pointer-events:none;'; fill.style.background = s.fill;
      const bl = document.createElement('div'); bl.style.cssText = 'position:absolute;left:0;top:0;bottom:0;width:2.5px;pointer-events:none;'; bl.style.background = s.bar; bl.style.filter = s.bloom;
      const br = document.createElement('div'); br.style.cssText = 'position:absolute;right:0;top:0;bottom:0;width:2.5px;pointer-events:none;'; br.style.background = s.bar; br.style.filter = s.bloom;
      root.append(fill, bl, br);
      return root;
    }
    let pinnedEls = [];
    refreshPinnedCols = function () {
      pinnedEls.forEach((el) => el.remove());
      pinnedEls = [];
      const headRow = resEl.firstElementChild;
      if (!headRow) return;
      const wr = wrap.getBoundingClientRect();
      for (const res of uiState.resColHighlights) {
        const cell = headRow.querySelector(`[data-colhead][data-res="${res}"]`);
        if (!cell) continue;
        const rect = cell.getBoundingClientRect();
        const el = makeBand(RES_HL[res] || '47,111,159');
        el.setAttribute('data-pinband', res);
        el.style.left = (rect.left - wr.left) + 'px';
        el.style.width = rect.width + 'px';
        el.style.height = resEl.offsetHeight + 'px';
        wrap.appendChild(el);
        pinnedEls.push(el);
      }
    };
    refreshPinnedCols();

    // Custom dialog tooltip for the dice columns (replaces the native title). Lives on
    // <body> so the panel's translateZ layer doesn't trap its fixed positioning.
    const diceEl = host.querySelector('#cst-dice');
    let tip = document.getElementById('cst-tip');
    if (!tip) {
      tip = document.createElement('div');
      tip.id = 'cst-tip';
      // White "data" dialog (like a stock-chart tooltip) — dark text on light.
      // This single styled dialog replaces EVERY native title tooltip in the
      // panel (buttons, icons, badges, stats breakdowns) via [data-tip].
      tip.style.cssText = 'position:fixed;display:none;z-index:2147483647;pointer-events:none;' +
        `background:#ffffff;color:${THEME.text};padding:9px 13px;border-radius:10px;font-size:13px;line-height:1.55;` +
        `border:1px solid ${THEME.border};box-shadow:0 10px 26px rgba(40,30,10,.30);max-width:280px;text-align:left;` +
        'transform:translate(14px,16px);font-family:-apple-system,"Segoe UI","Noto Sans TC",sans-serif;';
      document.body.appendChild(tip);
    }
    // Trail below-right of the cursor, flipping near the right/bottom screen
    // edges so the dialog never runs off-screen.
    const placeTip = (e) => {
      const tx = e.clientX > window.innerWidth - 300 ? 'calc(-100% - 14px)' : '14px';
      const ty = e.clientY > window.innerHeight - 110 ? 'calc(-100% - 14px)' : '16px';
      tip.style.transform = `translate(${tx},${ty})`;
      tip.style.left = e.clientX + 'px';
      tip.style.top = e.clientY + 'px';
      tip.style.display = 'block';
    };
    // Only the count + bar zone (data-dietip) shows the dice dialog — NOT the %
    // or the value below it (that area is the digit/dice toggle).
    diceEl.addEventListener('mousemove', (e) => {
      const zone = e.target.closest('[data-dietip]');
      if (!zone) { tip.style.display = 'none'; return; }
      tip.innerHTML = diceTipHTML(+zone.getAttribute('data-dietip'));
      placeTip(e);
    });
    diceEl.addEventListener('mouseleave', () => { tip.style.display = 'none'; });

    // Generic styled tooltips: any [data-tip] in the panel uses the same dialog
    // (the dice zones above own their richer HTML content, so skip them here).
    // [data-pie] cells (gained cards) get a live per-resource pie instead.
    host.addEventListener('mousemove', (e) => {
      if (dragging) { tip.style.display = 'none'; return; }
      if (e.target.closest && e.target.closest('[data-dietip]')) return;
      const pieEl = e.target.closest && e.target.closest('[data-pie]');
      if (pieEl && host.contains(pieEl)) {
        const html = gainPieHTML(pieEl.getAttribute('data-pie'));
        if (html) { tip.innerHTML = html; placeTip(e); return; }
      }
      const bdEl = e.target.closest && e.target.closest('[data-bd]');
      if (bdEl && host.contains(bdEl)) {
        const [who, kind] = bdEl.getAttribute('data-bd').split('|');
        const html = kind === 'trade' ? tradeBreakdownHTML(who)
          : kind === 'block' ? blockReportHTML(who)
          : kind === 'disc' ? discReportHTML(who)
          : stealReportHTML(who, kind);
        if (html) { tip.innerHTML = html; placeTip(e); return; }
      }
      const z = e.target.closest && e.target.closest('[data-tip]');
      if (!z || !host.contains(z)) { tip.style.display = 'none'; return; }
      tip.textContent = z.getAttribute('data-tip');
      placeTip(e);
    });
    host.addEventListener('mouseleave', () => { tip.style.display = 'none'; });
    wireColumnDrag(host);

    // Click the bottom value → flip digits ⇄ dice (a sticky manual override of the
    // auto-by-width default), with a springy fade swap. Only the value spans are
    // touched (no full re-render) so the bars/spacing never jump.
    diceEl.addEventListener('click', (e) => {
      // The 2–12 label flips digits ⇄ dice faces (checked first so it wins over
      // the column-highlight below — they overlap in the same column).
      const t = e.target.closest('[data-dietoggle]');
      if (t) {
        uiState.diceMode = diceFacesActive() ? 'digits' : 'faces';
        saveUI({ diceMode: uiState.diceMode });
        animateDiceSwap();
        return;
      }
      // Anywhere else on a column → pin/unpin that whole dice bar.
      const col = e.target.closest('[data-die]');
      if (col && diceEl.contains(col)) toggleDiceHighlight(col.getAttribute('data-die'));
    });

    // Click a value cell → toggle its manual highlight. A drag-reorder ends with
    // dragging=true, so ignore that release (a real click leaves it false).
    host.addEventListener('click', (e) => {
      if (dragging) return;
      const pmEl = e.target.closest && e.target.closest('[data-pipmode]');
      if (pmEl && host.contains(pmEl)) { togglePipMode(); return; }   // click the ⚅ number: coverage ⇄ expected
      const pn = e.target.closest && e.target.closest('[data-pipname]');
      if (pn && host.contains(pn)) { selectPipPlayer(pn.getAttribute('data-pipname')); return; }
      // closest() handles a direct hit; if an overlay (e.g. the column-highlight
      // layer) becomes the event target instead, fall back to the topmost
      // [data-cell] under the pointer so the click still lands on the value cell.
      let cell = e.target.closest && e.target.closest('[data-cell]');
      if (!cell && e.clientX != null && document.elementsFromPoint) {
        cell = document.elementsFromPoint(e.clientX, e.clientY)
          .find((el) => el.matches && el.matches('[data-cell]'));
      }
      if (cell && host.contains(cell)) toggleCellHighlight(cell.getAttribute('data-cell'));
    });

    makeDraggable(host, host.querySelector('#cst-header'));
    makeEdgeResizable(host);

    render();
    applySectionInit();
    updateViewTabs();
    if (uiState.panelCollapsed) setPanelCollapsed(true);
  }

  // Drag-reorder the value columns by their header icons. Press an icon and move
  // past a small threshold to start; the whole column (header + every row cell,
  // selected by its shared data-res) follows the pointer while the others slide
  // to make room. On release the order array is updated, persisted, re-rendered.
  function wireColumnDrag(host) {
    let d = null; // active drag context

    // Authoritatively kill any native HTML5 drag (card image OR a stray text
    // selection) that starts on a column header. draggable="false" only covers
    // images; cancelling dragstart covers every source, so the browser never
    // shows the "no-drop" 🚫 cursor or hijacks our pointer reorder.
    host.addEventListener('dragstart', (e) => {
      if (e.target.closest && e.target.closest('[data-colhead]')) e.preventDefault();
    });

    host.addEventListener('pointerdown', (e) => {
      const head = e.target.closest && e.target.closest('[data-colhead]');
      if (!head || !host.contains(head)) return;
      const wrap = host.querySelector('#cst-res-wrap');
      if (!wrap || !wrap.contains(head)) return;
      const view = uiState.resView;                       // 'cards' | 'stats'
      const order = (view === 'stats' ? uiState.statOrder : uiState.resOrder).slice();
      const key = head.getAttribute('data-res');
      const fromIdx = order.indexOf(key);
      if (fromIdx < 0) return;
      const heads = order.map((k) => wrap.querySelector(`[data-colhead][data-res="${k}"]`));
      if (heads.some((h) => !h)) return;
      const centers = heads.map((h) => {
        const r = h.getBoundingClientRect();
        return r.left + r.width / 2;
      });
      const step = centers.length > 1 ? (centers[1] - centers[0]) : 40;
      d = { view, order, key, fromIdx, toIdx: fromIdx, startX: e.clientX, started: false, wrap, step, centers };
      try { head.setPointerCapture(e.pointerId); } catch (_) {}
      e.stopPropagation();                                // don't start a panel move
    });

    host.addEventListener('pointermove', (e) => {
      if (!d) return;
      const dx = e.clientX - d.startX;
      if (!d.started) {
        if (Math.abs(dx) < 4) return;                     // below threshold: still a click
        d.started = true;
        dragging = true;
        e.preventDefault();
      }
      const draggedCentre = d.centers[d.fromIdx] + dx;
      let toIdx = 0;
      for (let i = 0; i < d.centers.length; i++) if (draggedCentre > d.centers[i]) toIdx = i;
      d.toIdx = Math.max(0, Math.min(d.order.length - 1, toIdx));
      applyColumnShift(d, dx);
    });

    function endDrag() {
      if (!d) return;
      const ctx = d; d = null;
      clearColumnShift(ctx.wrap);
      if (ctx.started && ctx.toIdx !== ctx.fromIdx) {
        const next = reorderKeys(ctx.order, ctx.fromIdx, ctx.toIdx);
        if (ctx.view === 'stats') { uiState.statOrder = next; saveUI({ statOrder: next }); }
        else { uiState.resOrder = next; saveUI({ resOrder: next }); }
        render();
      } else if (!ctx.started && ctx.view === 'cards') {
        toggleColumnHighlight(ctx.key);   // a press without a drag = pin/unpin the column
      }
      dragging = false;
    }
    host.addEventListener('pointerup', endDrag);
    host.addEventListener('pointercancel', endDrag);
  }

  // Translate each column group so the dragged one follows the pointer and the
  // others open a gap. Columns are selected by their shared data-res (header +
  // body cells), scoped to the table wrap.
  function applyColumnShift(d, dx) {
    for (let i = 0; i < d.order.length; i++) {
      const k = d.order[i];
      let tx = 0;
      if (i === d.fromIdx) {
        tx = dx;
      } else if (d.fromIdx < d.toIdx && i > d.fromIdx && i <= d.toIdx) {
        tx = -d.step;
      } else if (d.fromIdx > d.toIdx && i < d.fromIdx && i >= d.toIdx) {
        tx = d.step;
      }
      const cells = d.wrap.querySelectorAll(`[data-res="${k}"]`);
      cells.forEach((c) => {
        c.style.transition = (i === d.fromIdx) ? 'none' : 'transform .15s ease';
        c.style.transform = tx ? `translateX(${tx}px)` : '';
        c.style.position = (i === d.fromIdx && tx) ? 'relative' : '';
        c.style.zIndex = (i === d.fromIdx && tx) ? '5' : '';
      });
    }
  }

  function clearColumnShift(wrap) {
    wrap.querySelectorAll('[data-res]').forEach((c) => {
      c.style.transition = '';
      c.style.transform = '';
      c.style.position = '';
      c.style.zIndex = '';
    });
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

  // Edge-resize: thin grab strips on all four sides (the native resize:both
  // only offers the bottom-right corner). Left/top drags also reposition the
  // panel so the opposite edge stays planted. Width changes flow through the
  // existing ResizeObserver (font zoom + preset save); position is saved on
  // mouseup. Strips sit INSIDE the panel (overflow:hidden would clip outies).
  function makeEdgeResizable(el) {
    const ZONES = [
      { side: 'left',   css: 'left:0;top:10px;bottom:10px;width:6px;cursor:ew-resize;' },
      { side: 'right',  css: 'right:0;top:10px;bottom:10px;width:6px;cursor:ew-resize;' },
      { side: 'top',    css: 'top:0;left:10px;right:10px;height:6px;cursor:ns-resize;' },
      { side: 'bottom', css: 'bottom:0;left:10px;right:10px;height:6px;cursor:ns-resize;' },
    ];
    for (const z of ZONES) {
      const grip = document.createElement('div');
      grip.className = 'cst-rz';
      grip.style.cssText = 'position:absolute;z-index:7;' + z.css;
      el.appendChild(grip);
      grip.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const r = el.getBoundingClientRect();
        const sx = e.clientX, sy = e.clientY;
        const start = { left: r.left, top: r.top, width: r.width, height: r.height };
        el.style.right = 'auto';
        // Left/right edges change width WITHOUT zooming: hold the current text
        // size during the drag, then bake it into fontScale on release so it
        // sticks (and survives reload, where the font is recomputed from width).
        const isWidth = (z.side === 'left' || z.side === 'right');
        const startFontPx = isWidth
          ? (parseFloat(getComputedStyle(el).fontSize) || fontFromWidth(start.width))
          : 0;
        if (isWidth) pureWidthResize = true;
        const move = (ev) => {
          const dx = ev.clientX - sx, dy = ev.clientY - sy;
          if (z.side === 'right') {
            el.style.width = Math.max(250, start.width + dx) + 'px';
          } else if (z.side === 'left') {
            const w = Math.max(250, start.width - dx);
            el.style.width = w + 'px';
            el.style.left = (start.left + (start.width - w)) + 'px';
          } else if (z.side === 'bottom') {
            el.style.height = Math.max(120, start.height + dy) + 'px';
          } else {                                   // top
            const h = Math.max(120, start.height - dy);
            el.style.height = h + 'px';
            el.style.top = (start.top + (start.height - h)) + 'px';
          }
        };
        const up = () => {
          window.removeEventListener('mousemove', move);
          window.removeEventListener('mouseup', up);
          if (isWidth) {
            pureWidthResize = false;
            // Keep the text the same size at the NEW width: fontScale such that
            // fpx(newWidth) === startFontPx. (fpx = fontFromWidth(w) * fontScale.)
            const ff = fontFromWidth(el.getBoundingClientRect().width);
            if (ff > 0 && startFontPx > 0) {
              uiState.fontScale = startFontPx / ff;
              saveUI({ fontScale: uiState.fontScale });
            }
          }
          updateActivePreset({
            left: Math.round(parseFloat(el.style.left) || start.left),
            top: Math.round(parseFloat(el.style.top) || start.top),
            width: Math.round(el.getBoundingClientRect().width),
          });
        };
        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', up);
      });
    }
  }

  // "Rolls since the last N" — the drought for a given sum (0 if N was just rolled,
  // or the whole history length if N has never come up).
  function rollsSince(n) {
    const h = state.rollHistory;
    for (let i = h.length - 1, k = 0; i >= 0; i--, k++) if (h[i] === n) return k;
    return h.length;
  }

  // ---- dice drought spotlight ----
  // A drought is more surprising for a COMMON sum (6/8 — expected every ~7
  // rolls) than a rare one (2/12 — every ~36), so we weight rolls-since-last by
  // the expected gap rather than spotlighting raw absence (which 2/12 would
  // always win). coldestSum() returns the most-overdue producing sum (2–6,
  // 8–12; 7 is excluded — a 7 drought is good news, no robber) as {n, k, factor},
  // or null until the game has enough rolls AND a clear leader has emerged — so
  // the header spotlight only appears when it actually means something.
  const COLD_MIN_ROLLS = 8;    // ignore the noisy opening rolls
  const COLD_MIN_DROUGHT = 5;  // a 3-roll gap isn't a "drought"
  const COLD_FACTOR = 2;       // twice the expected gap = worth flagging
  function expectedGap(n) { return 100 / EXPECTED_PCT[n]; } // 1/p, in rolls
  function coldestSum() {
    if (state.totalRolls < COLD_MIN_ROLLS) return null;
    let best = null;
    for (let n = 2; n <= 12; n++) {
      if (n === 7) continue;
      const k = rollsSince(n);
      if (k < COLD_MIN_DROUGHT) continue;
      const factor = k / expectedGap(n);
      if (factor < COLD_FACTOR) continue;
      if (!best || factor > best.factor) best = { n, k, factor };
    }
    return best;
  }

  // ---- dice fairness (chi-square goodness-of-fit) ----
  // Σ (observed − expected)² / expected over sums 2–12 (10 degrees of freedom).
  // A perfectly fair sample → ~0; for fair dice the statistic averages ≈10 (the
  // dof) and only exceeds ~18.3 about 5% of the time, so a higher reading means
  // the dice are skewed at the p<0.05 level. Null until the sample is big enough
  // for the statistic to mean anything.
  const CHI_MIN_ROLLS = 24;
  function chiSquare() {
    if (state.totalRolls < CHI_MIN_ROLLS) return null;
    let chi = 0;
    for (let n = 2; n <= 12; n++) {
      const exp = state.totalRolls * EXPECTED_PCT[n] / 100;
      if (exp <= 0) continue;
      const diff = state.diceCounts[n] - exp;
      chi += (diff * diff) / exp;
    }
    return chi;
  }

  // Map the χ² statistic (10 dof) to a human fairness band. The critical values
  // are χ²₀.₀₅(10)=18.31 and χ²₀.₀₁(10)=23.21, so 'skewed' means the dice differ
  // from fair at p<0.05 and 'verySkewed' at p<0.01. Null until chiSquare() is
  // meaningful (enough rolls).
  function luckTier(chi) {
    if (chi == null) return null;
    if (chi > 23.21) return 'verySkewed';
    if (chi > 18.31) return 'skewed';
    return 'fair';
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
  // A single die face: colonist's real art if we've cached it (matches the board
  // exactly), otherwise the self-drawn SVG above. alt = the value so it still
  // reads if the URL 404s after a redeploy (CSP-safe, no inline error handler).
  function dieFaceHTML(v, em) {
    const src = DICE_ICON[v];
    if (src) {
      return `<img src="${escapeAttr(src)}" alt="${v}" ` +
        `style="display:block;width:${em}em;height:${em}em;` +
        `filter:drop-shadow(0 1px 1.5px rgba(40,30,10,.3));">`;
    }
    return dieFaceSVG(v, em);
  }
  // The bottom-row value: a small, de-emphasised digit (the COUNT above is the
  // headline), or — when `faces` is on — the two physical dice that sum to it
  // (sized to sit comfortably inside a narrow column).
  function dieValueHTML(n, faces) {
    if (!faces) {
      return `<span style="font-size:0.82em;font-weight:600;font-variant-numeric:tabular-nums;color:${n === 7 ? THEME.bad : THEME.textDim};">${n}</span>`;
    }
    const [a, b] = DICE_PAIR[n];
    return `<span style="display:inline-flex;gap:0.16em;align-items:center;justify-content:center;">${dieFaceHTML(a, 1.05)}${dieFaceHTML(b, 1.05)}</span>`;
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
    const expected = escapeHtml(t('tipExpected', 'Expected {p}%', { p: EXPECTED_PCT[n] }));
    if (!state.totalRolls) return `<b>${expected}</b>`;
    return `<span style="color:#b5730a;font-weight:700;">` +
      escapeHtml(t('tipRollsSince', '{k} rolls since last {n}', { k: rollsSince(n), n })) +
      `</span><br><span style="color:${THEME.textDim};">${expected}</span>`;
  }

  // The last ~12 rolls as a left→right strip (newest on the right, with an
  // accent ring; 7s flagged in red) so you can read the RUN of rolls during a
  // turn/trade — not just the frequency histogram. The strip ALWAYS occupies its
  // row (blank but full-height before the first roll) so the panel doesn't jump
  // when the first chip appears.
  // Render up to this many recent rolls; the row then shows as many as the width
  // FITS (newest on the right), clipping and fading the oldest at the label's right
  // edge. So a wider panel reveals more of the run, and the chips never cross under
  // the "Roll order" label. (flex:0 0 auto keeps each chip its full size.)
  const ROLL_STRIP_MAX = 40;
  const CHIP_BASE = 'flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;' +
    'min-width:1.55em;height:1.55em;padding:0 0.2em;border-radius:0.35em;' +
    'font-size:0.78em;font-weight:700;font-variant-numeric:tabular-nums;';
  function renderRollStrip() {
    const recent = state.rollHistory.slice(-ROLL_STRIP_MAX);
    const empty = !recent.length;
    const chips = empty
      // One hidden chip reserves exactly the populated row's height.
      ? `<span style="${CHIP_BASE}visibility:hidden;">0</span>`
      : recent.map((n, i) => {
        const newest = i === recent.length - 1;
        const seven = n === 7;
        return `<span style="${CHIP_BASE}` +
          `background:${seven ? THEME.bad : '#fbf9f4'};color:${seven ? '#fff' : THEME.text};` +
          `border:1px solid ${seven ? THEME.bad : THEME.border};` +
          `${newest ? `box-shadow:0 0 0 2px ${THEME.accent}55;` : 'opacity:.9;'}">${n}</span>`;
      }).join('');
    const tip = empty ? '' : ` data-tip="${t('tipLastRolls', 'Recent rolls — newest on the right; the oldest fade out on the left as the panel narrows')}"`;
    // The label is fixed on the left; the chips live in their own overflow-hidden
    // box that starts at the label's right edge and right-aligns, so widening the
    // panel simply shows more chips. A left fade mask softens the clipped oldest one.
    const fadeMask = 'mask:linear-gradient(to right,transparent,#000 1.4em);-webkit-mask:linear-gradient(to right,transparent,#000 1.4em);';
    return `<div style="display:flex;gap:0.45em;align-items:center;margin:0 0 0.6em;flex:0 0 auto;">` +
      `<span style="flex:0 0 auto;color:${THEME.textDim};font-size:0.7em;white-space:nowrap;${empty ? 'visibility:hidden;' : ''}">${t('rollOrder', 'Roll order')}</span>` +
      `<div${tip} style="flex:1 1 auto;min-width:0;display:flex;gap:0.25em;align-items:center;justify-content:flex-end;overflow:hidden;${empty ? '' : fadeMask}">${chips}</div></div>`;
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
      // A pinned column (click anywhere but the 2–12 label) gets a soft glow on
      // the WHOLE bar — the same warm marker as the table-cell highlight.
      const hl = uiState.diceHighlights.includes(String(n))
        ? 'background:rgba(255,212,92,.42);box-shadow:inset 0 0 0 1.5px rgba(201,148,18,.9), 0 0 7px rgba(255,205,70,.55);'
        : '';
      // The column is a flex stack with justify:space-evenly, so as the panel is
      // dragged taller the extra height flows into the gaps (bar ↔ % ↔ value),
      // i.e. the whole column "breathes" rather than parking blank space below.
      cols.push(`
        <div data-die="${n}"
             style="flex:1 1 0;display:flex;flex-direction:column;align-items:center;justify-content:space-evenly;gap:0.6em;min-width:0;border-radius:6px;cursor:pointer;${hl}">
          <div data-dietip="${n}" style="display:flex;flex-direction:column;align-items:center;gap:0.6em;width:100%;flex:0 0 auto;cursor:default;">
            <span style="font-size:0.96em;font-weight:700;font-variant-numeric:tabular-nums;color:${THEME.text};">${c}</span>
            <div style="width:100%;height:3.9em;display:flex;align-items:flex-end;justify-content:center;">
              <div style="width:74%;height:${barH}%;min-height:2px;background:${barColor};border-radius:3px 3px 0 0;transition:height .2s;"></div>
            </div>
          </div>
          <span style="font-size:0.7em;font-weight:600;font-variant-numeric:tabular-nums;color:${barColor};flex:0 0 auto;">${Math.round(pct)}%</span>
          <span data-dietoggle="${n}" data-tip="${t('tipDiceToggle', 'Click to switch digits / dice')}"
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
  // The local player's own name from colonist's player panel. Every row carries
  // a `playerRow…` class, but ONLY opponents also carry `opponentPlayerRow…`, so
  // the row WITHOUT that marker is YOU. Far more reliable than the avatar guess:
  // colonist gives you AND other humans the same `icon_player` avatar, which made
  // the old heuristic tag an opponent as "self" in multi-human games (the cause
  // of the "stole from self / to self" steal paths).
  function selfFromPanel() {
    for (const row of document.querySelectorAll('[data-player-color]')) {
      const cls = (row.className || '').toString();
      if (/playerRow/.test(cls) && !/opponentPlayerRow/.test(cls)) {
        const nameEl = row.querySelector('[class*="username"]');
        const n = nameEl ? (nameEl.textContent || '').trim() : '';
        if (n) return n;
      }
    }
    return null;
  }

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

  // Order + avatars from colonist's panel; fall back to first-seen order.
  // Shared by the Resources and Stats tables so their rows always line up.
  function panelOrderedPlayers() {
    const profiles = readPlayerPanel();
    const prof = profiles ? new Map(profiles.map((p, i) => [p.name, { avatar: p.avatar, order: i }])) : null;
    const players = [...state.players.values()];
    if (prof) {
      players.sort((a, b) =>
        (prof.has(a.name) ? prof.get(a.name).order : 1e9) -
        (prof.has(b.name) ? prof.get(b.name).order : 1e9));
    }
    return { players, prof };
  }

  // Resources table. Each resource icon's header carries a top-right badge with
  // the bank-remaining count (like colonist's supply row); the last column is
  // the unknown/stolen-card count, headed by colonist's face-down "?" card. No
  // separate Σ total — colonist's own dashboard already shows each hand size.
  // Player rows follow colonist's panel order and show each player's avatar.
  // Sampled from colonist's resource tints; shared by the column-hover
  // highlight and the gained-cards hover pie.
  const RES_HL = {
    lumber: '66,170,45', brick: '203,90,68', wool: '146,196,74',
    grain: '238,194,60', ore: '143,179,166', unknown: '47,111,159',
    // Stats columns glow in a violet no other panel element uses, so the
    // hover reads as "stats", not as any particular resource.
    's-block': '138,103,194', 's-lost': '138,103,194',
    's-disc': '138,103,194', 's-gain': '138,103,194',
    's-turn': '138,103,194', 's-stolen': '138,103,194',
  };

  // The live-stats columns (the Stats view of the player table). Keys double
  // as data-res hooks for the column hover + the ±N float targeting. Dev cards
  // and builds stay TALLIED (and archived per game) but aren't displayed —
  // colonist's own dashboard already shows them; four columns breathe better.
  // Self-drawn fallback icons (currentColor stroke → tracks the panel text colour).
  function fbSvg(paths) {
    return `<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" ` +
      `stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;">${paths}</svg>`;
  }

  // ---- self-drawn stat icons: unified line-art + a corner +/- badge ----
  // Matches the dashboard: currentColor stroke (tracks the panel text colour) plus
  // a small corner badge — THEME.good "+" (gain) / THEME.bad "−" (loss) / none
  // (neutral). Plain paths only (no gradient ids → no clash when inlined).
  const sDot = (x, y) => `<circle cx="${x}" cy="${y}" r="1.2" fill="currentColor" stroke="none"/>`;
  const sRobber = '<circle cx="16" cy="9" r="3.1"/><path d="M10.5 22.4C10.5 15 12.6 12.7 16 12.7s5.5 2.3 5.5 9.7Z"/>';
  function statBadge(kind) {
    if (kind === '+') return `<circle cx="25" cy="25" r="6.4" fill="${THEME.good}" stroke="none"/><path d="M25 22V28M22 25H28" stroke="#fff" stroke-width="2.2"/>`;
    if (kind === '-') return `<circle cx="25" cy="25" r="6.4" fill="${THEME.bad}" stroke="none"/><path d="M22 25H28" stroke="#fff" stroke-width="2.2"/>`;
    return '';
  }
  function statIcon(inner, badge) {
    return `<svg viewBox="0 0 32 32" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;">${inner}${statBadge(badge)}</svg>`;
  }
  // 卡田=賊(小)+問號牌 ・ 棄牌=兩骰湊7 ・ 獲得=骰子+卡牌 ・ 回合=沙漏 ・ 被偷/偷到=賊
  const ICON_BLOCK = '<circle cx="10" cy="10.5" r="2.5"/><path d="M6 21C6 15.7 7.6 14 10 14s4 1.7 4 7Z"/>'
    + '<rect x="15" y="11" width="9.2" height="11.6" rx="1.6"/>'
    + '<path d="M17.6 14.9a1.9 1.9 0 0 1 3.4 1.2c0 1.3-1.7 1.3-1.7 2.5"/>'
    + '<circle cx="19.4" cy="20.4" r=".85" fill="currentColor" stroke="none"/>';
  const ICON_DISC = '<rect x="3.5" y="6" width="11.5" height="11.5" rx="2.4"/>'
    + sDot(6.3, 8.8) + sDot(9.25, 11.75) + sDot(12.2, 14.7)
    + '<rect x="14.5" y="11" width="11.5" height="11.5" rx="2.4"/>'
    + sDot(17.3, 13.8) + sDot(23.2, 13.8) + sDot(17.3, 19.7) + sDot(23.2, 19.7);
  const ICON_GAIN = '<rect x="3" y="7.5" width="12.5" height="12.5" rx="2.6"/>'
    + sDot(6.6, 11.1) + sDot(11.9, 11.1) + sDot(6.6, 16.4) + sDot(11.9, 16.4)
    + '<rect x="16" y="8.5" width="9.5" height="13" rx="1.6" transform="rotate(9 20.75 15)"/>';
  const ICON_HOURGLASS = '<path d="M9 5H23M9 27H23M11 5c0 6.5 5 8.8 5 11s-5 4.5-5 11M21 5c0 6.5-5 8.8-5 11s5 4.5 5 11"/>';

  // Stat columns — fully self-drawn, no colonist asset dependency. Each is one
  // unified line-art glyph + a corner +/- badge so the row reads at a glance.
  const STAT_COLS = [
    { key: 's-block',  svg: statIcon(ICON_BLOCK, '-'),      tip: t('statBlock', 'Cards blocked') },
    { key: 's-lost',   svg: statIcon(sRobber, '-'),         tip: t('statLost', 'Cards lost (Knights) — hover for who & 7s') },
    { key: 's-disc',   svg: statIcon(ICON_DISC, '-'),       tip: t('statDisc', 'Cards discarded (rolled 7)') },
    { key: 's-gain',   svg: statIcon(ICON_GAIN, '+'),       tip: t('statGain', 'Cards gained') },
    { key: 's-turn',   svg: statIcon(ICON_HOURGLASS, null), tip: t('statTurn', 'Average turn length (live rolls only)') },
    { key: 's-stolen', svg: statIcon(sRobber, '+'),         tip: t('statStolen', 'Cards stolen (Knights) — hover for from whom') },
  ];

  // A stat header icon — fully self-drawn now (the colonist-asset harvest/bundle
  // path was retired in favour of the unified self-drawn icon set above).
  function statIconHTML(c) {
    return c.svg;
  }

  // Canonical column orders (the drag-reorder baseline). RES order includes the
  // unknown/stolen-card column so it reorders like any other.
  const RES_ORDER_DEF = ['lumber', 'brick', 'wool', 'grain', 'ore', 'unknown'];
  const STAT_ORDER_DEF = STAT_COLS.map((c) => c.key);
  const COL_BY_KEY = STAT_COLS.reduce((m, c) => { m[c.key] = c; return m; }, {});

  // Keep a saved order forward-compatible across versions that add/remove a
  // column: keep saved keys that still exist (in their saved order), then append
  // any canonical key the save is missing. Garbage/empty input → canonical.
  function reconcileOrder(saved, canonical) {
    const ok = new Set(canonical);
    const kept = (Array.isArray(saved) ? saved : []).filter((k) => ok.has(k));
    for (const k of canonical) if (!kept.includes(k)) kept.push(k);
    return kept;
  }

  function reorderKeys(arr, from, to) {
    const next = arr.slice();
    const [k] = next.splice(from, 1);
    next.splice(Math.max(0, Math.min(next.length, to)), 0, k);
    return next;
  }

  // Wide player column (avatar + name + hand total) + the value columns.
  // Header cells in BOTH views sit in the same fixed-height slot, so switching
  // tabs never changes the table height (no jumping panel).
  // ONE grid for both views: each is the Player column + 6 value columns, so a
  // shared template keeps the Player column pixel-identical when you switch tabs
  // (only the six value cells' contents change — no width/style jump).
  // The value tracks use minmax(0, …) (not a bare 0.8fr, which is minmax(auto,…)
  // and lets a wider cell like "1:05" bulge its column): this pins all six to the
  // exact same width regardless of content.
  const TABLE_GRID = 'minmax(120px,2.6fr) repeat(6, minmax(0, 0.8fr))';
  const HEAD_SLOT = 'height:2.3em;display:flex;align-items:center;justify-content:center;';
  // Top room reserved in BOTH table headers. The Resources header needs it for the
  // pinned opponents-hold figure that floats above a column icon (top:-1.5em). Stats
  // has no such figure but reserves the same room, so switching Resources⇄Stats never
  // shifts the panel vertically. One source of truth so the two can't drift apart.
  const HEAD_PAD_TOP = '1.8em';

  // Click-to-highlight a value cell. data-cell="player|key" identifies it (so the
  // mark follows a drag-reordered column and lapses when the roster changes);
  // cells listed in uiState.highlights get a soft background. cellMark returns the
  // attribute + background string to splice into the cell's span.
  const CELL_HL = 'background:rgba(255,212,92,.5);box-shadow:inset 0 0 0 1px rgba(201,148,18,.6);';
  function cellMark(name, key) {
    const id = name + '|' + key;
    return {
      a: ` data-cell="${escapeAttr(id)}"`,
      bg: uiState.highlights.includes(id) ? CELL_HL : '',
    };
  }
  function toggleCellHighlight(id) {
    if (!id) return;
    const i = uiState.highlights.indexOf(id);
    if (i >= 0) uiState.highlights.splice(i, 1);
    else uiState.highlights.push(id);
    saveUI({ highlights: uiState.highlights });
    render();
  }
  // A soft pin on a whole dice column (sum 2–12), keyed by the sum as a string.
  function toggleDiceHighlight(n) {
    if (n == null) return;
    const id = String(n);
    const i = uiState.diceHighlights.indexOf(id);
    if (i >= 0) uiState.diceHighlights.splice(i, 1);
    else uiState.diceHighlights.push(id);
    saveUI({ diceHighlights: uiState.diceHighlights });
    render();
  }
  // Drop every pinned highlight (cells + dice columns + resource columns) in one
  // go. Returns whether anything was pinned, so callers can skip a redundant save.
  function clearHighlights() {
    if (!uiState.highlights.length && !uiState.diceHighlights.length && !uiState.resColHighlights.length) return false;
    uiState.highlights = [];
    uiState.diceHighlights = [];
    uiState.resColHighlights = [];
    saveUI({ highlights: [], diceHighlights: [], resColHighlights: [] });
    return true;
  }
  // Pin/unpin a whole resource column (the icon header click, when it wasn't a
  // drag). Lights every player's cell in that column except your own — the point
  // is reading opponents' holdings (e.g. before a Monopoly).
  function toggleColumnHighlight(key) {
    if (!key) return;
    const i = uiState.resColHighlights.indexOf(key);
    if (i >= 0) uiState.resColHighlights.splice(i, 1);
    else uiState.resColHighlights.push(key);
    saveUI({ resColHighlights: uiState.resColHighlights });
    render();
  }
  // Click a player's name to toggle their Setup pips (badge + per-resource corners).
  // Multiple players can be selected at once. Transient — not persisted.
  function selectPipPlayer(name) {
    if (!name) return;
    const i = uiState.pipPlayers.indexOf(name);
    if (i >= 0) uiState.pipPlayers.splice(i, 1);
    else uiState.pipPlayers.push(name);
    render();
  }
  // The ⚅ number toggles its meaning: unweighted coverage pips ⇄ expected cards per
  // roll. Global (applies to every shown player), and persisted.
  function togglePipMode() {
    uiState.pipMode = uiState.pipMode === 'expected' ? 'unweighted' : 'expected';
    saveUI({ pipMode: uiState.pipMode });
    render();
  }

  function nameCell(p, prof, active, pipMap) {
    const av = prof && prof.get(p.name) && prof.get(p.name).avatar;
    const avatar = av
      ? `<span style="display:inline-flex;flex:0 0 auto;width:1.7em;height:1.7em;margin-right:5px;
          border-radius:50%;overflow:hidden;background:${escapeAttr(p.color)};align-items:center;justify-content:center;">
          <img src="${escapeAttr(av)}" alt="" style="width:100%;height:100%;object-fit:contain;"></span>`
      : '';
    // Discard risk: ABOVE the discard limit a rolled 7 costs half the hand, so
    // the hand-total badge flips to the warning colour (same data, pure style).
    const total = playerTotal(p);
    const risk = total > discardCap;
    const handTip = risk
      ? t('tipHandRisk', 'Over the {n}-card discard limit — a 7 would discard half', { n: discardCap })
      : t('tipHandTotal', 'Total cards in hand');
    const sel = uiState.pipPlayers.includes(p.name);   // pips show only for clicked names
    return `<span data-pipname="${escapeAttr(p.name)}" style="display:flex;align-items:center;gap:4px;min-width:0;color:${escapeAttr(p.color)};font-weight:700;cursor:pointer;${sel ? 'background:rgba(47,111,159,.15);border-radius:5px;' : ''}" ` +
      `data-tip="${escapeHtml(p.name)}${active ? ' — ' + t('currentTurn', 'current turn') : ''} · ${t('tipClickPips', 'click for Setup pips')}">${avatar}` +
      `<span style="flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(p.name)}</span>` +
      (sel ? pipBadge(pipMap && pipMap[wsColorOf(p.name)]) : '') +
      `<span data-tip="${escapeHtml(handTip)}" ` +
      `style="flex:0 0 auto;margin-right:7px;font-size:0.78em;font-weight:700;font-variant-numeric:tabular-nums;` +
      `color:${risk ? '#fff' : THEME.text};background:${risk ? THEME.bad : '#fbf9f4'};` +
      `border:1px solid ${risk ? THEME.bad : THEME.border};border-radius:0.6em;padding:0 0.4em;">${total}</span></span>`;
  }

  // ⚅ badge next to a player's name. Two modes (click it to switch):
  //  · unweighted — coverage pips: Σ pip-dots of the DISTINCT numbered tiles they
  //    touch (buildings ignored, robber tile excluded). An integer.
  //  · expected — cards per roll: Σ weight × P(number) per building (city ×2). A
  //    small decimal. Accent-tinted so it reads apart from the hand-total badge.
  function pipBadge(pm) {
    if (!pm || !pm.total) return '';
    const exp = uiState.pipMode === 'expected';
    const fmtR = (v) => (exp ? v.toFixed(1) : String(v));
    const parts = RESOURCES.map((r, i) => (pm.byRes[i + 1] >= (exp ? 0.05 : 1) ? RESOURCE_LABEL[r] + ' ' + fmtR(pm.byRes[i + 1]) : null)).filter(Boolean);
    const tip = (exp
      ? t('tipPipsExp', 'Expected cards per roll (city ×2; robber/blocked tiles excluded) — click to show coverage')
      : t('tipPips', 'Coverage pips (dice-frequency weighted; robber/blocked tiles excluded) — click for expected cards/roll'))
      + (parts.length ? ' — ' + parts.join(', ') : '');
    return `<span data-pipmode="1" data-tip="${escapeHtml(tip)}" ` +
      `style="flex:0 0 auto;margin-right:4px;font-size:0.72em;font-weight:700;font-variant-numeric:tabular-nums;cursor:pointer;` +
      `color:${THEME.accent};background:rgba(47,111,159,.10);border:1px solid ${THEME.accent};` +
      `border-radius:0.6em;padding:0 0.4em;">⚅${exp ? pm.total.toFixed(2) : pm.total}</span>`;
  }
  // Pip map for this render (per WS colour), or null before the board is ready.
  function currentPipMap() {
    if (!wsBoard || !__cstBoard.ready(wsBoard)) return null;
    return uiState.pipMode === 'expected' ? __cstBoard.expectedPipsOf(wsBoard) : __cstBoard.pipsOf(wsBoard);
  }

  function rowShell(p, active, cells, grid) {
    return `
      <div data-prow="${escapeHtml(p.name)}" style="display:grid;grid-template-columns:${grid};gap:4px;align-items:center;flex:1 1 auto;
           padding:5px 3px 5px 11px;border-top:1px solid ${THEME.rowLine};${active ? `background:rgba(47,111,159,.12);box-shadow:inset 3px 0 0 ${THEME.accent};` : ''}">
        ${cells}
      </div>`;
  }

  const tableHead = (cells, grid, padTop = '0.9em') => `
    <div style="display:grid;grid-template-columns:${grid};gap:4px;align-items:end;padding:${padTop} 3px 0.7em 11px;flex:0 0 auto;">
      <span style="color:${THEME.textDim};font-size:0.8em;align-self:center;">${t('player', 'Player')}</span>
      ${cells}
    </div>`;
  const EMPTY_ROW = () =>
    `<div style="color:${THEME.textDim};padding:5px 3px;flex:0 0 auto;">${t('waitingFirstMove', 'Waiting for first move…')}</div>`;

  function renderCardsView() {
    const bank = bankRemaining();
    const iconCell = (r) => {
      if (r === 'unknown') {
        return `<span data-res="unknown" data-colhead="1" data-tip="${t('tipUnknownCards', 'Unknown (stolen) cards')}" style="${HEAD_SLOT}border-radius:5px;cursor:grab;">${iconImg('unknown', 1.85)}</span>`;
      }
      const low = bank[r] <= 2;
      // Opponents' total known holding of this resource — the number you weigh
      // before a Monopoly. Only shown once you PIN this column (click its icon); it
      // floats up in the gap above the row, clear of the icon. Self is excluded;
      // unknown cards aren't counted (we only sum what's pinned to this resource).
      let oppHold = 0;
      for (const pl of state.players.values()) if (pl.name !== state.selfName) oppHold += pl.resources[r] || 0;
      const oppTip = t('oppHold', 'Opponents hold {n} {res} (for Monopoly)', { n: oppHold, res: RESOURCE_LABEL[r] });
      const oppNum = uiState.resColHighlights.includes(r)
        ? `<span data-tip="${escapeHtml(oppTip)}" style="position:absolute;top:-1.5em;left:50%;transform:translateX(-50%);text-align:center;color:${THEME.accent};font-size:0.82em;font-weight:800;line-height:1;font-variant-numeric:tabular-nums;white-space:nowrap;">${oppHold}</span>`
        : '';
      return `<span data-res="${r}" data-colhead="1" data-tip="${t('bankLeft', 'Bank: {n} {res} left', { n: bank[r], res: RESOURCE_LABEL[r] })}" style="${HEAD_SLOT}border-radius:5px;cursor:grab;">
        <span style="position:relative;display:inline-block;line-height:0;">
          ${iconImg(r, 2.0)}
          ${oppNum}
          <span style="position:absolute;top:-0.5em;right:-0.65em;min-width:1.2em;padding:0 0.25em;text-align:center;
                background:#fbf9f4;color:${low ? THEME.bad : THEME.text};border:1px solid ${THEME.border};
                border-radius:0.7em;font-size:0.6em;font-weight:700;line-height:1.5;
                box-shadow:0 1px 2px rgba(0,0,0,.2);">${bank[r]}</span>
        </span>
      </span>`;
    };
    const head = tableHead(uiState.resOrder.map(iconCell).join(''), TABLE_GRID, HEAD_PAD_TOP);
    if (state.players.size === 0) return head + EMPTY_ROW();
    const { players, prof } = panelOrderedPlayers();
    const pipMap = currentPipMap();
    return head + players.map((p) => {
      const active = p.name === state.currentTurn;
      const actCls = active ? 'cst-active-cell' : '';
      const pm = (uiState.pipPlayers.includes(p.name) && pipMap) ? pipMap[wsColorOf(p.name)] : null;   // pips only for selected names
      const cells = nameCell(p, prof, active, pipMap) +
        uiState.resOrder.map((r) => {
          const m = cellMark(p.name, r);   // column highlight is a pinned overlay band, not a per-cell bg
          if (r === 'unknown') {
            return `<span data-res="unknown"${m.a} class="${actCls}" style="text-align:center;border-radius:5px;font-variant-numeric:tabular-nums;cursor:pointer;color:${p.unknown ? THEME.accent : THEME.textDim};${p.unknown ? '' : 'opacity:.4;'}${m.bg}">${p.unknown}</span>`;
          }
          // C(c): per-resource pips tucked into the cell's bottom-right corner.
          const pipV = pm ? pm.byRes[RESOURCES.indexOf(r) + 1] : 0;
          const pipExp = uiState.pipMode === 'expected';
          const pipTxt = pipExp ? pipV.toFixed(1) : String(pipV);
          const pipCorner = (pipExp ? pipV >= 0.05 : pipV > 0)
            ? `<span data-pip="${pipTxt}" style="position:absolute;right:5px;bottom:3px;font-size:0.55em;line-height:1;font-weight:700;color:${THEME.accent};opacity:.7;pointer-events:none;">${pipTxt}</span>` : '';
          return `<span data-res="${r}"${m.a} class="${actCls}" style="position:relative;text-align:center;border-radius:5px;font-variant-numeric:tabular-nums;cursor:pointer;${p.resources[r] === 0 ? `color:${THEME.textDim};opacity:.4;` : ''}${m.bg}">${p.resources[r]}${pipCorner}</span>`;
        }).join('');
      return rowShell(p, active, cells, TABLE_GRID);
    }).join('');
  }

  // An opponent's name in their own game colour, bold (reused across hovers).
  function nameB(who) {
    const p = state.players.get(who);
    return `<b style="color:${escapeAttr((p && p.color) || THEME.accent)};">${escapeHtml(who)}</b>`;
  }

  // Per-opponent knight/robber lines — biggest first. The localized template is
  // escaped FIRST, then {who}/{n} are swapped for our markup, so the name
  // styling survives any word order ("from {who} ×{n}" / "被 {who} 偷 ×{n}").
  function knightLines(map, tplKey, tplDefault) {
    const tpl = escapeHtml(t(tplKey, tplDefault));
    return Object.entries(map || {})
      .filter(([, c]) => c > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([who, c]) =>
        `<span style="white-space:nowrap;">${tpl.split('{who}').join(nameB(who)).split('{n}').join(c)}</span>`);
  }

  const MONO = '#8a67c2';   // matches the stats-column violet (rgb 138,103,194)
  // Monopoly lines, kept visually distinct (🎺, violet): what THIS player took
  // (side 'took', map {res:n}) or lost to others (side 'lost', map {thief:{res:n}}).
  function monoLines(name, side) {
    const ty = state.tally[name] || {};
    const lab = escapeHtml(t('monoLabel', 'Mono'));
    if (side === 'took') {
      return Object.entries(ty.monoTook || {}).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1])
        .map(([res, n]) => `<span style="white-space:nowrap;color:${MONO};">🎺 ${lab} ${iconImg(res, 1.15)}×${n}</span>`);
    }
    const out = [];
    for (const [who, byRes] of Object.entries(ty.monoLost || {})) {
      for (const [res, n] of Object.entries(byRes)) {
        if (n > 0) out.push(`<span style="white-space:nowrap;color:${MONO};">🎺 ${lab} ${iconImg(res, 1.15)}×${n} ${escapeHtml(t('byWord', 'by'))} ${nameB(who)}</span>`);
      }
    }
    return out;
  }

  // Footer for the Cards-lost hover: how many 7s have been rolled and by whom
  // (the 7s that drive the robber). Global, so it reads the same on any row.
  function sevensFooterHTML() {
    const total = state.diceCounts[7] || 0;
    if (!total) return '';
    // Just the count — per-roller attribution was dropped by request (the
    // sevenRollers tally is still kept for any future use).
    const head = escapeHtml(t('sevensRolled', '7s rolled: {n}', { n: total }));
    return `<span style="margin-top:2px;padding-top:2px;border-top:1px solid ${THEME.border};color:${THEME.textDim};white-space:nowrap;">🎲 ${head}</span>`;
  }

  // Combined steal report for a Stats cell: knight breakdown + Monopoly lines,
  // plus (on the lost side) the 7s footer. side = 'stole' | 'lost'.
  // One line for the knight-steal RESOURCE breakdown (WS 14/15 — the DOM log can't
  // see stolen card types): "⚔️ 🌾×2 🪨×1", biggest first.
  function resStealLine(byRes, emoji) {
    const parts = Object.entries(byRes || {}).filter(([, n]) => n > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([res, n]) => `${iconImg(res, 1.15)}×${n}`);
    if (!parts.length) return '';
    return `<span style="white-space:nowrap;display:inline-flex;align-items:center;gap:4px;">${emoji} ${parts.join(' ')}</span>`;
  }

  function stealReportHTML(name, side) {
    const ty = state.tally[name] || {};
    let lines;
    if (side === 'stole') {
      lines = [resStealLine(ty.stoleRes, '⚔️')].filter(Boolean)
        .concat(knightLines(ty.stoleFrom, 'stoleFromItem', 'from {who} ×{n}')).concat(monoLines(name, 'took'));
    } else {
      lines = [resStealLine(ty.lostRes, '💔')].filter(Boolean)
        .concat(knightLines(ty.lostTo, 'lostByItem', 'stolen by {who} ×{n}')).concat(monoLines(name, 'lost'));
      const f = sevensFooterHTML();
      if (f) lines.push(f);
    }
    if (!lines.length) return '';
    return `<span style="display:flex;flex-direction:column;gap:2px;">${lines.join('')}</span>`;
  }

  // Close the previous dice round: freeze each blocked tile (roundBlocks) together
  // with how much each player actually got that round, as a blockEvent. The loss is
  // DERIVED later in blockLossOf, so backfill still holds. One event per (roll,res)
  // per round (the robber sits on one tile; guard against duplicate log lines).
  // Triggered by the next roll (round change) and the winner line (final round).
  function settleRound() {
    if (state.roundBlocks.length) {
      const seen = new Set();
      for (const b of state.roundBlocks) {
        const dedupe = b.roll + '|' + b.res;
        if (seen.has(dedupe)) continue;
        seen.add(dedupe);
        const got = {};
        for (const [pname, rg] of Object.entries(state.roundGot)) got[pname] = rg[b.res] || 0;
        state.blockEvents.push({ roll: b.roll, res: b.res, got });
      }
    }
    state.roundBlocks = [];
    state.roundGot = {};
  }

  // Cards a player would have collected but didn't, because the robber sat on a
  // tile they build on. DERIVED (never accumulated): per blocked-round event, the
  // loss is max(0, that player's learned per-number yield − what they actually got
  // that round). Differential by design — an un-blocked owner of the same number
  // has got == expected → 0, so we never over-count across players; the robber only
  // blocks one tile, so a multi-tile owner loses just the missing tile's worth.
  // produces is read at call time, so a tile blocked before its number warmed up is
  // credited retroactively once the yield is learned (backfill).
  // colonist's Victory → Overview table prints the EXACT cards-blocked per player
  // (the stat_resource_income_blocked column). Read it by that stable asset name
  // (hash-tolerant), mapping each player's value-row cell at the blocked column.
  // The board is canvas, so this end-of-game table is the only authoritative
  // source — the live differential can't see a tile's build count at robber time.
  function readEndgameBlocked() {
    const blk = [...document.querySelectorAll('img')]
      .find((im) => (im.getAttribute('src') || '').includes('stat_resource_income_blocked'));
    if (!blk) return null;
    const header = blk.parentElement && blk.parentElement.parentElement; // headerContainer
    if (!header) return null;
    const col = [...header.children].indexOf(blk.parentElement);         // blocked column index
    if (col < 0) return null;
    const right = header.parentElement;                                  // header + value rows
    const tab = right && right.parentElement;                            // tabContent
    if (!tab) return null;
    const valueRows = [...right.children].filter((c) => c !== header);
    // The left block (same tabContent) lists the player names in the same order.
    let left = null;
    for (const child of tab.children) {
      if (child !== right && child.querySelector('[class*="name-"]')) { left = child; break; }
    }
    if (!left) return null;
    const names = [...left.querySelectorAll('[class*="name-"]')].map((n) => (n.textContent || '').trim());
    if (!names.length || names.length !== valueRows.length) return null; // shape changed — don't guess
    const out = {};
    valueRows.forEach((row, i) => {
      const cell = row.children[col];
      const v = cell ? parseInt((cell.textContent || '').trim(), 10) : NaN;
      if (names[i] && Number.isFinite(v)) out[names[i]] = v;
    });
    return Object.keys(out).length ? out : null;
  }

  // Capture the exact values into state (so blockLossOf returns them everywhere).
  function syncEndgameBlocked() {
    const m = readEndgameBlocked();
    if (!m) return false;
    state.endgameBlocked = m;
    state.endgameBlockedGid = (wsBoard && wsBoard.gameId != null) ? wsBoard.gameId : null;
    return true;
  }

  function blockLossOf(name) {
    // Source of truth, in order:
    //  1. colonist's exact end-game figure, once the Victory table is captured.
    //  2. the WS GEOMETRY total — read LIVE from the board (which self-resets per
    //     gameSettings.id) and carried across F5 by the persisted blocked snapshot
    //     restored INTO the board. Promoted after the 1.85 corner-formula fix; it
    //     beats the log differential (which over-counts when a tile was robbed while
    //     you held fewer buildings than you later grew to). Only trusted once the
    //     geometry is actually usable — a type-4 with real tiles+corners, not a shell.
    //  3. the log differential, before the board's geometry is ready.
    if (state.endgameBlocked && state.endgameBlocked[name] != null) return state.endgameBlocked[name];
    if (wsBoard && __cstBoard.ready(wsBoard) && __cstBoard.geomReady(wsBoard)) {
      const color = wsColorOf(name);
      if (color != null) return __cstBoard.blockedLossOf(wsBoard, color);
    }
    return estimateBlockLoss(name);
  }

  // The board can't replay past robber positions after an F5, so its live blocked-loss
  // is persisted (a snapshot tagged with the game id) and restored INTO the board on
  // reload — a same-game reconnect keeps it; a different game's full state drops it.
  // `blockedSnap` is the last durable snapshot; it's refreshed from the board whenever
  // the board is ready and written the instant a block lands (blocks are rare), so no
  // tick/persist-debounce/F5 window can ever drop one.
  let blockedSnap = null;
  function currentBlockedSnap() {
    if (wsBoard && __cstBoard.ready(wsBoard)) blockedSnap = __cstBoard.blockedSnapshot(wsBoard);
    return blockedSnap;
  }
  function totalBlocked() {
    if (!wsBoard || !wsBoard.blockedLoss) return 0;
    let s = 0;
    for (const k of Object.keys(wsBoard.blockedLoss)) s += wsBoard.blockedLoss[k] || 0;
    return s;
  }

  // The log-only estimate (endgame-exact when captured, else the differential).
  // Kept as the oracle / fallback during the WS migration.
  function estimateBlockLoss(name) {
    // Once colonist's authoritative end-of-game number is captured, it wins.
    if (state.endgameBlocked && state.endgameBlocked[name] != null) return state.endgameBlocked[name];
    const ty = state.tally[name] || {};
    const prod = ty.produces || {};
    let total = 0;
    for (const ev of state.blockEvents || []) {
      const expected = (prod[ev.roll] && prod[ev.roll][ev.res]) || 0;
      const got = (ev.got && ev.got[name]) || 0;
      total += Math.max(0, expected - got);
    }
    return total;
  }

  // Hover for the ⛔ cell: one line per "N res ×times = cards", biggest first. Drawn
  // from the SAME geometry as the headline when the board is ready (so the breakdown
  // always sums to the displayed number); falls back to the log differential's
  // breakdown only before the board's geometry is up.
  function blockReportHTML(name) {
    const rows = [];
    const color = wsColorOf(name);
    if (wsBoard && __cstBoard.ready(wsBoard) && __cstBoard.geomReady(wsBoard) && color != null) {
      const detail = __cstBoard.blockedDetailOf(wsBoard, color);   // { 'roll|type': {roll, res:tileType, times, cards} }
      for (const k of Object.keys(detail)) {
        const e = detail[k];
        if (e.cards > 0) rows.push({ num: e.roll, res: RESOURCES[e.res - 1], times: e.times, cards: e.cards });
      }
    } else {
      const ty = state.tally[name] || {};
      const prod = ty.produces || {};
      const agg = {};
      for (const ev of state.blockEvents || []) {
        const lost = Math.max(0, ((prod[ev.roll] && prod[ev.roll][ev.res]) || 0) - ((ev.got && ev.got[name]) || 0));
        if (lost <= 0) continue;                    // not this player's tile / no loss
        const k = ev.roll + ' ' + ev.res;
        (agg[k] || (agg[k] = { num: ev.roll, res: ev.res, times: 0, cards: 0 }));
        agg[k].times += 1;
        agg[k].cards += lost;
      }
      for (const k of Object.keys(agg)) rows.push(agg[k]);
    }
    rows.sort((a, b) => b.cards - a.cards);
    const header = escapeHtml(t('blockReportTitle', 'Cards blocked'));
    // Keep the hover consistent with the headline: show the breakdown when it sums to
    // the displayed number; if the headline came from a Victory correction the
    // geometry breakdown doesn't match, show just the exact total (Victory carries no
    // per-roll detail, so a stale breakdown would contradict it).
    const headline = blockLossOf(name);
    const sum = rows.reduce((acc, r) => acc + r.cards, 0);
    let body;
    if (rows.length && sum === headline) {
      body = rows.map((r) =>
        `<span style="white-space:nowrap;display:inline-flex;align-items:center;gap:3px;">` +
        `${iconImg(r.res, 1.15)} <b>${r.num}</b> ×${r.times} = ${r.cards}</span>`).join('');
    } else if (headline > 0) {
      body = `<span style="white-space:nowrap;">= ${headline}</span>`;
    } else {
      return '';
    }
    return `<span style="display:flex;flex-direction:column;gap:2px;">` +
      `<b style="margin-bottom:1px;">${header}</b>${body}</span>`;
  }

  // The 🗑 hover: which resources were discarded (rolled-7 over-limit), headed by
  // the number of discard events. Fed by the WS type-55 cardEnums breakdown.
  function discReportHTML(name) {
    const ty = state.tally[name] || {};
    const res = ty.discardRes || {};
    const lines = RESOURCES.filter((r) => res[r] > 0).map((r) =>
      `<span style="white-space:nowrap;display:inline-flex;align-items:center;gap:2px;">${iconImg(r, 1.2)}×${res[r]}</span>`);
    if (!lines.length) return '';
    const header = escapeHtml(t('discardEvents', '{n} discard events', { n: ty.discards || 0 }));
    return `<span style="display:flex;flex-direction:column;gap:3px;"><b>${header}</b>` +
      `<span style="display:flex;flex-wrap:wrap;gap:3px 8px;color:${THEME.textDim};">${lines.join('')}</span></span>`;
  }

  // Average turn length for a player, compactly: "23s" or "1:05" past a minute.
  function turnAvgText(ty) {
    if (!ty || !ty.turns) return '–';
    const sec = Math.round(ty.turnMs / ty.turns / 1000);
    if (sec < 60) return `${sec}s`;
    return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  }

  // Per-opponent trade flow: one line per opponent (most-fed first) showing what
  // this player gave them and got back — "→ Who N / ← M" — names in game colour.
  function tradeBreakdownHTML(name) {
    const ty = state.tally[name] || {};
    const gave = ty.tradeGave || {}, got = ty.tradeGot || {};
    const who = new Set([...Object.keys(gave), ...Object.keys(got)]);
    if (!who.size) return '';
    const lines = [...who]
      .sort((a, b) => (gave[b] || 0) - (gave[a] || 0))
      .map((opp) => {
        return `<span style="white-space:nowrap;">${nameB(opp)} ` +
          `<span style="color:#9c3018;">→${gave[opp] || 0}</span> ` +
          `<span style="color:#1f6b1f;">←${got[opp] || 0}</span></span>`;
      });
    const header = escapeHtml(t('tradeFlowTitle', 'Trade flow (→ fed · ← got)'));
    return `<span style="display:flex;flex-direction:column;gap:2px;">` +
      `<b style="margin-bottom:1px;">${header}</b>${lines.join('')}</span>`;
  }

  // Hover content for the gained-cards cell: a small pie of the per-resource
  // income (conic-gradient — no SVG arc math) + a count legend.
  function gainPieHTML(name) {
    const ty = state.tally[name] || {};
    const res = ty.gainedRes || {};
    const total = RESOURCES.reduce((s, r) => s + (res[r] || 0), 0);
    if (!total) return '';
    let acc = 0;
    const slices = [];
    const legend = [];
    for (const r of RESOURCES) {
      const n = res[r] || 0;
      if (!n) continue;
      const from = (acc / total) * 360;
      acc += n;
      const to = (acc / total) * 360;
      slices.push(`rgb(${RES_HL[r]}) ${from.toFixed(1)}deg ${to.toFixed(1)}deg`);
      // Same colonist card art as the Resources header — one icon language.
      legend.push(`<span style="white-space:nowrap;display:inline-flex;align-items:center;gap:2px;">${iconImg(r, 1.25)}×${n}</span>`);
    }
    return `<div style="display:flex;align-items:center;gap:10px;">` +
      `<span style="flex:0 0 auto;width:52px;height:52px;border-radius:50%;` +
      `background:conic-gradient(${slices.join(',')});box-shadow:inset 0 0 0 1px rgba(0,0,0,.12);"></span>` +
      `<span style="display:flex;flex-direction:column;gap:2px;">` +
      `<b>${escapeHtml(t('tipGainBreakdown', '{n} cards gained', { n: total }))}</b>` +
      `<span style="display:flex;flex-wrap:wrap;gap:2px 8px;color:${THEME.textDim};">${legend.join('')}</span>` +
      `</span></div>`;
  }

  function renderStatsView() {
    // The font-size lives on an INNER span: putting it on the cell itself would
    // scale the em-based HEAD_SLOT height with it, making the Stats header
    // taller than the Resources one (the height-jump bug).
    const head = tableHead(uiState.statOrder.map((key) => {
      const c = COL_BY_KEY[key];
      return `<span data-res="${c.key}" data-colhead="1" data-tip="${c.tip}" style="${HEAD_SLOT}border-radius:5px;cursor:grab;">` +
        `<span style="font-size:2.15em;line-height:1;display:inline-flex;align-items:center;">${statIconHTML(c)}</span></span>`;
    }).join(''), TABLE_GRID, HEAD_PAD_TOP);
    if (state.players.size === 0) return head + EMPTY_ROW();
    const { players, prof } = panelOrderedPlayers();
    const pipMap = currentPipMap();
    const rows = players.map((p) => {
      const active = p.name === state.currentTurn;
      const actCls = active ? 'cst-active-cell' : '';
      const ty = state.tally[p.name] || {};
      const stoleN = ty.stole || 0;
      const hasStole = stoleN > 0 || (ty.stoleFrom && Object.keys(ty.stoleFrom).length) ||
        (ty.monoTook && Object.keys(ty.monoTook).length);
      const bl = blockLossOf(p.name);
      const hasBlock = bl > 0;
      const hasLost = (ty.lostTo && Object.keys(ty.lostTo).length) ||
        (ty.monoLost && Object.keys(ty.monoLost).length) || (state.diceCounts[7] > 0);
      const hasDisc = ty.discardRes && Object.keys(ty.discardRes).length;
      const vals = {
        's-block': { v: bl, bd: hasBlock ? 'block' : null },
        's-lost':  { v: ty.lost || 0, bd: hasLost ? 'lost' : null },
        's-disc':  { v: ty.discardCards || 0, bd: hasDisc ? 'disc' : null,
          tip: (!hasDisc && ty.discards) ? t('discardEvents', '{n} discard events', { n: ty.discards }) : '' },
        's-gain':  { v: ty.gained || 0, pie: ty.gained ? p.name : null },
        's-turn':  { v: ty.turns || 0, disp: ty.turns ? turnAvgText(ty) : '–',
          tip: ty.turns ? t('tipTurnAvg', 'Average over {n} timed turns', { n: ty.turns }) : '' },
        's-stolen': { v: stoleN, bd: hasStole ? 'stole' : null },
      };
      const cells = nameCell(p, prof, active, pipMap) + uiState.statOrder.map((key) => {
        const c = COL_BY_KEY[key];
        const { v, disp, tip, pie, bd } = vals[c.key];
        const m = cellMark(p.name, c.key);
        return `<span data-res="${c.key}"${m.a} class="${actCls}" ` +
          `${pie ? `data-pie="${escapeHtml(pie)}" ` : ''}` +
          `${bd ? `data-bd="${escapeHtml(p.name)}|${bd}" ` : ''}` +
          `${tip ? `data-tip="${escapeHtml(tip)}" ` : ''}` +
          `style="text-align:center;border-radius:5px;font-variant-numeric:tabular-nums;cursor:pointer;${v ? '' : `color:${THEME.textDim};opacity:.4;`}${m.bg}">${disp != null ? escapeHtml(disp) : v}</span>`;
      }).join('');
      return rowShell(p, active, cells, TABLE_GRID);
    }).join('');
    // (The robber-blocked breakdown line was dropped by request — the events
    // are still tallied and archived per game, just not displayed here.)
    return head + rows;
  }

  function renderResTable() {
    return uiState.resView === 'stats' ? renderStatsView() : renderCardsView();
  }

  // ---- game-style floating "+N" / "−N" over changed resource cells ----
  // lastCounts is the per-player snapshot from the previous render; null means
  // "don't float on the next render" (set after reset/restore/deep re-scrape,
  // where diffing from scratch would shower the panel in floats).
  let lastCounts = null;
  function countsSnapshot() {
    const snap = {};
    for (const p of state.players.values()) {
      const t = state.tally[p.name] || {};
      snap[p.name] = {
        lumber: p.resources.lumber, brick: p.resources.brick, wool: p.resources.wool,
        grain: p.resources.grain, ore: p.resources.ore, unknown: p.unknown,
        's-block': blockLossOf(p.name), 's-lost': t.lost || 0, 's-disc': t.discardCards || 0,
        's-gain': t.gained || 0,
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
    // Only the columns of the CURRENT view get floats (the other view's cells
    // aren't in the DOM). In the stats view, an INCREASE of lost/discarded is
    // bad news — colour by what the change means, not by its sign.
    // Follow the rendered per-view order (statOrder/resOrder) so the float key
    // set never drifts from the columns actually on screen; each float still
    // locates its cell by data-res below, so the order itself is incidental.
    const keys = uiState.resView === 'stats' ? uiState.statOrder : uiState.resOrder;
    const BAD_UP = { 's-block': true, 's-lost': true, 's-disc': true };
    // A player absent from the previous snapshot is treated as a zero baseline:
    // players are always created at 0 cards, so their first gain is a real +N.
    // (This is why the snake-draft pivot — created and gaining within one render
    // window, never separately snapshotted at 0 — used to be skipped.) The +N
    // "shower" after a reset/restore/deep-rescrape is prevented by the
    // `if (!prev) return` guard above, NOT by skipping new rows here.
    const ZERO = { lumber: 0, brick: 0, wool: 0, grain: 0, ore: 0, unknown: 0,
      's-block': 0, 's-lost': 0, 's-disc': 0, 's-gain': 0 };
    for (const [name, cur] of Object.entries(lastCounts)) {
      const old = prev[name] || ZERO;
      const row = rows.find((el) => el.getAttribute('data-prow') === name);
      if (!row) continue;
      for (const k of keys) {
        const d = cur[k] - old[k];
        if (!d) continue;
        const cell = row.querySelector(`[data-res="${k}"]`);
        if (!cell) continue;
        const cr = cell.getBoundingClientRect();
        const good = BAD_UP[k] ? d < 0 : d > 0;
        const f = document.createElement('span');
        f.textContent = (d > 0 ? '+' : '−') + Math.abs(d);
        f.style.cssText = 'position:absolute;z-index:3;pointer-events:none;' +
          `left:${cr.left - wr.left + cr.width / 2}px;top:${cr.top - wr.top}px;` +
          'transform:translate(-50%,0);font-size:1.12em;font-weight:900;line-height:1;' +
          `color:${good ? '#1f6b1f' : '#9c3018'};` +
          'text-shadow:0 0 3px rgba(255,255,255,.95), 0 1px 2px rgba(255,255,255,.9);' +
          'opacity:1;transition:transform .75s ease-out, opacity .75s ease-out;';
        wrap.appendChild(f);
        void f.offsetHeight;                    // start the drift-up + fade
        f.style.transform = 'translate(-50%,-1.35em)';
        f.style.opacity = '0';
        setTimeout(() => f.remove(), 800);
      }
    }
  }

  function render() {
    if (!panel) return;
    discardCap = discardLimit();   // refresh once; nameCell reads it per row
    const d = panel.querySelector('#cst-dice');
    if (d) d.innerHTML = renderDiceBars();
    const r = panel.querySelector('#cst-resources');
    if (r) r.innerHTML = renderResTable();
    spawnGainFloats();
    const rolls = panel.querySelector('#cst-dice-rolls');
    if (rolls) {
      let html = escapeHtml(t('rollsCount', '{n} rolls', { n: state.totalRolls }));
      const chi = chiSquare();
      const tier = luckTier(chi);
      if (tier) {
        // A readable fairness badge (⚖️ + word) instead of a raw χ² number; the
        // statistic + scale live in the hover for the curious.
        const LUCK = {
          fair:       { label: t('luckFair', 'fair dice'),   color: THEME.good },
          skewed:     { label: t('luckSkewed', 'skewed'),    color: '#b5730a' },
          verySkewed: { label: t('luckVerySkewed', 'very skewed'), color: THEME.bad },
        }[tier];
        const tip = escapeHtml(t('tipLuck',
          'Dice fairness χ²={x} over {n} rolls (fair ≈10; over 18.3 skewed p<.05; over 23.2 very skewed p<.01)',
          { x: chi.toFixed(1), n: state.totalRolls }));
        html += ` <span data-tip="${tip}" style="white-space:nowrap;font-weight:700;font-size:0.92em;` +
          `color:${LUCK.color};background:${LUCK.color}1f;border-radius:0.7em;padding:0 0.5em;">` +
          `⚖️ ${escapeHtml(LUCK.label)}</span>`;
      }
      const cold = coldestSum();
      if (cold) {
        const tip = escapeHtml(t('tipColdSum',
          '{n} hasn’t come up in {k} rolls (~{x}× its usual gap)',
          { n: cold.n, k: cold.k, x: cold.factor.toFixed(1) }));
        html += ` <span data-tip="${tip}" style="color:#3d7fb0;font-weight:700;white-space:nowrap;">` +
          `❄️ ${cold.n} <span style="opacity:.7;font-weight:600;">${cold.k}</span></span>`;
      }
      rolls.innerHTML = html;
    }
    updateTimer();
    refreshPinnedCols();   // re-place the pinned column bands over the new column rects
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
      runPostureGhost();   // 1s fallback; the MutationObserver reacts much faster
      // colonist sometimes REPLACES the log container node (reconnect /
      // re-render). Re-discover it every tick — otherwise the observer keeps
      // watching a detached node and updates silently stop. attachObserver()
      // is a cheap no-op while the container is unchanged.
      if (!rescraping) attachObserver();   // stays outside the gate — detects the "play again" container in ENDED
      // The MutationObserver already catches live row additions; this per-tick
      // full re-scan + panel reconcile is only a fallback for the *recycling*
      // virtual list, which can only change during play. Skipping it once the
      // game has ENDED (or in the lobby) drops the largest sustained per-tick cost.
      if (lifecycle === LIFE.PLAYING) {
        if (observedContainer && observedContainer.isConnected) scanExisting(observedContainer);
        // Prefer the WebSocket hands when the board is ready; else the DOM panel.
        let synced;
        if (wsBoard && __cstBoard.ready(wsBoard)) {
          synced = syncFromWS();
          if (syncStatsFromWS()) synced = true;
          if (syncDiceFromWS()) synced = true;
        } else {
          synced = syncFromPanel();
        }
        if (synced) renderSoon();
      } else if (lifecycle === LIFE.ENDED) {
        if (!auditPrinted) { auditPrinted = true; try { console.log(buildAuditReport()); } catch (e) { /* ignore */ } }
        // The Victory table can render a beat after the winner log line, so the
        // capture in buildGameRecord may have been too early. Keep trying until
        // we have colonist's exact ⛔, then refresh the panel + the saved record.
        if (!state.endgameBlocked && syncEndgameBlocked()) { resaveEndgameBlockLoss(); persistState(); renderSoon(); }
      }
    }, 1000);

    // Timer display on its own faster cadence. The elapsed math is absolute
    // (Date.now() - gameStartTs), so the clock is never wrong — but pinning the
    // redraw to the 1s tick means a throttled tick makes the seconds visibly
    // skip (1:12 -> 1:14). A cheap 250ms repaint keeps it smooth without
    // touching the heavy scan/reconcile work. Paused freezes it, same as before.
    setInterval(() => {
      if (state.paused) return;
      updateTimer();
    }, 250);

  }

  // New-game detection state: the live-roster signature of the game we're tracking,
  // and the previous tick's live roster (so a roster change must settle before we act).
  let gameSig = '';
  let lastLiveSig = '';
  // gameSig and lastLiveSig move together everywhere EXCEPT maybeNewGame's
  // "new game settled" branch (which sets gameSig but tracks lastLiveSig to the
  // live tick). This helper makes the paired writes explicit.
  function setGameSig(sig) { gameSig = sig; lastLiveSig = sig; }

  // Reset all tracked stats. Shared by new-game detection, the panel, and tests.
  function resetState() {
    for (const k of Object.keys(state.diceCounts)) state.diceCounts[k] = 0;
    state.totalRolls = 0;
    state.sevenRollers = {};
    state.discardLimitValue = 0;
    state.players.clear();
    state.seenIndices = new Set();
    state.selfName = null;
    selfLocked = false;
    state.paused = false;
    state.rollHistory = [];
    state.currentTurn = null;
    state.lastRoller = null;
    state.lastRollTs = null;
    state.gameStartTs = Date.now(); // a reset = a new game begins now
    state.gameEndTs = null;
    state.tally = {};
    state.blocked = { count: 0, byKey: {} };
    state.blockEvents = [];
    state.roundGot = {};
    state.roundBlocks = [];
    state.endgameBlocked = null;
    state.endgameBlockedGid = null;
    blockedSnap = null;   // drop the previous game's persisted blocked snapshot
    // NOTE: the WS board is NOT reset from here. It self-manages via gameSettings.id
    // in applyFullState (a new id clears the accruals the instant the new board's full
    // state arrives). Resetting it from this DOM lifecycle — which fires ~1s LATER —
    // would wipe accruals the full state already loaded for the new game.
    uiState.pipPlayers = [];   // a new roster clears the pip selection
    lastRoll = null;
    setGameSig('');
    lastCounts = null;  // don't shower "+N" floats diffing against the old game
    auditPrinted = false;
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
        sevenRollers: state.sevenRollers,
        discardLimitValue: state.discardLimitValue,
        currentTurn: state.currentTurn,
        gameStartTs: state.gameStartTs,
        gameEndTs: state.gameEndTs,
        tally: state.tally,
        blocked: state.blocked,
        blockEvents: state.blockEvents,
        endgameBlocked: state.endgameBlocked,
        endgameBlockedGid: state.endgameBlockedGid,
        wsBlockedBoard: currentBlockedSnap(),   // the WS board's blocked-loss + game id, restored INTO the board on reload
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
    state.sevenRollers = (d.sevenRollers && typeof d.sevenRollers === 'object') ? d.sevenRollers : {};
    state.discardLimitValue = Number.isFinite(d.discardLimitValue) ? d.discardLimitValue : 0;
    state.currentTurn = d.currentTurn || null;
    state.gameStartTs = Number.isFinite(d.gameStartTs) ? d.gameStartTs : null;
    state.gameEndTs = Number.isFinite(d.gameEndTs) ? d.gameEndTs : null;
    state.tally = (d.tally && typeof d.tally === 'object') ? d.tally : {};
    state.blocked = (d.blocked && typeof d.blocked === 'object')
      ? { count: d.blocked.count || 0, byKey: d.blocked.byKey || {} }
      : { count: 0, byKey: {} };
    state.blockEvents = Array.isArray(d.blockEvents) ? d.blockEvents : [];
    state.endgameBlocked = (d.endgameBlocked && typeof d.endgameBlocked === 'object') ? d.endgameBlocked : null;
    state.endgameBlockedGid = (d.endgameBlockedGid != null) ? d.endgameBlockedGid : null;
    // Restore the WS board's blocked-loss INTO the board (it can't replay history).
    // Tagged with the game id, so applyFullState drops it if a DIFFERENT game loads.
    blockedSnap = (d.wsBlockedBoard && typeof d.wsBlockedBoard === 'object') ? d.wsBlockedBoard : null;
    if (blockedSnap && wsBoard && __cstBoard.restoreBlocked) __cstBoard.restoreBlocked(wsBoard, blockedSnap);
    state.roundGot = {};      // round-internal scratch — restart cleanly on restore
    state.roundBlocks = [];
    state.selfName = d.selfName || null;
    state.seenIndices = new Set(d.seenIndices || []);
    state.players = new Map();
    for (const p of d.players) {
      const res = p.resources || {};
      state.players.set(p.name, {
        name: p.name,
        color: p.color || '#888',
        unknown: p.unknown || 0,
        resources: Object.fromEntries(RESOURCES.map((r) => [r, res[r] || 0])),
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
      setGameSig(liveSig);
      return;
    }

    // A different roster, stable for one tick, means a new game.
    if (liveSig !== gameSig && liveSig === lastLiveSig) {
      startNextGame();
      gameSig = liveSig;
    }
    lastLiveSig = liveSig;
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

  // The winner line ("X won the game!") was seen: freeze the clock, archive the
  // finished game, and get out of the way so the end screen is fully clickable.
  function onGameWon(winnerName) {
    // A deep re-scrape replays the log while lifecycle stays ENDED; the replayed
    // winner line must still settle the final round (no trailing roll follows it),
    // even though the record itself isn't rebuilt here.
    if (lifecycle === LIFE.ENDED) { settleRound(); return; }
    lifecycle = LIFE.ENDED;
    state.gameEndTs = Date.now();
    saveGameRecord(buildGameRecord(winnerName || null));
    autoSetCollapsed(true);
    schedulePersist();
    renderSoon();
  }

  // ---- per-game history (chrome.storage.local; viewed from the popup) ----
  const HISTORY_KEY = 'cst-history';
  const HISTORY_MAX = 50;

  // A self-contained snapshot of the finished game — everything the popup's
  // history list needs, with no references back into live state.
  function buildGameRecord(winnerName) {
    settleRound();   // the winner line has no "next roll" — settle the final round here
    syncEndgameBlocked();   // snap ⛔ to colonist's exact Victory-table values (if shown)
    // The geometry audit is NOT force-settled at game end: the final roll's type-47 may
    // not have relayed before the winner line, and settling a non-empty prediction
    // against an empty actual would manufacture a false ✗. The record carries the
    // COMMITTED verdicts (each roll settled by the following one); the last roll is left
    // uncounted rather than risk a spurious conflict in the archive.
    const au = (wsBoard && __cstBoard.auditOf) ? __cstBoard.auditOf(wsBoard) : null;
    return {
      date: state.gameStartTs || Date.now(),
      duration: (state.gameEndTs && state.gameStartTs)
        ? state.gameEndTs - state.gameStartTs : null,
      winner: winnerName || null,
      selfName: state.selfName,
      totalRolls: state.totalRolls,
      diceCounts: { ...state.diceCounts },
      players: [...state.players.values()].map((p) => ({
        name: p.name, color: p.color, hand: { ...p.resources }, unknown: p.unknown,
      })),
      tally: JSON.parse(JSON.stringify(state.tally)),
      blocked: JSON.parse(JSON.stringify(state.blocked)),
      blockEvents: JSON.parse(JSON.stringify(state.blockEvents)), // audit / future re-derivation
      blockLoss: [...state.players.keys()].reduce((m, n) => {
        m[n] = blockLossOf(n); return m;
      }, {}),
      // geometry self-audit summary for this game — evidence the corner→tile geometry
      // (and the blocked-loss it feeds) held up against colonist's actual production.
      geomAudit: au ? { confirms: au.confirms, conflicts: au.conflicts, skipped: au.skipped || 0,
        conflictSamples: (au.trail || []).filter((t) => !t.ok).slice(-5) } : null,
    };
  }

  function saveGameRecord(record) {
    try {
      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
      chrome.storage.local.get([HISTORY_KEY], (data) => {
        const list = Array.isArray(data && data[HISTORY_KEY]) ? data[HISTORY_KEY] : [];
        list.push(record);
        while (list.length > HISTORY_MAX) list.shift();
        chrome.storage.local.set({ [HISTORY_KEY]: list });
      });
    } catch (e) { /* storage unavailable — history is best-effort */ }
  }

  // If the Victory table only became readable AFTER the record was saved (the
  // table lagged the winner line), patch this game's already-stored blockLoss to
  // the now-exact values so the popup history isn't left with the estimate.
  function resaveEndgameBlockLoss() {
    if (!state.endgameBlocked) return;
    try {
      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
      chrome.storage.local.get([HISTORY_KEY], (data) => {
        const list = Array.isArray(data && data[HISTORY_KEY]) ? data[HISTORY_KEY] : [];
        const last = list[list.length - 1];
        if (!last || !state.gameStartTs || last.date !== state.gameStartTs) return;  // only THIS game's record
        last.blockLoss = last.blockLoss || {};
        for (const name of Object.keys(last.blockLoss)) {
          if (state.endgameBlocked[name] != null) last.blockLoss[name] = state.endgameBlocked[name];
        }
        chrome.storage.local.set({ [HISTORY_KEY]: list });
      });
    } catch (e) { /* best-effort */ }
  }

  // A new game is starting (next-game flow / roster change): wipe the previous
  // game's stats, restart the clock (inside resetState) and re-open the panel.
  function startNextGame() {
    resetState();
    clearHighlights();                // the previous game's pins (cells + dice) are stale
    lifecycle = LIFE.PLAYING;
    autoSetCollapsed(false);
    renderSoon();
  }

  // =============================================================
  // Ghost mode — fade out of the way of colonist's TRADE creator
  //
  // Full-screen colonist views (Settings, Leave Game, Pause, end screen) are
  // handled by updateBoardPosture, which COLLAPSES the panel. Ghost mode now only
  // covers the trade creator: a bottom strip that doesn't hide the board centre,
  // so collapsing isn't triggered — instead the panel fades and lets clicks pass
  // through, keeping the trade behind it usable.
  //
  // EDGE-TRIGGERED: it fires only when the trade appears over a stationary panel,
  // NOT when you drag the panel onto an existing trade — in that case the panel
  // stays solid and grabbable where you put it. So the only time the panel goes
  // click-through is when colonist itself covered it, never because you moved it.
  // =============================================================
  const GHOST_OPACITY = '0.18';
  let ghosted = '';            // '' | 'full' | 'light'
  let prevTradeOverlap = false; // did a trade element overlap the panel last tick?
  let lastPanelXY = null;       // panel top-left last tick, to detect dragging

  // Pure decision for the light (trade) tier — unit-tested. Ghost only when the
  // overlap BEGINS over a still panel (trade appeared); keep it once on; never
  // start it just because the panel was dragged onto an existing trade.
  function tradeGhostOn({ over, moved, prevOverlap, alreadyLight }) {
    if (!over) return false;
    if (alreadyLight) return true;
    return !prevOverlap && !moved;
  }

  function elVisible(el) {
    const cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden' &&
      parseFloat(cs.opacity || '1') >= 0.1 ? cs : null;
  }

  // Pure AABB overlap test — shared by dialogOverlapping and tradeOverlapping.
  function rectsOverlap(a, b) {
    return !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom);
  }

  // A colonist dialog/menu overlapping the panel WHILE the board is still visible
  // (the 'full' fade tier) — e.g. the in-game settings menu / a dropdown. (When
  // colonist takes the WHOLE screen the board-canvas centre is gone and
  // updateBoardPosture collapses instead, so this only needs the partial-overlap
  // case.) Class names carry per-deploy hashes, so match stable prefixes.
  function dialogOverlapping(pr) {
    const vw = window.innerWidth, vh = window.innerHeight;
    if (!vw || !vh) return false;
    const cands = document.querySelectorAll(
      '[class*="modal"], [class*="dialog"], [class*="overlay"], [class*="settings"], ' +
      '[class*="menu"], [class*="popover"], [class*="popup"], [class*="drawer"], ' +
      '[role="dialog"], [role="menu"]');
    for (const el of cands) {
      if (el === panel || panel.contains(el) || el.contains(panel)) continue;
      const r = el.getBoundingClientRect();
      if (r.width * r.height < 24000) continue;         // ignore chips / tooltips
      if (!rectsOverlap(r, pr)) continue;
      const cs = elVisible(el);
      if (!cs) continue;
      if (cs.position !== 'fixed' && cs.position !== 'absolute') continue;
      return true;
    }
    return false;
  }

  // Pure tier selection (unit-tested; the overlap probes need a live browser).
  // A collapsed panel is never faded — full-screen colonist views own that case
  // via collapse, so fading the dice icon on top would be the old double-state.
  function ghostKind({ panelCollapsed, dialogOverlap, tradeOn }) {
    if (panelCollapsed) return '';
    if (dialogOverlap) return 'full';   // a dialog/menu supersedes trade tracking
    if (tradeOn) return 'light';
    return '';
  }

  // True only while colonist's TRADE CREATOR is open. Its proposal/actions parts
  // (class `tradeCreatorProposal…` / `tradeCreatorActions…`) exist ONLY when the
  // creator is expanded — unlike the always-present trade button bar and the
  // `gameTradeOffersContainer` reserve, which used to make the panel read as
  // "trade overlapping" forever when parked near the bottom bar (so popping the
  // creator produced no fresh overlap edge → no ghost). Keying off the creator's
  // open-only parts ignores the persistent furniture. (Hashes after the prefix
  // change per colonist deploy, so match the stable prefix.)
  function tradeCreatorOpen() {
    const el = document.querySelector('[class*="tradeCreatorProposal"], [class*="tradeCreatorActions"]');
    return !!(el && elVisible(el));
  }

  // The open trade creator visibly overlapping the panel (the 'light' tier).
  // Only the creator's own parts count — never the always-present bar/offers
  // reserve — so parking the panel over the bottom bar no longer masks the edge.
  function tradeOverlapping(pr) {
    if (!tradeCreatorOpen()) return false;
    for (const el of document.querySelectorAll('[class*="tradeCreator"]')) {
      if (el === panel || panel.contains(el) || el.contains(panel)) continue;
      const r = el.getBoundingClientRect();
      if (r.width * r.height < 4000) continue;          // skip slivers
      if (!rectsOverlap(r, pr)) continue;
      if (!elVisible(el)) continue;
      return true;
    }
    return false;
  }

  function applyGhost(kind) {
    if (kind === ghosted) return;
    ghosted = kind;
    panel.style.transition = 'opacity .2s ease';
    panel.style.opacity = kind ? GHOST_OPACITY : '';
    // Both tiers release the mouse so whatever colonist covered the panel with
    // (dialog OR trade offer) is clickable through it — and the panel's own
    // cells don't light up under the pass-through cursor. The edge-trigger means
    // this only happens when colonist covered the panel, not when you dragged it.
    panel.style.pointerEvents = kind ? 'none' : '';
    setTimeout(() => { if (panel && ghosted === kind) panel.style.transition = ''; }, 220);
  }

  function updateGhost() {
    if (!panel || typeof getComputedStyle !== 'function' || typeof window === 'undefined') return;
    // A finished game (Victory / end screen) must NOT fade the panel: the board is
    // gone so the dialog-overlap probe would read the Victory screen as an overlay and
    // ghost the panel — but this is exactly when the player wants to read the stats
    // against colonist's own Victory table. Keep it solid and clickable.
    if (lifecycle === LIFE.ENDED) { applyGhost(''); return; }
    const pr = panel.getBoundingClientRect();
    const moved = !!lastPanelXY &&
      (Math.abs(pr.left - lastPanelXY.x) > 1 || Math.abs(pr.top - lastPanelXY.y) > 1);
    lastPanelXY = { x: pr.left, y: pr.top };

    // A collapsed panel is never faded (full-screen views own that case) — skip
    // the heavier dialog/trade overlap probes entirely while it's a dice icon.
    if (uiState.panelCollapsed) { prevTradeOverlap = false; applyGhost(''); return; }

    // Two fade tiers for things that overlap the panel WHILE the board is still
    // visible: a dialog/menu (full) and the trade creator (light). Full-screen
    // colonist views (Settings, Leave Game, Pause, end screen) hide the board
    // centre and are COLLAPSED by updateBoardPosture instead — and since this runs
    // AFTER the posture updates, an already-collapsed panel is never faded.
    const over = tradeOverlapping(pr);
    const tradeOn = tradeGhostOn({ over, moved, prevOverlap: prevTradeOverlap, alreadyLight: ghosted === 'light' });
    prevTradeOverlap = over;
    applyGhost(ghostKind({
      panelCollapsed: uiState.panelCollapsed,
      dialogOverlap: dialogOverlapping(pr),
      tradeOn,
    }));
  }

  // ---- Settings posture: collapse the panel out of the way while colonist's
  // full-page Settings is open, restore it on close ----
  // colonist's Settings is an in-place full-page view (no URL change, not a
  // fixed/absolute overlay) under `gameSettingsContainer…` — so it never tripped
  // ghost mode. Since the dashboard's top has nothing to click past, the tidiest
  // behaviour is to COLLAPSE it to the dice icon while Settings is up, then
  // auto-expand on close — but only if WE collapsed it (never fight a panel the
  // user had already collapsed before opening Settings).
  let settingsOpenPrev = false;
  let collapsedForSettings = false;
  function settingsOpen() {
    // colonist keeps the Settings shell (gameSettingsContainer) mounted at full
    // size with full visibility even when closed — it just EMPTIES it. The only
    // thing that changes is whether it has content: 0 children = closed, the
    // settings body mounted = open. (Verified against the live DOM in both
    // states; every style/geometry signal was identical.)
    const el = document.querySelector('[class*="gameSettingsContainer"]');
    return !!(el && el.children.length > 0);
  }
  function updateSettingsPosture(isOpen = settingsOpen()) {
    if (!panel) return;
    if (isOpen === settingsOpenPrev) return;   // edge-triggered, like the lifecycle
    settingsOpenPrev = isOpen;
    if (isOpen) {
      if (!uiState.panelCollapsed) { collapsedForSettings = true; setPanelCollapsed(true); }
    } else if (collapsedForSettings) {
      collapsedForSettings = false;
      if (uiState.panelCollapsed) setPanelCollapsed(false);
    }
  }

  // ---- Board posture: a GENERIC "colonist took over the screen" detector ----
  // The panel sits at the max z-index, so it's always ON TOP of colonist's own
  // UI — which means a pop-up (Leave Game, Pause/Resume, the end screen, any
  // modal) doesn't cover the panel; the panel covers IT. Rather than guess each
  // dialog's (hashed, per-deploy) class, we ask a class-agnostic question: is the
  // live board still showing? colonist renders the board as a <canvas>, and every
  // full-screen view/overlay replaces it with its own DOM. So if the viewport
  // centre is no longer a canvas, colonist is showing something and we collapse
  // out of the way — restoring when the board comes back. Sampling several central
  // points (and peeking UNDER our own panel) avoids false positives from a small
  // transient banner and from the panel itself being over the centre.
  function boardHidden() {
    if (typeof document.elementFromPoint !== 'function') return false;
    const W = window.innerWidth, H = window.innerHeight;
    if (!W || !H) return false;
    const pts = [[0.5, 0.5], [0.35, 0.4], [0.65, 0.4], [0.35, 0.6], [0.65, 0.6]];
    const xy = pts.map(([fx, fy]) => [Math.round(W * fx), Math.round(H * fy)]);
    // Only "peek under" our panel (a forced style recalc) if it actually covers a
    // sample point — normally it's a corner widget clear of the centre, so skip it.
    const pr = panel.getBoundingClientRect();
    const overPanel = xy.some(([x, y]) => x >= pr.left && x <= pr.right && y >= pr.top && y <= pr.bottom);
    const prevPE = panel.style.pointerEvents;
    if (overPanel) panel.style.pointerEvents = 'none';
    let total = 0, canvasHits = 0;
    for (const [x, y] of xy) {
      const el = document.elementFromPoint(x, y);
      if (!el) continue;
      total += 1;
      if (el.tagName === 'CANVAS' || (el.closest && el.closest('canvas'))) canvasHits += 1;
    }
    if (overPanel) panel.style.pointerEvents = prevPE;  // restore exactly (keeps ghost state)
    if (!total) return false;                // can't probe (e.g. jsdom) → assume visible
    return canvasHits === 0;                 // no central point is the board → it's hidden
  }

  // Pure edge-trigger decision (unit-tested; boardHidden() needs a live browser).
  // 'collapse' | 'expand' | null.
  function boardPostureAction({ hidden, prevHidden, userCollapsed, collapsedForBoard }) {
    if (hidden === prevHidden) return null;                 // only act on a change
    if (hidden) return userCollapsed ? null : 'collapse';   // never fight a manual collapse
    return collapsedForBoard ? 'expand' : null;             // only re-open what WE closed
  }

  let boardHiddenPrev = false;
  let collapsedForBoard = false;
  function updateBoardPosture(isSettingsOpen = settingsOpen()) {
    if (!panel) return;
    // Lifecycle owns lobby/ended posture; only manage in-game overlays. Reset our
    // edge state when not playing so we re-evaluate cleanly when play resumes.
    if (lifecycle !== LIFE.PLAYING) { boardHiddenPrev = false; collapsedForBoard = false; return; }
    // Settings has its own (DOM-shell) posture — don't double-handle it.
    if (isSettingsOpen) return;
    const hidden = boardHidden();
    const action = boardPostureAction({
      hidden, prevHidden: boardHiddenPrev,
      userCollapsed: uiState.panelCollapsed, collapsedForBoard,
    });
    boardHiddenPrev = hidden;
    if (action === 'collapse') { collapsedForBoard = true; setPanelCollapsed(true); }
    else if (action === 'expand') { collapsedForBoard = false; setPanelCollapsed(false); }
  }

  // Posture (collapse) + ghost (fade) run together. colonist mutates the DOM
  // constantly during play, so reacting on EVERY mutation would be wasteful — but
  // a fixed leading-edge throttle made an isolated change (opening a menu / trade)
  // wait out the whole window. This throttle has a TRAILING edge: an isolated
  // change reacts immediately, a burst coalesces to once per MIN_REACT_MS.
  // Posture first, then ghost — the fade must see the final collapsed state.
  const MIN_REACT_MS = 80;
  let lastReact = 0, reactScheduled = null;
  function runPostureGhost() {
    if (reactScheduled) { clearTimeout(reactScheduled); reactScheduled = null; }
    lastReact = Date.now();
    const isSettingsOpen = settingsOpen();   // one probe, shared by both posture checks
    updateSettingsPosture(isSettingsOpen);
    updateBoardPosture(isSettingsOpen);
    updateGhost();
  }
  function schedulePostureGhost() {
    const since = Date.now() - lastReact;
    if (since >= MIN_REACT_MS) runPostureGhost();
    else if (!reactScheduled) reactScheduled = setTimeout(runPostureGhost, MIN_REACT_MS - since);
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

  // Automatic full rebuild, debounced: fired after a mid-game refresh or a
  // container swap (reconnect), once colonist has had a moment to refill the
  // log. The manual 🔄 button calls deepRescrape() directly.
  let autoRescrapeTimer = null;
  function scheduleAutoRescrape() {
    clearTimeout(autoRescrapeTimer);
    autoRescrapeTimer = setTimeout(() => { deepRescrape(); }, 1500);
  }

  let rescraping = false;
  async function deepRescrape() {
    if (rescraping) return;
    // The WS board holds a complete live snapshot (full state + continuous diffs),
    // so when it's ready there is no log gap to recover. Reconcile from it — self
    // exact, every total correct — WITHOUT wiping opponents' continuously-inferred
    // breakdowns, which a log re-scrape loses to colonist's virtualised chat
    // history and pads back as phantom "unknown" cards.
    if (wsBoard && __cstBoard.ready(wsBoard)) {
      syncFromWS();
      syncStatsFromWS();
      syncDiceFromWS();
      persistState();
      render();
      return;
    }
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
      setGameSig(keep.sig);
      lifecycle = keep.life;

      // Read-all by SETTLING each viewport instead of guessing a fixed delay.
      // Virtual rows mount a frame or two after the scroll lands; the old code
      // waited a hardcoded 90/180ms and skipped any laggards, so two re-scrapes
      // could disagree. Here we poll: scan until seenIndices stops growing for
      // two consecutive passes (rows have stopped mounting), THEN step down by a
      // sub-viewport so nothing between two settle points is jumped.
      const sc = scrollableOf(container);
      const settle = async () => {
        let stable = 0;
        for (let p = 0; p < 10 && stable < 2; p++) {
          const before = state.seenIndices.size;
          scanExisting(container);
          stable = (state.seenIndices.size === before) ? stable + 1 : 0;
          await sleep(40);
        }
      };
      sc.scrollTop = 0;
      let guard = 0;
      while (container.isConnected && guard++ < 800) {
        await settle();                                                    // read all in view
        if (sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 2) break;  // reached the bottom
        const before = sc.scrollTop;
        sc.scrollTop = Math.min(before + sc.clientHeight * 0.6, sc.scrollHeight);
        if (sc.scrollTop <= before) break;                                 // can't advance further
      }
      if (container.isConnected) await settle();    // final viewport
      sc.scrollTop = sc.scrollHeight;               // the live log sticks to the bottom
    } finally {
      rescraping = false;
    }
    syncFromPanel();
    persistState();
    render();
  }

  // The manual 🔄 click wraps deepRescrape with visible feedback: spin the icon
  // and dim the body for the operation's duration, with a 450ms floor so the (now
  // instant) WS path still registers as a deliberate reload. The class doubles as
  // the re-entrancy guard, so a second click mid-spin is a no-op.
  // A brief floating confirmation over the panel's top edge — so a manual reload
  // visibly registers even when (the common case) the data was already correct and
  // nothing on the panel changed. Fixed-positioned off the panel's rect so it never
  // depends on the panel's own stacking/overflow.
  function flashToast(msg) {
    if (!panel || typeof document === 'undefined') return;
    const pr = panel.getBoundingClientRect();
    const el = document.createElement('div');
    el.textContent = msg;
    el.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;white-space:nowrap;' +
      `left:${pr.left + pr.width / 2}px;top:${pr.top + 10}px;transform:translate(-50%,-4px);` +
      `background:${THEME.accent};color:#fff;font-size:12px;font-weight:700;padding:4px 12px;` +
      'border-radius:999px;box-shadow:0 4px 14px rgba(40,30,10,.35);opacity:0;' +
      'transition:opacity .15s ease, transform .3s ease;';
    document.body.appendChild(el);
    void el.offsetHeight;
    el.style.opacity = '1';
    el.style.transform = 'translate(-50%,2px)';
    setTimeout(() => {
      el.style.opacity = '0'; el.style.transform = 'translate(-50%,-4px)';
      setTimeout(() => el.remove(), 250);
    }, 1100);
  }

  // Wipe a leftover finished game once we're back at the lobby / main screen — a
  // manual reload there means "I'm done with that game". Mirrors a new-game
  // transition without waiting for the next game to begin.
  function clearEndedGame() {
    resetState();
    if (wsBoard && __cstBoard.createBoard) Object.assign(wsBoard, __cstBoard.createBoard());
    blockedSnap = null;
    setGameSig('');
    lifecycle = LIFE.LOBBY;
    lastCounts = null;        // a cleared panel must not shower +N/−N floats on the next render
    persistState();
    render();
  }
  async function runResync() {
    if (!panel || panel.classList.contains('cst-syncing')) return;
    panel.classList.add('cst-syncing');
    if (clearHighlights()) render();   // a manual resync also drops any pinned highlights
    const started = Date.now();
    let cleared = false;
    try {
      // Back at the lobby / main screen with a finished game still on the panel, a
      // manual reload means "clear it". During a live game (or on the Victory screen,
      // where you're reading the stats), it stays a deep re-sync as before.
      if (lifecycle === LIFE.LOBBY) { clearEndedGame(); cleared = true; }
      else await deepRescrape();
    } finally {
      const elapsed = Date.now() - started;
      if (elapsed < 450) await sleep(450 - elapsed);
      if (panel) panel.classList.remove('cst-syncing');
      flashToast(cleared ? t('toastCleared', '✓ Cleared') : t('toastSynced', '✓ Re-synced'));
    }
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
    while (excess > 0 && takeLargestKnown(p)) excess -= 1;
    return true;
  }

  // ---- self's hand is fully visible (DOM) — read it as ground truth ----
  // Opponents' breakdowns are hidden (only their total is public), so the
  // log-only path pads a missed `got` as "unknown". But colonist renders YOUR
  // OWN hand as real <img src=card_*> tiles at the bottom-left, each beside a
  // quantity badge. Reading them pins self's per-resource counts exactly and
  // drops the phantom unknowns.
  function handCount(img) {
    // The quantity badge sits within a couple of wrappers of the card tile;
    // take the first ancestor whose text carries a number.
    let p = img;
    for (let i = 0; i < 4 && p.parentElement; i++) {
      p = p.parentElement;
      const m = (p.textContent || '').trim().match(/\d+/);
      if (m) return parseInt(m[0], 10);
    }
    return null;
  }

  function readSelfHand() {
    const vw = window.innerWidth || 1280;
    const vh = window.innerHeight || 800;
    const hand = zeroResources();
    let found = false;
    for (const im of document.querySelectorAll('img')) {
      const src = im.getAttribute('src') || '';
      const res = RESOURCES.find((r) => src.includes('card_' + r));
      if (!res) continue;
      const box = im.getBoundingClientRect();
      // The hand strip is anchored bottom-left with ~30px tiles. This window
      // excludes the chat-log's tiny inline icons and any centered popup.
      if (box.top <= vh * 0.65 || box.left >= vw * 0.55) continue;
      if (box.width < 18 || box.width > 80) continue;
      const n = handCount(im);
      if (n != null) { hand[res] = n; found = true; }
    }
    return found ? hand : null;
  }

  // Sync hands from the WebSocket board model (the migration's primary source).
  // Self gets its EXACT per-resource breakdown. Opponents get the breakdown the
  // board reconstructs from the public log events (production, trades, steals,
  // builds), already projected onto the WS total so it sums correctly; whatever
  // can't be pinned to a resource stays `unknown`. Before any event has named an
  // opponent's cards (recon is null) we fall back to the old total-only reconcile,
  // keeping the DOM-inferred breakdown until the WS rebuild has something to say.
  function syncFromWS() {
    if (!wsBoard || !__cstBoard.ready(wsBoard)) return false;
    let changed = false;
    state.players.forEach((p, name) => {
      const color = wsColorOf(name);
      if (color == null) return;
      const bd = __cstBoard.handBreakdownOf(wsBoard, color);
      const rec = bd ? null : __cstBoard.reconBreakdownOf(wsBoard, color);
      const breakdown = bd || rec;                // self: revealed; opponent: reconstructed
      if (breakdown) {
        for (let i = 0; i < RESOURCES.length; i++) {
          const v = breakdown[i + 1] || 0;        // resId = index + 1
          if (p.resources[RESOURCES[i]] !== v) { p.resources[RESOURCES[i]] = v; changed = true; }
        }
        const unk = bd ? 0 : (rec.unknown || 0);  // self has no hidden cards
        if (p.unknown !== unk) { p.unknown = unk; changed = true; }
      } else {                                    // opponent, no recon yet → fix total only
        const cnt = __cstBoard.handCountOf(wsBoard, color);
        if (cnt != null && reconcileTotal(p, cnt)) changed = true;
      }
    });
    return changed;
  }

  // Map the WS board's per-colour Stats accumulators into state.tally by name.
  // WS-owned columns (discards) are overwritten; log-only columns (cards lost to
  // knights, player trades, turn timing) are left as the log derived them. No-op
  // until the board is ready, so the lobby / pre-handshake log path is untouched.
  function syncStatsFromWS() {
    if (!wsBoard || !__cstBoard.ready(wsBoard)) return false;
    let changed = false;
    state.players.forEach((p, name) => {
      const color = wsColorOf(name);
      if (color == null) return;
      const s = __cstBoard.statsOf(wsBoard, color);
      if (!s) return;
      const ty = tallyOf(name);
      if (ty.discards !== s.discards) { ty.discards = s.discards; changed = true; }
      if (ty.discardCards !== s.discardCards) { ty.discardCards = s.discardCards; changed = true; }
      const dr = {};
      for (const r of Object.keys(s.discardRes)) dr[RESOURCES[parseInt(r, 10) - 1]] = s.discardRes[r];
      if (JSON.stringify(ty.discardRes || {}) !== JSON.stringify(dr)) { ty.discardRes = dr; changed = true; }
      // Gained: WS total + per-resource (board keys by resId, tally by name). The
      // log derives gained from got/received/took-from-bank; if WS comes in LOWER
      // a source is unaccounted for (e.g. setup) — flag it as an oracle while we
      // confirm distributionType coverage in the wild.
      if (ty.gained !== s.gained) {
        if (s.gained < (ty.gained || 0)) {
          try { console.debug('[CST] 📥 gain oracle: WS', s.gained, '< prior', ty.gained, 'for', name); } catch (e) {}
        }
        ty.gained = s.gained; changed = true;
      }
      const gr = {};
      for (const r of Object.keys(s.gainedRes)) gr[RESOURCES[parseInt(r, 10) - 1]] = s.gainedRes[r];
      if (JSON.stringify(ty.gainedRes || {}) !== JSON.stringify(gr)) { ty.gainedRes = gr; changed = true; }
      // Monopoly: board keys monoTook by resId, monoLost by {takerColor:{resId}};
      // tally keys by resource name / {takerName:{resName}}. type 86 is monopoly-
      // complete, so overwriting (not merging) is safe.
      const mt = {};
      for (const r of Object.keys(s.monoTook)) mt[RESOURCES[parseInt(r, 10) - 1]] = s.monoTook[r];
      if (JSON.stringify(ty.monoTook || {}) !== JSON.stringify(mt)) { ty.monoTook = mt; changed = true; }
      const ml = {};
      for (const tc of Object.keys(s.monoLost)) {
        const thiefName = wsBoard.colorToName[tc];
        if (!thiefName) continue;
        const inner = {};
        for (const r of Object.keys(s.monoLost[tc])) inner[RESOURCES[parseInt(r, 10) - 1]] = s.monoLost[tc][r];
        ml[thiefName] = inner;
      }
      if (JSON.stringify(ty.monoLost || {}) !== JSON.stringify(ml)) { ty.monoLost = ml; changed = true; }
      // Knight-steal RESOURCE breakdown (WS 14/15 — the one thing the DOM log can't
      // see). The ⚔️/💔 COUNTS stay log-derived; we only add the per-resource split,
      // and only where it's complete: self (always involved) or any player in a 2p
      // game. In 3p+ an opponent's split would cover only the steals involving self
      // (partial, wouldn't sum to the count), so we leave it empty there.
      const complete = (name === state.selfName) || (state.players.size === 2);
      if (complete) {
        const sr = {};
        for (const r of Object.keys(s.stoleRes)) sr[RESOURCES[parseInt(r, 10) - 1]] = s.stoleRes[r];
        if (JSON.stringify(ty.stoleRes || {}) !== JSON.stringify(sr)) { ty.stoleRes = sr; changed = true; }
        const lr = {};
        for (const r of Object.keys(s.lostRes)) lr[RESOURCES[parseInt(r, 10) - 1]] = s.lostRes[r];
        if (JSON.stringify(ty.lostRes || {}) !== JSON.stringify(lr)) { ty.lostRes = lr; changed = true; }
      }
    });
    return changed;
  }

  // Mirror the WS board's dice histogram into state. The board accrues every
  // type-10 roll from the structured log (history + live), so this is the
  // authoritative count — it can't drop a roll the way late-mounting chat rows
  // could. The DOM roll handler stops accruing counts once the board is ready
  // (it still owns turn timing, which the protocol doesn't carry).
  function syncDiceFromWS() {
    if (!wsBoard || !__cstBoard.ready(wsBoard)) return false;
    const d = __cstBoard.diceOf(wsBoard);
    if (!d) return false;
    let changed = false;
    for (let n = 2; n <= 12; n++) {
      const v = d.counts[n] || 0;
      if (state.diceCounts[n] !== v) { state.diceCounts[n] = v; changed = true; }
    }
    if (state.totalRolls !== d.total) { state.totalRolls = d.total; changed = true; }
    const hist = d.rolls.length > 256 ? d.rolls.slice(-256) : d.rolls;
    const tail = state.rollHistory[state.rollHistory.length - 1];
    if (state.rollHistory.length !== hist.length || tail !== hist[hist.length - 1]) {
      state.rollHistory = hist.slice();
      changed = true;
    }
    return changed;
  }

  let auditPrinted = false;   // the game-end audit prints once per game

  // ---- self-audit report (console) ----
  // Lays the same quantity from INDEPENDENT sources side by side per player — WS
  // raw / our panel / colonist's own panel + Victory table — so any divergence in
  // the WS migration is obvious. (Comparing tally-vs-WS alone is self-proving:
  // syncStatsFromWS already copied WS into tally.) Returns a multi-line string,
  // printed by __cstAudit() any time and once when the game ends.
  function panelTotalOf(name) {
    let total = null;
    document.querySelectorAll('[data-player-color]').forEach((row) => {
      const nameEl = row.querySelector('[class*="username"]');
      if (nameEl && (nameEl.textContent || '').trim() === name) total = panelHandTotal(row);
    });
    return total;
  }

  function buildAuditReport() {
    const ver = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest)
      ? chrome.runtime.getManifest().version : '?';
    const wsReady = !!(wsBoard && __cstBoard.ready(wsBoard));
    const flag = (a, c) => (a != null && c != null && a !== c) ? '  ⚠️' : '';
    const L = ['===== CST AUDIT v' + ver + ' =====',
      'ws ready: ' + wsReady + ' | self: ' + (state.selfName || '?')
        + ' | lifecycle: ' + lifecycle + ' | paused: ' + state.paused
        + ' | gameEndTs: ' + (state.gameEndTs || 'null')];
    if (wsReady) L.push('events (gameLogState by type): ' + JSON.stringify(__cstBoard.logTypeCountsOf(wsBoard)));
    if (wsReady) L.push('corners: ' + JSON.stringify(__cstBoard.cornerDiag(wsBoard)) + '  (total stored / geom=have-position / built / phantom=built-but-no-tiles)');
    if (wsReady && __cstBoard.auditOf) {
      // geometry self-audit: each roll, did our predicted production match colonist's
      // actual type-47 broadcast? A clean record is the evidence the geometry (and so
      // the blocked-loss it feeds) is right on this board. ✗ = a real geometry bug.
      const au = __cstBoard.auditOf(wsBoard);
      const lastBad = (au.trail || []).filter((t) => !t.ok).slice(-1)[0];
      L.push('geometry audit: ' + au.confirms + ' ✓ / ' + au.conflicts + ' ✗ / ' + (au.skipped || 0) + ' – (empty)'
        + (au.conflicts ? '  ⚠️ GEOMETRY MISMATCH' : '')
        + (lastBad ? ' | last✗ roll ' + lastBad.roll + ' pred=' + JSON.stringify(lastBad.pred) + ' got=' + JSON.stringify(lastBad.actual) : ''));
    }
    state.players.forEach((p, name) => {
      const color = wsColorOf(name);
      const ty = tallyOf(name);
      const ourTotal = playerTotal(p);
      const wsTotal = (wsReady && color != null) ? __cstBoard.handCountOf(wsBoard, color) : null;
      const panelTot = panelTotalOf(name);
      const s = (wsReady && color != null) ? __cstBoard.statsOf(wsBoard, color) : null;
      const wsBlock = (wsReady && color != null) ? __cstBoard.blockedLossOf(wsBoard, color) : null;
      const vic = state.endgameBlocked && state.endgameBlocked[name];
      const tradeFed = Object.values(ty.tradeGave || {}).reduce((a, c) => a + c, 0);
      L.push('');
      L.push('[' + name + '] color=' + color);
      L.push('  hand: ours=' + ourTotal + '(?' + p.unknown + ') ws=' + wsTotal + ' panel=' + panelTot
        + flag(ourTotal, wsTotal) + flag(wsTotal, panelTot));
      L.push('  ours: ' + RESOURCES.map((r) => r[0] + p.resources[r]).join(' '));
      const rec = (wsReady && color != null) ? __cstBoard.reconBreakdownOf(wsBoard, color) : null;
      if (rec) L.push('  recon: ' + RESOURCES.map((r, i) => r[0] + (rec[i + 1] || 0)).join(' ') + ' ?' + (rec.unknown || 0));
      if (wsReady && color != null) {
        const pp = __cstBoard.pipsOf(wsBoard)[color];
        const blds = __cstBoard.buildingsOf(wsBoard, color);
        L.push('  pips: total=' + (pp ? pp.total : 0)
          + ' ' + RESOURCES.map((r, i) => r[0] + ((pp && pp.byRes[i + 1]) || 0)).join(' ')
          + ' | board sees ' + blds + ' building(s)');
        L.push('  buildings: ' + (__cstBoard.buildingsListOf(wsBoard, color).join(' ') || '(none)'));
      }
      if (s) {
        L.push('  disc: tally=' + ty.discardCards + ' ws=' + s.discardCards + flag(ty.discardCards, s.discardCards));
        L.push('  gain: tally=' + ty.gained + ' ws=' + s.gained + flag(ty.gained, s.gained));
        L.push('  mono: tally=' + JSON.stringify(ty.monoTook || {}) + ' ws=' + JSON.stringify(s.monoTook));
        L.push('  steal: ws stole=' + s.stole + ' ' + JSON.stringify(s.stoleRes) + ' lost=' + s.lost + ' ' + JSON.stringify(s.lostRes)
          + ' | panel ⚔️' + JSON.stringify(ty.stoleRes || {}) + ' 💔' + JSON.stringify(ty.lostRes || {}));
      }
      // The panel now shows the WS geometry total (wsBoard); a glance check that it
      // still matches colonist's exact Victory figure at game end.
      const verdict = vic != null ? (wsBlock === vic ? ' [wsBoard ✓ victory]' : ' [wsBoard ✗ ' + wsBlock + '≠' + vic + ']') : '';
      L.push('  block: panel=' + blockLossOf(name) + ' wsBoard=' + wsBlock + (vic != null ? ' victory=' + vic : '') + verdict);
      L.push('  (log-only) lost=' + (ty.lost || 0) + ' tradeFed=' + tradeFed);
    });
    return L.join('\n');
  }

  // __cstAudit() (page console, main world) posts a request; we print the report
  // here — a content-script console.log surfaces in the same DevTools console.
  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('message', (e) => {
      if (!e.data || !e.data.__cstAuditReq) return;
      try { console.log(buildAuditReport()); } catch (err) { /* ignore */ }
    });
  }

  // Sync every tracked player's TOTAL to colonist's player panel (authoritative).
  // Self is special: when its hand strip is on screen we read the EXACT
  // breakdown from it and skip the total-only reconcile (which would re-pad
  // unknowns). Opponents — hidden hands — still reconcile by total.
  function syncFromPanel() {
    let changed = false;
    const self = state.selfName || selfFromPanel();
    const hand = self && state.players.has(self) ? readSelfHand() : null;
    if (hand) {
      const p = state.players.get(self);
      for (const r of RESOURCES) {
        if (p.resources[r] !== hand[r]) { p.resources[r] = hand[r]; changed = true; }
      }
      if (p.unknown !== 0) { p.unknown = 0; changed = true; }
    }
    document.querySelectorAll('[data-player-color]').forEach((row) => {
      const nameEl = row.querySelector('[class*="username"]');
      if (!nameEl) return;
      const name = (nameEl.textContent || '').trim();
      const p = state.players.get(name);
      if (!p) return;
      if (hand && name === self) return;   // self is already exact from the visible hand
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
      processItem,
      scanExisting,
      splitTradeResources,
      countResources,
      diceSum,
      getPlayer,
      giveResource,
      takeResource,
      bankRemaining,
      hasUnknownCards,
      reconcileTotal,
      readSelfHand,
      syncFromPanel,
      syncFromWS,
      syncStatsFromWS,
      syncDiceFromWS,
      buildAuditReport,
      maybeNewGame,
      persistState,
      restoreState,
      // Lifecycle / timer (auto collapse-expand state machine).
      LIFE,
      evalLifecycle,
      attachObserver,
      logIsContinuation,
      deepRescrape,
      clearEndedGame,
      onGameWon,
      startNextGame,
      getLifecycle: () => lifecycle,
      getWsBoard: () => wsBoard,   // test-only handle onto the live WS board model
      timerText,
      buildGameRecord,
      coldestSum,
      chiSquare,
      luckTier,
      recordTurn,
      recordSteal,
      selfFromPanel,
      stealReportHTML,
      blockLossOf,
      readEndgameBlocked,
      syncEndgameBlocked,
      blockReportHTML,
      tradeGhostOn,
      tradeCreatorOpen,
      settingsOpen,
      discardLimit,
      updateSettingsPosture,
      // Generic "colonist took over the screen" collapse.
      boardPostureAction,
      boardHidden,
      updateBoardPosture,
      ghostKind,
      // Dice artwork (self-healing real-image cache + face renderer).
      DICE_ICON,
      diceFromImg,
      dieFaceHTML,
      getUiState: () => uiState,
      toggleCellHighlight,
      toggleDiceHighlight,
      toggleColumnHighlight,
      selectPipPlayer,
      togglePipMode,
      clearHighlights,
      reconcileOrder,
      reorderKeys,
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
    // The same observer also drives posture/ghost: opening a menu / trade / the
    // Settings page mutates the DOM, so schedulePostureGhost() reacts to it within
    // ~MIN_REACT_MS (trailing-throttled so a burst of game mutations coalesces).
    let lastPath = location.pathname;
    new MutationObserver(() => {
      if (location.pathname !== lastPath) {
        lastPath = location.pathname;
        attachObserver();
        evalLifecycle();   // URL changed — re-evaluate the lobby/game posture now
      }
      schedulePostureGhost();
    }).observe(document.documentElement, { childList: true, subtree: true });
  }
})();
