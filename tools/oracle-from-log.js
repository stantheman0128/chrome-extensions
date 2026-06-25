'use strict';

// Shared log→oracle helpers for the verification agent.
// Does NOT import board.js.

function countLogTypes(log) {
  const types = {};
  for (const key of Object.keys(log || {})) {
    const ty = log[key] && log[key].text && log[key].text.type;
    if (ty != null) types[ty] = (types[ty] || 0) + 1;
  }
  return types;
}

function accrueStatsFromLog(log) {
  const stats = {};
  const ensure = (color) => stats[color] || (stats[color] = {
    gained: 0,
    gainedRes: {},
    discards: 0,
    discardCards: 0,
    discardRes: {},
    monoTook: {},
  });

  for (const key of Object.keys(log || {}).map(Number).sort((a, b) => a - b)) {
    const text = log[String(key)] && log[String(key)].text;
    if (!text) continue;
    if (text.type === 55) {
      const cards = text.cardEnums || [];
      if (!cards.length) continue;
      const s = ensure(text.playerColor);
      s.discards += 1;
      s.discardCards += cards.length;
      for (const c of cards) s.discardRes[c] = (s.discardRes[c] || 0) + 1;
    } else if (text.type === 47 || text.type === 21) {
      const cards = text.cardsToBroadcast || text.cardEnums || [];
      if (!cards.length) continue;
      const s = ensure(text.playerColor);
      for (const c of cards) {
        s.gained += 1;
        s.gainedRes[c] = (s.gainedRes[c] || 0) + 1;
      }
    } else if (text.type === 86) {
      const res = text.cardEnum;
      const amt = text.amountStolen || 0;
      if (res != null && amt > 0) {
        const s = ensure(text.playerColor);
        s.monoTook[res] = (s.monoTook[res] || 0) + amt;
      }
    }
  }
  return stats;
}

function buildStatsOracle(log, meta) {
  return {
    meta: {
      ...meta,
      oraclePolicy: 'colonist gameLog broadcasts only (type 47/21 gained, 55 discard, 86 monopoly) — no board.js',
    },
    logTypeCounts: countLogTypes(log),
    statsFromLog: accrueStatsFromLog(log),
  };
}

module.exports = { countLogTypes, accrueStatsFromLog, buildStatsOracle };
