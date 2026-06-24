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

  // Live geometry self-audit accumulator: each roll we PREDICT production from the
  // geometry and compare to colonist's actual type-47 broadcast. `expect`/`actual`
  // are the in-flight roll (settled on the next roll); trail keeps the recent
  // verdicts as a small evidence log. Conflicts are recorded, not acted on.
  function freshAudit() { return { confirms: 0, conflicts: 0, skipped: 0, trail: [], expect: null, actual: {} }; }

  function createBoard() {
    return {
      tiles: {}, coordToTile: {}, corners: {}, cornersByTile: {},
      robberTile: null, selfColor: null, colorToName: {}, hands: {},
      blockedLoss: {}, blockedDetail: {}, wsStats: {}, handRecon: {}, logTypeCounts: {}, seenLog: -1, _ready: false,
      devBought: {}, devHeld: {}, devUsed: {}, devApplied: {},   // dev-card buys per colour (held+used); devApplied = costs already charged
      processedLog: new Set(),                      // log indices already accrued (dedup; survives empty shells + index gaps)
      gameId: null,                                 // gameSettings.id of the current game (new-game detection)
      dice: { counts: {}, total: 0, rolls: [] },   // histogram from type-10 roll events
      audit: freshAudit(),                          // geometry-vs-production self-audit
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
    b.processedLog = new Set();
    b.wsStats = {};
    b.handRecon = {};
    b.devBought = {}; b.devHeld = {}; b.devUsed = {}; b.devApplied = {};
    b.blockedLoss = {};
    b.blockedDetail = {};
    b.logTypeCounts = {};
    b.dice = { counts: {}, total: 0, rolls: [] };
    b.audit = freshAudit();
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
      .filter((k) => !b.processedLog.has(k))   // dedup by processed-index SET, not a single max
      .sort((a, c) => a - c);
    for (const k of entries) {
      const entry = gameLogState[String(k)];
      const text = entry && entry.text;
      if (!text) continue;                     // empty shell: leave unprocessed so the filled entry is read next frame
      b.processedLog.add(k);
      if (k > b.seenLog) b.seenLog = k;        // seenLog = max processed index (audit / compat)
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
        // roll-yield production (47 with distributionType 1 — NOT setup placement's
        // distributionType 0, nor Year of Plenty 21) feeds the geometry self-audit.
        if (text.type === 47 && text.distributionType === 1 && fromDiff) {
          auditProduce(b, text.playerColor, text.cardsToBroadcast || []);
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
        if (fromDiff) auditRoll(b, sum);       // geometry self-audit: settle prev, snapshot this roll
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

  // Dev-card buys per colour from mechanicDevelopmentCardsState: bought = currently held
  // (developmentCards.cards) + already played (developmentCardsUsed). A buy is SILENT in the
  // game log (no event), so this authoritative count drives the deduction of its cost
  // (1 wool + 1 grain + 1 ore) from the reconstructed hand — the main source of opponent
  // over-count (which otherwise surfaces as phantom "?"). Colonist sends the full per-player
  // arrays in both full states and diffs, so held/used are stored separately and re-summed
  // (a play moves held→used with bought unchanged; a buy bumps held). The cost is charged
  // ONCE PER BUY, the moment it's bought (devApplied tracks how many we've charged) — NOT
  // re-deducted at every read, which would let a cost that was unaffordable earlier (no ore
  // then) eat ore the player publicly produces LATER. Runs AFTER accrueLog so the
  // just-bought resources are present in the recon to deduct from.
  function applyDevState(b, devState) {
    if (!devState || !devState.players) return;
    for (const c of Object.keys(devState.players)) {
      const p = devState.players[c] || {};
      const held = (p.developmentCards && Array.isArray(p.developmentCards.cards)) ? p.developmentCards.cards.length : null;
      const used = Array.isArray(p.developmentCardsUsed) ? p.developmentCardsUsed.length : null;
      if (held == null && used == null) continue;
      if (held != null) b.devHeld[c] = held;
      if (used != null) b.devUsed[c] = used;
      b.devBought[c] = (b.devHeld[c] || 0) + (b.devUsed[c] || 0);
      for (let n = (b.devApplied[c] || 0); n < b.devBought[c]; n++) reconBuyDevCard(ensureRecon(b, c));
      b.devApplied[c] = b.devBought[c];
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
    // A full state (new game OR a same-id reconnect) interrupts any in-flight audit
    // round: the live production stream is replaced by the history replay, which does
    // NOT feed the audit (fromDiff=false). Drop the open prediction so it isn't settled
    // against an empty `actual` on the next roll — a false conflict. (resetAccrual
    // already cleared it on a new game; this also covers the reconnect.)
    if (b.audit) { b.audit.expect = null; b.audit.actual = {}; }
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
    applyDevState(b, gs.mechanicDevelopmentCardsState);        // AFTER accrueLog: charge buys against the built hand
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
    if (diff.mechanicDevelopmentCardsState) applyDevState(b, diff.mechanicDevelopmentCardsState);
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
  // exact cost: from a known holding if we have it, else from unknown. Returns how many
  // of the 3 it could ACTUALLY remove (0–3) — the projection relies on this so it never
  // assumes a full −3 it couldn't make (which would leave the total over-counted).
  function reconBuyDevCard(r) {
    let spent = 0;
    for (const res of [3, 4, 5]) {
      if (r[res] > 0) { r[res] -= 1; spent += 1; }
      else if (r.unknown > 0) { r.unknown -= 1; spent += 1; }
    }
    return spent;
  }
  // Project the stored recon (event accrual + the dev-buy costs already charged at buy time
  // by applyDevState) onto colonist's authoritative total — NON-mutatingly, at read time.
  // This settles the still-silent moves (an unaccounted gain → unknown; any odd remainder →
  // an honest unknown-type loss). handRecon is never clamped mid-stream, so the breakdown is
  // a function of the processed events, reconciled to the live count.
  function projectRecon(b, color) {
    const r = b.handRecon[color];
    if (!r) return null;
    const proj = { 1: r[1], 2: r[2], 3: r[3], 4: r[4], 5: r[5], unknown: r.unknown };
    const total = handCountOf(b, color);
    if (total == null) return proj;               // no authoritative count yet
    // Dev-card buy costs are ALREADY deducted from the stored recon (applyDevState charges
    // each buy ONCE, at buy time) — do NOT re-deduct them here, or a cost re-applied at read
    // time would eat resources the player publicly produced after the buy. Just reconcile to
    // the authoritative total.
    const diff = total - reconSum(proj);
    if (diff > 0) { proj.unknown += diff; return proj; }   // unaccounted gain → unknown
    let excess = -diff;
    while (excess >= 3) {                     // a buy NOT yet charged (no dev state, e.g. DOM-only) → infer it
      const spent = reconBuyDevCard(proj);
      if (!spent) break;                      // holds none of wool/grain/ore → stop guessing buys
      excess -= spent;
    }
    for (; excess > 0; excess -= 1) reconLoseOne(proj);   // honest single losses clamp to handCount
    return proj;
  }

  // On a roll of n with the robber on a number-n tile, each adjacent building loses
  // 1 (settlement) / 2 (city) of that tile's resource. Accrues the per-colour total
  // AND a per-(roll,resource) detail so the ⛔ hover can be drawn from the SAME
  // geometry as the headline (one entry per blocked roll, cards = Σ over buildings).
  function accrueBlocked(b, n) {
    const t = b.robberTile != null ? b.tiles[b.robberTile] : null;
    if (!t || t.number !== n || t.type === 0) return; // robber not on a matching numbered tile
    const byOwner = {};
    for (const ci of b.cornersByTile[b.robberTile] || []) {
      const c = b.corners[ci];
      if (!c || c.owner == null || !c.buildingType) continue;
      byOwner[c.owner] = (byOwner[c.owner] || 0) + (c.buildingType === 2 ? 2 : 1);
    }
    for (const owner of Object.keys(byOwner)) {
      const amt = byOwner[owner];
      b.blockedLoss[owner] = (b.blockedLoss[owner] || 0) + amt;
      const d = b.blockedDetail[owner] || (b.blockedDetail[owner] = {});
      const key = n + '|' + t.type;
      const e = d[key] || (d[key] = { roll: n, res: t.type, times: 0, cards: 0 });
      e.times += 1;
      e.cards += amt;
    }
  }

  // ---- live geometry self-audit (validates the corner→tile geometry) ----
  // What the geometry SAYS should be produced on a roll of n: every building on a
  // number-n tile that ISN'T robbed yields its tile's resource (settlement 1 /
  // city 2). Sibling of accrueBlocked — that reads the robbed tile (the loss), this
  // reads the un-robbed ones (where the server actually broadcasts, so we can check).
  function predictProduction(b, n) {
    const out = {};
    for (const ti of Object.keys(b.tiles)) {
      const t = b.tiles[ti];
      if (!t || t.number !== n || t.type < 1 || t.type > 5) continue;
      if (b.robberTile != null && String(ti) === String(b.robberTile)) continue; // blocked → no production
      for (const ci of b.cornersByTile[ti] || []) {
        const c = b.corners[ci];
        if (!c || c.owner == null || !c.buildingType) continue;
        const o = out[c.owner] || (out[c.owner] = {});
        o[t.type] = (o[t.type] || 0) + (c.buildingType === 2 ? 2 : 1);
      }
    }
    return out;
  }
  // Deep-equal two {colour:{resId:amt}} production maps (zero-amounts ignored).
  function productionEqual(x, y) {
    for (const col of new Set([...Object.keys(x), ...Object.keys(y)])) {
      const a = x[col] || {}, c = y[col] || {};
      for (const r of new Set([...Object.keys(a), ...Object.keys(c)])) {
        if ((a[r] || 0) !== (c[r] || 0)) return false;
      }
    }
    return true;
  }
  // Settle the in-flight roll: compare what the geometry predicted to what colonist
  // actually broadcast, record the verdict (and warn on a conflict — a geometry bug
  // on this board). A match on the un-robbed tiles is the evidence that the SAME
  // geometry feeding blocked-loss on the robbed tile is correct too.
  function settleAudit(b) {
    const au = b.audit;
    if (!au || !au.expect) return;
    const pred = au.expect.pred, act = au.actual || {};
    // nothing predicted AND nothing produced (a 7, or a number no building touches):
    // no geometric evidence either way — count as skipped, not a confirmation, so the
    // ✓ tally means "the geometry was actually exercised and held".
    if (!Object.keys(pred).length && !Object.keys(act).length) {
      au.skipped += 1;
      au.expect = null; au.actual = {};
      return;
    }
    const ok = productionEqual(pred, act);
    if (ok) au.confirms += 1; else au.conflicts += 1;
    au.trail.push({ roll: au.expect.roll, robber: au.expect.robber, pred, actual: act, ok });
    if (au.trail.length > 64) au.trail.shift();
    if (!ok && typeof console !== 'undefined' && console.warn) {
      console.warn('[CST] geometry audit conflict on roll ' + au.expect.roll +
        ' — predicted ' + JSON.stringify(pred) + ' but server produced ' + JSON.stringify(act));
    }
    au.expect = null;
    au.actual = {};
  }
  // Is the corner geometry complete? total stored corners, how many carry a position
  // (x set), how many are built, and how many of those built ones resolve to NO tiles
  // (phantoms — built corners whose hex geometry we never captured: either the slot
  // came in without coordinates, or the surrounding tiles are missing). map-agnostic:
  // counts, never compared to a fixed board size.
  function cornerDiag(b) {
    let total = 0, geom = 0, built = 0, phantom = 0;
    for (const ci of Object.keys(b.corners)) {
      total += 1;
      const c = b.corners[ci];
      if (c.x != null) geom += 1;
      if (c.owner != null && c.buildingType) {
        built += 1;
        if (c.x == null || tilesOfCornerIdx(b, ci).length === 0) phantom += 1;
      }
    }
    return { total, geom, built, phantom };
  }

  // Geometry is usable for prediction/blocked-loss once a full state has populated
  // tiles AND corners, AND the current robber tile is actually loaded — AND the
  // captured geometry is COMPLETE for what's built. A non-empty board still isn't
  // trustworthy if any BUILT corner is a phantom (resolves to zero tiles, or carries
  // a building with no coordinates): that's a building whose hex geometry we failed to
  // capture, so predictProduction silently under-counts it and the live audit settles
  // a false conflict (and blocked-loss reads a wrong 0). The phantom signal is
  // map-agnostic — it's "a built thing we can't place", not a fixed 19/54 count — so it
  // holds on colonist's variable/alternate maps. A real colonist full state is sent
  // atomically and complete, so phantom stays 0 there and the audit still runs.
  // Is the captured geometry COMPLETE, not just non-empty? colonist never sends sea
  // tiles, so an edge corner legitimately touches < 3 land tiles — but a hex centre
  // that SIX distinct corners all point at is a real tile, so if it isn't in
  // tileHexStates a tile is missing (a partial frame the phantom check can't see when
  // the corner still resolves to its OTHER tiles). map-agnostic: derived from the
  // corner topology, never a fixed 19/54. (A hypothetical variant with a deliberate
  // six-cornered interior hole would be the lone false positive; no live map has one.)
  function geomComplete(b) {
    const refs = {};
    for (const ci of Object.keys(b.corners)) {
      const c = b.corners[ci];
      if (c.x == null) continue;
      for (const p of tilesOfCorner(c)) refs[p[0] + ',' + p[1]] = (refs[p[0] + ',' + p[1]] || 0) + 1;
    }
    for (const k of Object.keys(refs)) {
      if (refs[k] >= 6 && b.coordToTile[k] == null) return false;   // a fully-surrounded tile is absent
    }
    return true;
  }
  function geomReady(b) {
    return Object.keys(b.tiles).length > 0 && Object.keys(b.corners).length > 0
      && (b.robberTile == null || b.tiles[b.robberTile] != null)
      && cornerDiag(b).phantom === 0
      && geomComplete(b);
  }
  // A roll arrived: close out the previous roll, then snapshot the prediction for
  // this one (using the robber position at roll time). Only audit a roll when the
  // geometry is actually loaded — with no full state (board started from diffs, or an
  // empty shell) predictProduction would return {} for EVERY roll, so a real
  // production would settle the next roll as a false conflict. No geometry → don't
  // open the round (it's inconclusive, not evidence).
  function auditRoll(b, n) {
    settleAudit(b);
    if (!geomReady(b)) { b.audit.expect = null; b.audit.actual = {}; return; }
    b.audit.expect = { roll: n, robber: b.robberTile, pred: predictProduction(b, n) };
    b.audit.actual = {};
  }
  // A type-47 production broadcast: accumulate the real cards into the in-flight
  // roll's actual tally (only between a roll and the next — setup placement 47s
  // arrive with no roll open and are ignored).
  function auditProduce(b, color, cards) {
    const au = b.audit;
    if (!au || !au.expect || color == null || !cards || !cards.length) return;
    const o = au.actual[color] || (au.actual[color] = {});
    for (const c of cards) if (c >= 1 && c <= 5) o[c] = (o[c] || 0) + 1;
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

  // Per-colour EXPECTED production per dice roll: Σ over a player's buildings of
  // weight × P(number) for each adjacent numbered tile, with P(n) = pipDots(n)/36
  // and weight = 1 (settlement) / 2 (city). Unlike pipsOf (coverage) it does NOT
  // dedup a shared tile — each building produces on its own — and it weights a city
  // ×2. The robber tile is excluded (no production there right now).
  function expectedPipsOf(b) {
    const out = {};
    for (const ci of Object.keys(b.corners)) {
      const c = b.corners[ci];
      if (c.owner == null || !c.buildingType) continue;
      const weight = c.buildingType === 2 ? 2 : 1;
      const o = out[c.owner] || (out[c.owner] = { total: 0, byRes: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } });
      for (const ti of tilesOfCornerIdx(b, ci)) {
        if (b.robberTile != null && String(ti) === String(b.robberTile)) continue;
        const t = b.tiles[ti];
        if (!t || t.type < 1 || t.type > 5) continue;
        const p = pipDots(t.number);
        if (!p) continue;
        const exp = (p / 36) * weight;
        o.total += exp;
        o.byRes[t.type] += exp;
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
    blockedDetailOf: (b, color) => b.blockedDetail[color] || {},
    // geometry self-audit: {confirms, conflicts, trail[]}. auditSettle closes the
    // last in-flight roll on demand (game end) so its verdict isn't lost.
    auditOf: (b) => b.audit,
    auditSettle: (b) => settleAudit(b),
    predictProduction,
    // geometry is usable for ⛔ once a full state has populated tiles AND corners,
    // AND the current robber tile is actually loaded — a partial/early snapshot that
    // doesn't yet contain the robber's hex can't be trusted to read a 0 (vs a shell,
    // where a 0 would silently replace a known differential). `ready` alone only means
    // "a type-4 was applied", which could be an empty shell.
    geomReady,
    geomComplete,
    // Snapshot/restore the event-derived state as one unit. Restoring processedLog
    // together with every accumulator it guards lets a same-game reconnect skip old
    // history while retaining the exact live ordering of silent dev-card buys.
    // blockedLoss is intentionally separate: robber history has its own snapshot.
    accrualSnapshot: (b) => ({
      gameId: b.gameId,
      handRecon: JSON.parse(JSON.stringify(b.handRecon || {})),
      processedLog: [...b.processedLog],
      seenLog: b.seenLog,
      wsStats: JSON.parse(JSON.stringify(b.wsStats || {})),
      dice: JSON.parse(JSON.stringify(b.dice || { counts: {}, total: 0, rolls: [] })),
      logTypeCounts: { ...(b.logTypeCounts || {}) },
      devBought: { ...(b.devBought || {}) },
      devHeld: { ...(b.devHeld || {}) },
      devUsed: { ...(b.devUsed || {}) },
      devApplied: { ...(b.devApplied || {}) },
    }),
    restoreAccrual: (b, snap) => {
      if (!snap) return;
      if (b.gameId != null && snap.gameId !== b.gameId) return;
      if (snap.gameId != null) b.gameId = snap.gameId;
      b.handRecon = snap.handRecon ? JSON.parse(JSON.stringify(snap.handRecon)) : {};
      b.processedLog = new Set(Array.isArray(snap.processedLog) ? snap.processedLog : []);
      b.seenLog = Number.isFinite(snap.seenLog) ? snap.seenLog : -1;
      b.wsStats = snap.wsStats ? JSON.parse(JSON.stringify(snap.wsStats)) : {};
      b.dice = snap.dice ? JSON.parse(JSON.stringify(snap.dice)) : { counts: {}, total: 0, rolls: [] };
      b.logTypeCounts = { ...(snap.logTypeCounts || {}) };
      b.devBought = { ...(snap.devBought || {}) };
      b.devHeld = { ...(snap.devHeld || {}) };
      b.devUsed = { ...(snap.devUsed || {}) };
      b.devApplied = { ...(snap.devApplied || {}) };
    },
    // snapshot/restore the live blocked-loss so it survives F5: the board can't
    // replay past robber positions, so the displayed value persists through the board
    // (tagged with the game id, so a different game's restore is dropped).
    blockedSnapshot: (b) => ({ gameId: b.gameId, loss: { ...b.blockedLoss }, detail: JSON.parse(JSON.stringify(b.blockedDetail || {})) }),
    restoreBlocked: (b, snap) => {
      if (!snap) return;
      // never clobber a board that has ALREADY been advanced to a game — whether the
      // snapshot is for a DIFFERENT game or is a legacy id-less blob (treat a missing
      // snapshot id as non-matching, so it can't pollute an established new game).
      if (b.gameId != null && snap.gameId !== b.gameId) return;
      if (snap.gameId != null) b.gameId = snap.gameId;
      b.blockedLoss = { ...(snap.loss || {}) };
      b.blockedDetail = snap.detail ? JSON.parse(JSON.stringify(snap.detail)) : {};
    },
    pipsOf, expectedPipsOf,
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
    // are phantoms (no coordinates, or resolve to NO tiles — geometry we never
    // captured). geomReady gates on phantom === 0.
    cornerDiag,
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
