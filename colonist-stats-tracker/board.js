'use strict';

// colonist game model from the WebSocket (id=130). Pure: every function takes the
// board object `b`. The board is canvas-only in the DOM, but the WS carries the
// real state — this turns it into queryable tiles/corners/robber + a live
// blocked-loss accumulator. Resource ids 1..5 (0 = desert); building types
// 1 = settlement, 2 = city.
(function () {
  // A corner (x,y,z) touches up to three hexes (axial coords); z picks the corner's
  // orientation. Both branches are validated against colonist's own production
  // broadcasts in a real game (tests/ws-geometry-real): for every roll the players
  // who produce, and what, match the tiles these formulas resolve to (0 mismatches).
  function tilesOfCorner(c) {
    const x = c.x, y = c.y;
    return c.z === 0
      ? [[x, y], [x, y - 1], [x + 1, y - 1]]
      : [[x, y], [x - 1, y + 1], [x, y + 1]];
  }

  function createBoard() {
    return {
      tiles: {}, coordToTile: {}, corners: {}, cornersByTile: {},
      robberTile: null, selfColor: null, colorToName: {}, hands: {},
      blockedLoss: {}, wsStats: {}, handRecon: {}, logTypeCounts: {}, seenLog: -1, _ready: false,
      gameId: null,                                 // gameSettings.id of the current game (new-game detection)
      dice: { counts: {}, total: 0, rolls: [] },   // histogram from type-10 roll events
    };
  }

  // New game in the same tab: clear ONLY the per-game event accruals (which add up
  // over a game and would otherwise bleed into the next). The GEOMETRY is left
  // alone on purpose — applyFullState rebuilds it wholesale on every full state, so
  // clearing it here was redundant AND harmful: the DOM-driven reset fires ~1s after
  // the new game's full state, so wiping the geometry orphaned every later placement
  // (placement diffs carry only the corner index, no coordinates) into phantoms,
  // blanking pips/⛔ until an F5. Cross-game geometry is reset by applyFullState.
  function resetAccrual(b) {
    b.seenLog = -1;
    b.wsStats = {};
    b.handRecon = {};
    b.blockedLoss = {};
    b.logTypeCounts = {};
    b.dice = { counts: {}, total: 0, rolls: [] };
  }

  // Per-colour Stats accumulators sourced from the WS game log (the Stats section
  // columns the protocol can give us precisely). Created lazily on first event.
  function ensureStats(b, color) {
    return b.wsStats[color] || (b.wsStats[color] = {
      discards: 0, discardCards: 0, discardRes: {},
      gained: 0, gainedRes: {},
      monoTook: {}, monoLost: {},
      stole: 0, stoleRes: {}, lost: 0, lostRes: {},
    });
  }

  // Walk new gameLogState entries (deduped by the monotonic index) and accrue the
  // Stats events. `fromDiff` gates the time-ordered blocked accrual — it depends
  // on the CURRENT robber tile, so it must only run on live diffs, never when
  // replaying a reconnect snapshot's whole history (which would use the final
  // robber position for every past roll). The stateless events (discards, and
  // later gains/monopoly) are safe to accrue from the history too.
  function accrueLog(b, gameLogState, fromDiff) {
    const entries = Object.keys(gameLogState)
      .map((k) => parseInt(k, 10))
      .filter((k) => k > b.seenLog)
      .sort((a, c) => a - c);
    for (const k of entries) {
      b.seenLog = k;
      const entry = gameLogState[String(k)];
      const text = entry && entry.text;
      if (!text) continue;
      b.logTypeCounts[text.type] = (b.logTypeCounts[text.type] || 0) + 1; // audit cross-check
      if (text.type === 55) {
        const cards = text.cardEnums || [];
        if (cards.length) {
          const s = ensureStats(b, text.playerColor);
          s.discards += 1;
          s.discardCards += cards.length;
          for (const c of cards) s.discardRes[c] = (s.discardRes[c] || 0) + 1;
          reconApply(b, text.playerColor, cards, -1);
        }
      } else if (text.type === 47 || text.type === 21) {
        // Gained: roll/placement production (47, cardsToBroadcast) and Year of
        // Plenty (21, cardEnums) — both resId arrays into the player's hand.
        const cards = text.cardsToBroadcast || text.cardEnums || [];
        if (cards.length) {
          const s = ensureStats(b, text.playerColor);
          for (const c of cards) { s.gained += 1; s.gainedRes[c] = (s.gainedRes[c] || 0) + 1; }
          reconApply(b, text.playerColor, cards, +1);
        }
      } else if (text.type === 116) {
        // Bank/port trade: this player only. -given +received.
        reconApply(b, text.playerColor, text.givenCardEnums || [], -1);
        reconApply(b, text.playerColor, text.receivedCardEnums || [], +1);
      } else if (text.type === 115) {
        // Player-to-player trade: offerer (playerColor) -given +received; the
        // accepter (acceptingPlayerColor) gets the mirror.
        reconApply(b, text.playerColor, text.givenCardEnums || [], -1);
        reconApply(b, text.playerColor, text.receivedCardEnums || [], +1);
        reconApply(b, text.acceptingPlayerColor, text.receivedCardEnums || [], -1);
        reconApply(b, text.acceptingPlayerColor, text.givenCardEnums || [], +1);
      } else if (text.type === 5) {
        // Build: deduct the fixed cost (0 road, 2 settlement, 3 city).
        reconApply(b, text.playerColor, BUILD_COST[text.pieceEnum] || [], -1);
      } else if (text.type === 86) {
        // Monopoly: playerColor = taker, amountStolen of cardEnum from everyone
        // else. type 86 is monopoly-only (a knight steal is a different type —
        // 25 robber moves but a single 86 in the captured game), so every 86
        // counts. The per-victim split is only knowable with one opponent.
        const res = text.cardEnum, amt = text.amountStolen || 0;
        if (res != null && amt > 0) {
          const taker = ensureStats(b, text.playerColor);
          taker.monoTook[res] = (taker.monoTook[res] || 0) + amt;
          const colors = Object.keys(b.colorToName).map((c) => parseInt(c, 10));
          if (colors.length === 2) {
            const victim = colors.find((c) => c !== text.playerColor);
            if (victim != null) {
              const v = ensureStats(b, victim);
              const by = (v.monoLost[text.playerColor] = v.monoLost[text.playerColor] || {});
              by[res] = (by[res] || 0) + amt;
            }
          }
          // handRecon: taker gains `amt` of res; every other tracked player loses
          // ALL of that res (monopoly sweeps everyone). The taker's gain equals the
          // sum of others' holdings, so reconcile stays consistent.
          ensureRecon(b, text.playerColor)[res] += amt;
          for (const cc of Object.keys(b.handRecon)) {
            if (parseInt(cc, 10) !== text.playerColor) b.handRecon[cc][res] = 0;
          }
        }
      } else if (text.type === 14 || text.type === 15) {
        // Knight steal, revealed privately to self (so it carries the card type).
        // 14 = self is the thief, 15 = self is the victim; playerColor is the OTHER
        // party; cardEnums = the single stolen card's resId. SELF is read from the
        // event's specificRecipients (the private reveal's recipient IS self), NOT
        // b.selfColor — a reconnect's full-state can omit playerColor, leaving
        // selfColor null, which silently dropped self's entire steal column. We
        // self-heal selfColor from it too. Both parties known → credit thief.stole
        // AND victim.lost by resId; in 3p+ only steals involving self appear here.
        const card = (text.cardEnums || [])[0];
        const self = (entry.specificRecipients && entry.specificRecipients[0] != null)
          ? entry.specificRecipients[0] : b.selfColor;
        if (self != null && b.selfColor == null) b.selfColor = self;
        if (card != null && self != null) {
          const thief = text.type === 14 ? self : text.playerColor;
          const victim = text.type === 14 ? text.playerColor : self;
          if (thief != null) { const s = ensureStats(b, thief); s.stole += 1; s.stoleRes[card] = (s.stoleRes[card] || 0) + 1; }
          if (victim != null) { const v = ensureStats(b, victim); v.lost += 1; v.lostRes[card] = (v.lostRes[card] || 0) + 1; }
          reconApply(b, thief, [card], +1);
          reconApply(b, victim, [card], -1);
        }
      } else if (text.type === 16) {
        // Opponent-vs-opponent knight steal: the card is masked from us (cardBacks).
        // Honest — thief gains 1 unknown; victim loses 1 card of unknown type (no
        // guess). This is the only genuinely-unknowable hand move.
        if (text.playerColorThief != null) ensureRecon(b, text.playerColorThief).unknown += 1;
        if (text.playerColorVictim != null) reconLoseOne(ensureRecon(b, text.playerColorVictim));
      } else if (text.type === 10) {
        const sum = (text.firstDice || 0) + (text.secondDice || 0);
        if (sum >= 2 && sum <= 12) {
          b.dice.counts[sum] = (b.dice.counts[sum] || 0) + 1;
          b.dice.total += 1;
          b.dice.rolls.push(sum);
          if (b.dice.rolls.length > 256) b.dice.rolls = b.dice.rolls.slice(-256);
        }
        if (fromDiff) accrueBlocked(b, sum);   // blocked-loss needs the live robber tile
      }
    }
  }

  function recomputeCornersByTile(b) {
    b.cornersByTile = {};
    for (const ci of Object.keys(b.corners)) {
      for (const p of tilesOfCorner(b.corners[ci])) {
        const ti = b.coordToTile[p[0] + ',' + p[1]];
        if (ti != null) (b.cornersByTile[ti] || (b.cornersByTile[ti] = [])).push(ci);
      }
    }
  }

  function applyFullState(b, payload) {
    // A fresh game sends a full state with a NEW gameSettings.id (a reconnect reuses
    // it). On a new game, clear the previous game's accruals here — driven by the WS
    // itself, the instant the new board arrives — instead of relying on the ~1s-late
    // DOM reset. A reconnect (same id) keeps the accruals; the log replay below
    // deduplicates by seenLog so it can't double-count.
    const gid = (payload && payload.gameSettings && payload.gameSettings.id) || null;
    if (gid != null && gid !== b.gameId) resetAccrual(b);
    if (gid != null) b.gameId = gid;
    const gs = (payload && payload.gameState) || {};
    const map = gs.mapState || {};
    b.tiles = {}; b.coordToTile = {};
    for (const i of Object.keys(map.tileHexStates || {})) {
      const t = map.tileHexStates[i];
      b.tiles[i] = { type: t.type, number: t.diceNumber, x: t.x, y: t.y };
      b.coordToTile[t.x + ',' + t.y] = i;
    }
    b.corners = {};
    for (const i of Object.keys(map.tileCornerStates || {})) {
      const c = map.tileCornerStates[i];
      b.corners[i] = { x: c.x, y: c.y, z: c.z, owner: c.owner, buildingType: c.buildingType };
    }
    recomputeCornersByTile(b);
    b.robberTile = gs.mechanicRobberState ? gs.mechanicRobberState.locationTileIndex : null;
    if (gs.playerColor != null) b.selfColor = gs.playerColor;
    b.colorToName = {};
    for (const u of (payload && payload.playerUserStates) || []) b.colorToName[u.selectedColor] = u.username;
    b.hands = {};
    for (const c of Object.keys(gs.playerStates || {})) {
      const ps = gs.playerStates[c];
      b.hands[c] = { cards: (ps.resourceCards && ps.resourceCards.cards) || [] };
    }
    if (gs.gameLogState) accrueLog(b, gs.gameLogState, false); // reconnect history
    b._ready = true;
  }

  function applyDiff(b, diff) {
    if (!diff) return;
    const map = diff.mapState || {};
    if (map.tileCornerStates) {
      let movedPos = false;
      for (const i of Object.keys(map.tileCornerStates)) {
        const c = map.tileCornerStates[i];
        const cur = b.corners[i] || (b.corners[i] = {});
        if (c.x != null) { cur.x = c.x; movedPos = true; }
        if (c.y != null) cur.y = c.y;
        if (c.z != null) cur.z = c.z;
        if (c.owner != null) cur.owner = c.owner;
        if (c.buildingType != null) cur.buildingType = c.buildingType;
      }
      if (movedPos) recomputeCornersByTile(b); // corners are normally fixed at full state
    }
    if (diff.mechanicRobberState && diff.mechanicRobberState.locationTileIndex != null) {
      b.robberTile = diff.mechanicRobberState.locationTileIndex;
    }
    if (diff.gameLogState) accrueLog(b, diff.gameLogState, true);
    if (diff.playerStates) {
      for (const c of Object.keys(diff.playerStates)) {
        const ps = diff.playerStates[c];
        if (ps.resourceCards && ps.resourceCards.cards) b.hands[c] = { cards: ps.resourceCards.cards };
      }
    }
  }

  function handCountOf(b, color) {
    const h = b.hands[color];
    return h && h.cards ? h.cards.length : null;
  }

  // Revealed hands (self) → resId-keyed counts; opponents are all-zero (types
  // hidden by colonist) → null, so callers keep their own inferred breakdown.
  function handBreakdownOf(b, color) {
    const h = b.hands[color];
    if (!h || !h.cards || !h.cards.length) return null;
    if (!h.cards.some((c) => c > 0)) return null;
    const out = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const c of h.cards) if (out[c] != null) out[c] += 1;
    return out;
  }

  // ---- opponent hand reconstruction (from the WS gameLogState) ----
  // Per-colour reconstructed hand: known resId counts + `unknown`. Fed by event
  // handlers in accrueLog; reconciled to colonist's authoritative count so any
  // untracked/masked change degrades to unknown rather than corrupting the split.
  function ensureRecon(b, color) {
    return b.handRecon[color] || (b.handRecon[color] = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, unknown: 0 });
  }
  function reconSum(r) { return r[1] + r[2] + r[3] + r[4] + r[5] + r.unknown; }
  // Build costs by type 5 pieceEnum (0 road, 2 settlement, 3 city) as resId lists.
  const BUILD_COST = { 0: [1, 2], 2: [1, 2, 3, 4], 3: [4, 4, 5, 5, 5] };
  // Add/remove a list of resIds (sign +1/-1), floored at 0.
  // Add/remove a list of known-resId cards. A REMOVAL (sign −1) of a resource we
  // don't hold as known must have come from an `unknown` card — so resolve it from
  // there. That's the back-deduction: e.g. a city costs 2 grain + 3 ore, so if the
  // player builds one with only grain known, the 3 ore can only have been their
  // unknowns → spend them. (Builds, discards, trades-given, revealed steals.)
  function reconApply(b, color, cards, sign) {
    if (color == null || !cards) return;
    const r = ensureRecon(b, color);
    for (const c of cards) {
      if (r[c] == null) continue;
      if (sign > 0) r[c] += 1;
      else if (r[c] > 0) r[c] -= 1;          // had it as known
      else if (r.unknown > 0) r.unknown -= 1; // must have been one of the unknowns → resolve + spend
    }
  }
  // Lose ONE card of unknown type, honestly: keep what's still certain
  // (guaranteed-min = each known resource could have been the one taken) and mark
  // the ambiguous remainder unknown. Never names a wrong card. {ore:2}→{ore:1};
  // {lumber:1,ore:1}→{unknown:1} (could be either).
  function reconLoseOne(r) {
    const total = reconSum(r);
    if (total <= 0) return;
    let kept = 0;
    for (let i = 1; i <= 5; i++) { r[i] = Math.max(0, r[i] - 1); kept += r[i]; }
    r.unknown = Math.max(0, total - 1 - kept);
  }
  // A dev-card buy spends 1 wool + 1 grain + 1 ore — colonist logs no event for it
  // (silent −3), so it surfaces as an unexplained loss in the reconcile. Deduct the
  // exact cost: from a known holding if we have it, else from unknown.
  function reconBuyDevCard(r) {
    for (const res of [3, 4, 5]) {
      if (r[res] > 0) r[res] -= 1;
      else if (r.unknown > 0) r.unknown -= 1;
    }
  }
  // Project the stored (pure event-accrued) recon onto colonist's authoritative
  // total — NON-mutatingly, at read time. This is the ONLY place the silent moves
  // settle (an unaccounted gain → unknown; an unexplained −3 → a dev-card buy; any
  // odd remainder → an honest unknown-type loss). Because handRecon itself is never
  // clamped mid-stream, the result depends only on the EVENTS, not on when they were
  // processed — so live play and a post-reload replay project to the same breakdown.
  function projectRecon(b, color) {
    const r = b.handRecon[color];
    if (!r) return null;
    const proj = { 1: r[1], 2: r[2], 3: r[3], 4: r[4], 5: r[5], unknown: r.unknown };
    const total = handCountOf(b, color);
    if (total == null) return proj;               // no authoritative count yet
    const diff = total - reconSum(proj);
    if (diff > 0) { proj.unknown += diff; return proj; }   // unaccounted gain → unknown
    let excess = -diff;
    while (excess >= 3) { reconBuyDevCard(proj); excess -= 3; }  // silent dev-card buys
    for (; excess > 0; excess -= 1) reconLoseOne(proj);         // honest remainder
    return proj;
  }

  function accrueBlocked(b, n) {
    const t = b.robberTile != null ? b.tiles[b.robberTile] : null;
    if (!t || t.number !== n || t.type === 0) return; // robber not on a matching numbered tile
    for (const ci of b.cornersByTile[b.robberTile] || []) {
      const c = b.corners[ci];
      if (!c || c.owner == null || !c.buildingType) continue;
      b.blockedLoss[c.owner] = (b.blockedLoss[c.owner] || 0) + (c.buildingType === 2 ? 2 : 1);
    }
  }

  function tilesOfCornerIdx(b, idx) {
    const c = b.corners[idx];
    if (!c) return [];
    return tilesOfCorner(c).map((p) => b.coordToTile[p[0] + ',' + p[1]]).filter((t) => t != null);
  }

  // Catan "pips" — the dots under a number = ways to roll it (2/12→1 … 6/8→5).
  function pipDots(n) {
    if (n == null || n < 2 || n > 12 || n === 7) return 0;
    return 6 - Math.abs(7 - n);
  }

  // Per-colour Setup strength: the pips of every numbered tile a player TOUCHES,
  // grouped by resource. Each tile counts ONCE no matter how many of that player's
  // buildings sit on it (Stan: count the tile, don't multiply by building count) —
  // so settlement vs city is irrelevant here too. The tile the robber currently
  // sits on is deducted, so the number tracks pips usable right now.
  function pipsOf(b) {
    const tilesByOwner = {};   // owner colour -> Set of distinct tile keys touched
    for (const ci of Object.keys(b.corners)) {
      const c = b.corners[ci];
      if (!c || c.owner == null || !c.buildingType) continue;
      const set = tilesByOwner[c.owner] || (tilesByOwner[c.owner] = new Set());
      for (const ti of tilesOfCornerIdx(b, ci)) set.add(String(ti));
    }
    const out = {};
    for (const owner of Object.keys(tilesByOwner)) {
      const o = (out[owner] = { total: 0, byRes: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } });
      for (const ti of tilesByOwner[owner]) {
        if (b.robberTile != null && ti === String(b.robberTile)) continue;
        const t = b.tiles[ti];
        if (!t || t.type < 1 || t.type > 5) continue;   // desert / sea: no pips
        const p = pipDots(t.number);
        if (!p) continue;
        o.total += p;
        o.byRes[t.type] += p;
      }
    }
    return out;
  }

  const api = {
    createBoard, resetAccrual, tilesOfCorner, applyFullState, applyDiff, tilesOfCornerIdx,
    handCountOf, handBreakdownOf,
    diceOf: (b) => b.dice,
    statsOf: (b, color) => b.wsStats[color] || null,
    logTypeCountsOf: (b) => b.logTypeCounts,
    ready: (b) => b._ready,
    robberTile: (b) => b.robberTile,
    blockedLossOf: (b, color) => b.blockedLoss[color] || 0,
    pipsOf,
    // diagnostic: how many built corners the board currently attributes to a colour
    buildingsOf: (b, color) => {
      let n = 0;
      for (const ci of Object.keys(b.corners)) {
        const c = b.corners[ci];
        if (c && c.owner === color && c.buildingType) n += 1;
      }
      return n;
    },
    // diagnostic: is the corner geometry complete? total stored corners, how many
    // carry a position (x set), how many are built, and how many of those built ones
    // resolve to NO tiles (phantoms — geometry we never captured).
    cornerDiag: (b) => {
      let total = 0, geom = 0, built = 0, phantom = 0;
      for (const ci of Object.keys(b.corners)) {
        total += 1;
        const c = b.corners[ci];
        if (c.x != null) geom += 1;
        if (c.owner != null && c.buildingType) {
          built += 1;
          if (tilesOfCornerIdx(b, ci).length === 0) phantom += 1;
        }
      }
      return { total, geom, built, phantom };
    },
    // diagnostic: each built corner for a colour as `idx:t<type>@<adjacent numbers>`
    buildingsListOf: (b, color) => {
      const out = [];
      for (const ci of Object.keys(b.corners)) {
        const c = b.corners[ci];
        if (c && c.owner === color && c.buildingType) {
          const nums = tilesOfCornerIdx(b, ci).map((ti) => (b.tiles[ti] ? b.tiles[ti].number : '?')).join(',');
          out.push(ci + ':t' + c.buildingType + '@' + nums);
        }
      }
      return out;
    },
    reconBreakdownOf: projectRecon,                              // total-projected (display) breakdown
    reconSumOf: (b, color) => { const p = projectRecon(b, color); return p ? reconSum(p) : 0; },
    // test-only helper (feed mode): seed the stored pure-accrual recon
    __setRecon: (b, color, o) => Object.assign(ensureRecon(b, color), o),
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else (typeof window !== 'undefined' ? window : globalThis).__cstBoard = api;
})();
