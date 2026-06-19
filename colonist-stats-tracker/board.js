'use strict';

// colonist game model from the WebSocket (id=130). Pure: every function takes the
// board object `b`. The board is canvas-only in the DOM, but the WS carries the
// real state — this turns it into queryable tiles/corners/robber + a live
// blocked-loss accumulator. Resource ids 1..5 (0 = desert); building types
// 1 = settlement, 2 = city.
(function () {
  // A corner (x,y,z) touches up to three hexes (axial coords). Derived from the
  // real board and verified (centre hex has exactly its six corners).
  function tilesOfCorner(c) {
    const x = c.x, y = c.y;
    return c.z === 0
      ? [[x, y], [x, y - 1], [x + 1, y - 1]]
      : [[x, y], [x + 1, y], [x + 1, y - 1]];
  }

  function createBoard() {
    return {
      tiles: {}, coordToTile: {}, corners: {}, cornersByTile: {},
      robberTile: null, selfColor: null, colorToName: {}, hands: {},
      blockedLoss: {}, wsStats: {}, seenLog: -1, _ready: false,
    };
  }

  // Per-colour Stats accumulators sourced from the WS game log (the Stats section
  // columns the protocol can give us precisely). Created lazily on first event.
  function ensureStats(b, color) {
    return b.wsStats[color] || (b.wsStats[color] = {
      discards: 0, discardCards: 0,
      gained: 0, gainedRes: {},
      monoTook: {}, monoLost: {},
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
      const text = gameLogState[String(k)] && gameLogState[String(k)].text;
      if (!text) continue;
      if (text.type === 55) {
        const cards = text.cardEnums || [];
        if (cards.length) {
          const s = ensureStats(b, text.playerColor);
          s.discards += 1;
          s.discardCards += cards.length;
        }
      } else if (text.type === 47 || text.type === 21) {
        // Gained: roll/placement production (47, cardsToBroadcast) and Year of
        // Plenty (21, cardEnums) — both resId arrays into the player's hand.
        const cards = text.cardsToBroadcast || text.cardEnums || [];
        if (cards.length) {
          const s = ensureStats(b, text.playerColor);
          for (const c of cards) { s.gained += 1; s.gainedRes[c] = (s.gainedRes[c] || 0) + 1; }
        }
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
        }
      } else if (text.type === 10 && fromDiff) {
        accrueBlocked(b, (text.firstDice || 0) + (text.secondDice || 0));
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

  const api = {
    createBoard, tilesOfCorner, applyFullState, applyDiff, tilesOfCornerIdx,
    handCountOf, handBreakdownOf,
    statsOf: (b, color) => b.wsStats[color] || null,
    ready: (b) => b._ready,
    robberTile: (b) => b.robberTile,
    blockedLossOf: (b, color) => b.blockedLoss[color] || 0,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else (typeof window !== 'undefined' ? window : globalThis).__cstBoard = api;
})();
