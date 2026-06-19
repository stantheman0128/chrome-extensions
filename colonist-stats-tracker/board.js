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
      robberTile: null, selfColor: null, colorToName: {},
      blockedLoss: {}, seenLog: -1, _ready: false,
    };
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
    if (diff.gameLogState) {
      const entries = Object.keys(diff.gameLogState)
        .map((k) => parseInt(k, 10))
        .filter((k) => k > b.seenLog)
        .sort((a, c) => a - c);
      for (const k of entries) {
        b.seenLog = k;
        const text = diff.gameLogState[String(k)] && diff.gameLogState[String(k)].text;
        if (text && text.type === 10) accrueBlocked(b, (text.firstDice || 0) + (text.secondDice || 0));
      }
    }
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
    ready: (b) => b._ready,
    robberTile: (b) => b.robberTile,
    blockedLossOf: (b, color) => b.blockedLoss[color] || 0,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else (typeof window !== 'undefined' ? window : globalThis).__cstBoard = api;
})();
