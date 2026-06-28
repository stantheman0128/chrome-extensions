'use strict';

// ⛔ Cards blocked, made EXACT at game end.
//
// The live differential estimate can't be perfect — a tile's production at the
// moment it was robbed lives only on the (canvas) board, never in the log. But
// colonist's Victory → Overview table prints the authoritative number per player
// (the stat_resource_income_blocked column). At game end we read it and let it
// override the estimate, so the archived record + final panel match colonist.
//
// DOM shape (from a real dump): a tabContent with a LEFT block (player name rows
// + a trophy header row) and a RIGHT block (a header row of stat icons, then one
// value row per player, in the same order).

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { cst, document } = require('./helpers/setup');
const A = 'https://cdn.colonist.io/dist/assets/';

// Build the Victory Overview table for `rows` = [{name, vp, vals:[6 stat numbers]}].
// Column order matches colonist: proposed_trades, successful_trades, resources_used,
// resource_income_blocked, dev_card_bought, dev_card_used.
const STAT_ICONS = ['stat_proposed_trades', 'stat_successful_trades', 'stat_resources_used',
  'stat_resource_income_blocked', 'stat_dev_card_bought', 'stat_dev_card_used'];

function mountVictory(rows) {
  document.body.innerHTML = '';
  const nameRows = rows.map((r) =>
    `<div class="row-x"><button class="playerInfo-x">` +
    `<div class="avatar-x"><img class="avatarImage-x" src="${A}icon_player_loggedin.0269225.svg"></div>` +
    `<div class="name-_hIK5BiV">${r.name}</div></button><div class="victoryPoint-x">${r.vp}</div></div>`).join('');
  const headerCells = STAT_ICONS.map((s) =>
    `<div class="tooltipTrigger-x"><img class="headerIcon-x" src="${A}${s}.abcdef12.svg"></div>`).join('');
  const valueRows = rows.map((r) =>
    `<div class="rowContainer-HGhPuTfK">` +
    r.vals.map((v) => `<div class="valueContainer-OL0PpZXd"><div class="value-myGdPGIC">${v}</div></div>`).join('') +
    `</div>`).join('');
  const html =
    `<div class="tabContent-nWOb5GyT">` +
      `<div class="container-left">` +
        `<div class="row-x"><div></div><div class="tooltipTrigger-x"><img class="trophyIcon-x" src="${A}icon_trophy.bc5c68.svg"></div></div>` +
        nameRows +
      `</div>` +
      `<div class="container-right">` +
        `<div class="headerContainer-kenX_tOW">${headerCells}</div>` +
        valueRows +
      `</div>` +
    `</div>`;
  const holder = document.createElement('div');
  holder.innerHTML = html;
  document.body.appendChild(holder.firstChild);
}

test('readEndgameBlocked reads the blocked column for each player', () => {
  cst.resetState();
  mountVictory([
    { name: 'StanTheMan01', vp: 14, vals: [0, 0, 65, 3, 7, 4] },  // blocked = 3
    { name: 'Lowery1419', vp: 4, vals: [0, 0, 19, 3, 1, 0] },     // blocked = 3
  ]);
  assert.deepEqual(cst.readEndgameBlocked(), { StanTheMan01: 3, Lowery1419: 3 });
});

test('blockLossOf returns colonist\'s exact value once captured, overriding the estimate', () => {
  cst.resetState();
  // An estimate that would (wrongly) read 4 from the differential is moot once
  // the exact endgame value is captured.
  cst.state.endgameBlocked = { StanTheMan01: 3 };
  assert.equal(cst.blockLossOf('StanTheMan01'), 3, 'exact value wins');
  assert.equal(cst.blockLossOf('Nobody'), 0, 'a player without an exact value falls through to the estimate');
});

test('buildGameRecord captures the exact blocked values from the Victory table', () => {
  cst.resetState();
  cst.getPlayer('StanTheMan01', '#CF4449');
  cst.getPlayer('Lowery1419', '#285FBD');
  mountVictory([
    { name: 'StanTheMan01', vp: 14, vals: [0, 0, 65, 3, 7, 4] },
    { name: 'Lowery1419', vp: 4, vals: [0, 0, 19, 3, 1, 0] },
  ]);
  const rec = cst.buildGameRecord('StanTheMan01');
  assert.equal(rec.blockLoss.StanTheMan01, 3, 'record uses colonist\'s exact blocked, not the estimate');
  assert.equal(rec.blockLoss.Lowery1419, 3);
});
