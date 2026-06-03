'use strict';

// Real colonist.io game-log messages captured from a live game (console dump,
// indices 78-87). These are the GROUND TRUTH the parser must satisfy. Class
// suffixes (e.g. feedMessage-O8TLknGe) are CSS-module hashes and may change on
// a future colonist deploy; the parser matches by class *prefix*, so the exact
// suffix here only needs to stay internally consistent for the tests.
//
// Player colours seen in this game:
//   StanTheMan01 #CF4449 (the local human, avatar icon_player_loggedin)
//   Richia       #228103 (bot)
//   Tearle       #CF6B2E (bot)
//   Masera       #285FBD (bot)

const fixtures = {
  // "Tearle stole [hidden card] from Masera" — knight/robber steal. The card is
  // card_rescardback (a face-down card), NOT a real resource, so the victim's
  // stolen card is unknown.
  steal_hidden: `<div class="feedMessage-O8TLknGe" style="opacity: 1;"><div class="container-k26ZLqas hideBackground-tkyRocbV avatar-yelUykqb"><img draggable="false" class="avatarImage-JNCoQelY undefined" src="https://cdn.colonist.io/dist/assets/icon_bot.551858c518b9f2f8357a.svg"></div><span class="messagePart-XeUsOgLX"><span style="font-weight:600;word-break:break-all;color:#CF6B2E">Tearle</span> stole <img src="https://cdn.colonist.io/dist/assets/card_rescardback.03c18312a76028b0d9c9.svg" alt="Resource Card" height="20" width="14.25" class="lobbyChatTextIcon"> from <span style="font-weight:600;word-break:break-all;color:#285FBD">Masera</span></span></div>`,

  // "Richia rolled [2] [2]" — sum 4.
  roll_2_2: `<div class="feedMessage-O8TLknGe" style="opacity: 1;"><div class="container-k26ZLqas hideBackground-tkyRocbV avatar-yelUykqb"><img draggable="false" class="avatarImage-JNCoQelY undefined" src="https://cdn.colonist.io/dist/assets/icon_bot.551858c518b9f2f8357a.svg"></div><span class="messagePart-XeUsOgLX"><span style="font-weight:600;word-break:break-all;color:#228103">Richia</span> rolled <img src="https://cdn.colonist.io/dist/assets/dice_2.05d31959b2838006865b.svg" alt="dice_2" height="20" width="20" class="lobbyChatTextIcon"> <img src="https://cdn.colonist.io/dist/assets/dice_2.05d31959b2838006865b.svg" alt="dice_2" height="20" width="20" class="lobbyChatTextIcon"></span></div>`,

  // "StanTheMan01 got [grain]" — local human gains 1 grain. Avatar is
  // icon_player_loggedin (used to detect selfName).
  got_self_grain: `<div class="feedMessage-O8TLknGe" style="opacity: 1;"><div class="container-k26ZLqas hideBackground-tkyRocbV avatar-yelUykqb"><img draggable="false" class="avatarImage-JNCoQelY" src="https://cdn.colonist.io/dist/assets/icon_player_loggedin.0269225ae4f7db8480ca.svg"></div><span class="messagePart-XeUsOgLX"><span style="font-weight:600;word-break:break-all;color:#CF4449">StanTheMan01</span> got <img src="https://cdn.colonist.io/dist/assets/card_grain.09c9d82146a64bce69b5.svg" alt="Grain" height="20" width="14.25" class="lobbyChatTextIcon"></span></div>`,

  // "Tearle got [brick]"
  got_bot_brick: `<div class="feedMessage-O8TLknGe" style="opacity: 1;"><div class="container-k26ZLqas hideBackground-tkyRocbV avatar-yelUykqb"><img draggable="false" class="avatarImage-JNCoQelY undefined" src="https://cdn.colonist.io/dist/assets/icon_bot.551858c518b9f2f8357a.svg"></div><span class="messagePart-XeUsOgLX"><span style="font-weight:600;word-break:break-all;color:#CF6B2E">Tearle</span> got <img src="https://cdn.colonist.io/dist/assets/card_brick.5950ea07a7ea01bc54a5.svg" alt="Brick" height="20" width="14.25" class="lobbyChatTextIcon"></span></div>`,

  // "Richia got [brick] [grain]"
  got_bot_brick_grain: `<div class="feedMessage-O8TLknGe" style="opacity: 1;"><div class="container-k26ZLqas hideBackground-tkyRocbV avatar-yelUykqb"><img draggable="false" class="avatarImage-JNCoQelY undefined" src="https://cdn.colonist.io/dist/assets/icon_bot.551858c518b9f2f8357a.svg"></div><span class="messagePart-XeUsOgLX"><span style="font-weight:600;word-break:break-all;color:#228103">Richia</span> got <img src="https://cdn.colonist.io/dist/assets/card_brick.5950ea07a7ea01bc54a5.svg" alt="Brick" height="20" width="14.25" class="lobbyChatTextIcon"> <img src="https://cdn.colonist.io/dist/assets/card_grain.09c9d82146a64bce69b5.svg" alt="Grain" height="20" width="14.25" class="lobbyChatTextIcon"></span></div>`,

  // "Richia wants to give [grain] for [lumber]" — a PROPOSAL, not executed.
  // Must be ignored so the dangling " for " never reaches the trade splitter.
  trade_proposal: `<div class="feedMessage-O8TLknGe" style="opacity: 1;"><div class="container-k26ZLqas hideBackground-tkyRocbV avatar-yelUykqb"><img draggable="false" class="avatarImage-JNCoQelY undefined" src="https://cdn.colonist.io/dist/assets/icon_bot.551858c518b9f2f8357a.svg"></div><span class="messagePart-XeUsOgLX"><span style="font-weight:600;word-break:break-all;color:#228103">Richia</span> wants to give <img src="https://cdn.colonist.io/dist/assets/card_grain.09c9d82146a64bce69b5.svg" alt="Grain" height="20" width="14.25" class="lobbyChatTextIcon"> for <img src="https://cdn.colonist.io/dist/assets/card_lumber.cf22f8083cf89c2a29e7.svg" alt="Lumber" height="20" width="14.25" class="lobbyChatTextIcon"></span></div>`,

  // "Richia gave [grain] and got [lumber] from StanTheMan01" — EXECUTED trade.
  // Actor Richia: -grain +lumber. Counterparty StanTheMan01: +grain -lumber.
  // This is the message the old code mis-handled (counted as a pure gain).
  trade_executed: `<div class="feedMessage-O8TLknGe" style="opacity: 1;"><div class="container-k26ZLqas hideBackground-tkyRocbV avatar-yelUykqb"><img draggable="false" class="avatarImage-JNCoQelY undefined" src="https://cdn.colonist.io/dist/assets/icon_bot.551858c518b9f2f8357a.svg"></div><span class="messagePart-XeUsOgLX"><span style="font-weight:600;word-break:break-all;color:#228103">Richia</span> gave <img src="https://cdn.colonist.io/dist/assets/card_grain.09c9d82146a64bce69b5.svg" alt="Grain" height="20" width="14.25" class="lobbyChatTextIcon"> and got <img src="https://cdn.colonist.io/dist/assets/card_lumber.cf22f8083cf89c2a29e7.svg" alt="Lumber" height="20" width="14.25" class="lobbyChatTextIcon"> from <span style="font-weight:600;word-break:break-all;color:#CF4449">StanTheMan01</span></span></div>`,

  // "Richia built a Road [road icon]" — costs lumber + brick.
  built_road: `<div class="feedMessage-O8TLknGe" style="opacity: 1;"><div class="container-k26ZLqas hideBackground-tkyRocbV avatar-yelUykqb"><img draggable="false" class="avatarImage-JNCoQelY undefined" src="https://cdn.colonist.io/dist/assets/icon_bot.551858c518b9f2f8357a.svg"></div><span class="messagePart-XeUsOgLX"><span style="font-weight:600;word-break:break-all;color:#228103">Richia</span> built a Road <img src="https://cdn.colonist.io/dist/assets/road_green.d206aed3747b3687bc40.svg" alt="road" height="20" width="20" class="lobbyChatTextIcon"></span></div>`,

  // ---- Second capture (indices 313-321): bank trade, build city, discards,
  // robber move, and the local human's own (revealed) steal. ----

  // "Docila built a City (+1 VP) [city icon]" — costs ore*3 + grain*2.
  built_city: `<div class="feedMessage-O8TLknGe" style="opacity: 1;"><div class="container-k26ZLqas hideBackground-tkyRocbV avatar-yelUykqb"><img draggable="false" class="avatarImage-JNCoQelY undefined" src="https://cdn.colonist.io/dist/assets/icon_bot.551858c518b9f2f8357a.svg"></div><span class="messagePart-XeUsOgLX"><span style="font-weight:600;word-break:break-all;color:#285FBD">Docila</span> built a City <img src="https://cdn.colonist.io/dist/assets/city_blue.43d846e83515f35f51f6.svg" alt="city" height="20" width="20" class="lobbyChatTextIcon"> (<span class="vp-text">+1 VP</span>)</span></div>`,

  // "Docila gave bank [brick]x4 and took [wool]" — 4:1 bank trade.
  bank_trade: `<div class="feedMessage-O8TLknGe" style="opacity: 1;"><div class="container-k26ZLqas hideBackground-tkyRocbV avatar-yelUykqb"><img draggable="false" class="avatarImage-JNCoQelY undefined" src="https://cdn.colonist.io/dist/assets/icon_bot.551858c518b9f2f8357a.svg"></div><span class="messagePart-XeUsOgLX"><span style="font-weight:600;word-break:break-all;color:#285FBD">Docila</span> gave bank <img src="https://cdn.colonist.io/dist/assets/card_brick.5950ea07a7ea01bc54a5.svg" alt="Brick" height="20" width="14.25" class="lobbyChatTextIcon"> <img src="https://cdn.colonist.io/dist/assets/card_brick.5950ea07a7ea01bc54a5.svg" alt="Brick" height="20" width="14.25" class="lobbyChatTextIcon"> <img src="https://cdn.colonist.io/dist/assets/card_brick.5950ea07a7ea01bc54a5.svg" alt="Brick" height="20" width="14.25" class="lobbyChatTextIcon"> <img src="https://cdn.colonist.io/dist/assets/card_brick.5950ea07a7ea01bc54a5.svg" alt="Brick" height="20" width="14.25" class="lobbyChatTextIcon"> and took <img src="https://cdn.colonist.io/dist/assets/card_wool.17a6dea8d559949f0ccc.svg" alt="Wool" height="20" width="14.25" class="lobbyChatTextIcon"></span></div>`,

  // "StanTheMan01 rolled [2] [5]" — sum 7 (robber).
  roll_2_5: `<div class="feedMessage-O8TLknGe" style="opacity: 1;"><div class="container-k26ZLqas hideBackground-tkyRocbV avatar-yelUykqb"><img draggable="false" class="avatarImage-JNCoQelY" src="https://cdn.colonist.io/dist/assets/icon_player_loggedin.0269225ae4f7db8480ca.svg"></div><span class="messagePart-XeUsOgLX"><span style="font-weight:600;word-break:break-all;color:#CF4449">StanTheMan01</span> rolled <img src="https://cdn.colonist.io/dist/assets/dice_2.05d31959b2838006865b.svg" alt="dice_2" height="20" width="20" class="lobbyChatTextIcon"> <img src="https://cdn.colonist.io/dist/assets/dice_5.e2e4c9085fa4a5ed783a.svg" alt="dice_5" height="20" width="20" class="lobbyChatTextIcon"></span></div>`,

  // "Bot is selecting cards to discard for Aletha" — status only, no cards.
  // Note the trailing " for " here must NOT trip the trade splitter.
  discard_announce: `<div class="feedMessage-O8TLknGe" style="opacity: 1;"><div class="container-k26ZLqas hideBackground-tkyRocbV avatar-yelUykqb"><img draggable="false" class="avatarImage-JNCoQelY undefined" src="https://cdn.colonist.io/dist/assets/icon_bot.551858c518b9f2f8357a.svg"></div><span class="messagePart-XeUsOgLX">Bot is selecting cards to discard for <span style="font-weight:600;word-break:break-all;color:#228103">Aletha</span></span></div>`,

  // "StanTheMan01 discarded [ore][ore][grain][grain][ore]" — robber discard.
  discard_self: `<div class="feedMessage-O8TLknGe" style="opacity: 1;"><div class="container-k26ZLqas hideBackground-tkyRocbV avatar-yelUykqb"><img draggable="false" class="avatarImage-JNCoQelY" src="https://cdn.colonist.io/dist/assets/icon_player_loggedin.0269225ae4f7db8480ca.svg"></div><span class="messagePart-XeUsOgLX"><span style="font-weight:600;word-break:break-all;color:#CF4449">StanTheMan01</span> discarded <img src="https://cdn.colonist.io/dist/assets/card_ore.117f64dab28e1c987958.svg" alt="Ore" height="20" width="14.25" class="lobbyChatTextIcon"> <img src="https://cdn.colonist.io/dist/assets/card_ore.117f64dab28e1c987958.svg" alt="Ore" height="20" width="14.25" class="lobbyChatTextIcon"> <img src="https://cdn.colonist.io/dist/assets/card_grain.09c9d82146a64bce69b5.svg" alt="Grain" height="20" width="14.25" class="lobbyChatTextIcon"> <img src="https://cdn.colonist.io/dist/assets/card_grain.09c9d82146a64bce69b5.svg" alt="Grain" height="20" width="14.25" class="lobbyChatTextIcon"> <img src="https://cdn.colonist.io/dist/assets/card_ore.117f64dab28e1c987958.svg" alt="Ore" height="20" width="14.25" class="lobbyChatTextIcon"></span></div>`,

  // "StanTheMan01 moved Robber to [prob_6][lumber tile]" — no resource effect.
  // The tile icon src is generated_tile_lumber (NOT card_lumber) and must not
  // be miscounted as a lumber card.
  robber_move: `<div class="feedMessage-O8TLknGe" style="opacity: 1;"><div class="container-k26ZLqas hideBackground-tkyRocbV avatar-yelUykqb"><img draggable="false" class="avatarImage-JNCoQelY" src="https://cdn.colonist.io/dist/assets/icon_player_loggedin.0269225ae4f7db8480ca.svg"></div><span class="messagePart-XeUsOgLX"><span style="font-weight:600;word-break:break-all;color:#CF4449">StanTheMan01</span> moved Robber <img src="https://cdn.colonist.io/dist/assets/icon_robber.2b909f277d60f24633e8.svg" alt="robber" height="20" width="20" class="lobbyChatTextIcon"> to  <img src="https://cdn.colonist.io/dist/assets/prob_6.ada0b8434cfe315beb72.svg" alt="prob_6" height="20" width="20" class="lobbyChatTextIcon"> <img src="https://cdn.colonist.io/dist/assets/generated_tile_lumber.ce98887f6f467e76852f.svg" alt="lumber tile" height="20" width="17.299999999999997" class="lobbyChatTextIcon"></span></div>`,

  // "You stole [wool] from Zinn" — the LOCAL human steals; colonist reveals the
  // real card. The only coloured name is the VICTIM (Zinn), not the thief, and
  // the avatar is the local human's icon_player_loggedin.
  you_stole_wool: `<div class="feedMessage-O8TLknGe" style="opacity: 1;"><div class="container-k26ZLqas hideBackground-tkyRocbV avatar-yelUykqb"><img draggable="false" class="avatarImage-JNCoQelY" src="https://cdn.colonist.io/dist/assets/icon_player_loggedin.0269225ae4f7db8480ca.svg"></div><span class="messagePart-XeUsOgLX">You stole <img src="https://cdn.colonist.io/dist/assets/card_wool.17a6dea8d559949f0ccc.svg" alt="Wool" height="20" width="14.25" class="lobbyChatTextIcon"> from <span style="font-weight:600;word-break:break-all;color:#CF6B2E">Zinn</span></span></div>`,

  // ---- Third capture (full 273-message game): dev cards, monopoly, knight,
  // starting resources, free placement, multi-card trade, info lines. ----

  // "StanTheMan01 bought [Development Card]" — costs wool + grain + ore.
  buy_devcard: `<div class="feedMessage-O8TLknGe" style="opacity: 1;"><div class="container-k26ZLqas hideBackground-tkyRocbV avatar-yelUykqb"><img draggable="false" class="avatarImage-JNCoQelY" src="https://cdn.colonist.io/dist/assets/icon_player_loggedin.0269225ae4f7db8480ca.svg"></div><span class="messagePart-XeUsOgLX"><span style="font-weight:600;word-break:break-all;color:#CF4449">StanTheMan01</span> bought <img src="https://cdn.colonist.io/dist/assets/card_devcardback.92569a1abd04a8c1c17e.svg" alt="Development Card" height="20" width="14.25" class="lobbyChatTextIcon"></span></div>`,

  // "StanTheMan01 received starting resources [lumber][wool]" — initial yield.
  starting_resources: `<div class="feedMessage-O8TLknGe" style="opacity: 1;"><div class="container-k26ZLqas hideBackground-tkyRocbV avatar-yelUykqb"><img draggable="false" class="avatarImage-JNCoQelY" src="https://cdn.colonist.io/dist/assets/icon_player_loggedin.0269225ae4f7db8480ca.svg"></div><span class="messagePart-XeUsOgLX"><span style="font-weight:600;word-break:break-all;color:#CF4449">StanTheMan01</span> received starting resources <img src="https://cdn.colonist.io/dist/assets/card_lumber.cf22f8083cf89c2a29e7.svg" alt="Lumber" height="20" width="14.25" class="lobbyChatTextIcon"> <img src="https://cdn.colonist.io/dist/assets/card_wool.17a6dea8d559949f0ccc.svg" alt="Wool" height="20" width="14.25" class="lobbyChatTextIcon"></span></div>`,

  // "Thant placed a Settlement [icon]" — free initial placement (no cost).
  placed_settlement: `<div class="feedMessage-O8TLknGe" style="opacity: 1;"><div class="container-k26ZLqas hideBackground-tkyRocbV avatar-yelUykqb"><img draggable="false" class="avatarImage-JNCoQelY undefined" src="https://cdn.colonist.io/dist/assets/icon_bot.551858c518b9f2f8357a.svg"></div><span class="messagePart-XeUsOgLX"><span style="font-weight:600;word-break:break-all;color:#285FBD">Thant</span> placed a Settlement <img src="https://cdn.colonist.io/dist/assets/settlement_blue.bad4cdb43d65c329deda.svg" alt="settlement" height="20" width="20" class="lobbyChatTextIcon"></span></div>`,

  // "Thant built a Settlement (+1 VP) [icon]" — costs lumber+brick+wool+grain.
  built_settlement: `<div class="feedMessage-O8TLknGe" style="opacity: 1;"><div class="container-k26ZLqas hideBackground-tkyRocbV avatar-yelUykqb"><img draggable="false" class="avatarImage-JNCoQelY undefined" src="https://cdn.colonist.io/dist/assets/icon_bot.551858c518b9f2f8357a.svg"></div><span class="messagePart-XeUsOgLX"><span style="font-weight:600;word-break:break-all;color:#285FBD">Thant</span> built a Settlement <img src="https://cdn.colonist.io/dist/assets/settlement_blue.bad4cdb43d65c329deda.svg" alt="settlement" height="20" width="20" class="lobbyChatTextIcon"> (<span class="vp-text">+1 VP</span>)</span></div>`,

  // "StanTheMan01 used Monopoly [icon]" — announcement only; the resource
  // transfer is in the next message. Note the Monopoly word + icon live in a
  // tooltipTrigger sibling, NOT inside the first messagePart span.
  monopoly_used: `<div class="feedMessage-O8TLknGe" style="opacity: 1;"><div class="container-k26ZLqas hideBackground-tkyRocbV avatar-yelUykqb"><img draggable="false" class="avatarImage-JNCoQelY" src="https://cdn.colonist.io/dist/assets/icon_player_loggedin.0269225ae4f7db8480ca.svg"></div><span class="messagePart-XeUsOgLX"><span style="font-weight:600;word-break:break-all;color:#CF4449">StanTheMan01</span> used </span><div class="tooltipTrigger-RHbo1Dby messageWithTooltip-NtPXPG_9"><span> Monopoly <img src="https://cdn.colonist.io/dist/assets/card_monopoly.dfac189aaff62e271093.svg" alt="Monopoly" height="20" width="14.25" class="lobbyChatTextIcon"> </span></div><span class="messagePart-XeUsOgLX"></span></div>`,

  // "StanTheMan01 stole 4 [brick]" — Monopoly RESULT. The amount (4) is TEXT;
  // the brick icon appears once. Actor gains 4 brick; every opponent loses all
  // of theirs.
  monopoly_result: `<div class="feedMessage-O8TLknGe" style="opacity: 1;"><div class="container-k26ZLqas hideBackground-tkyRocbV avatar-yelUykqb"><img draggable="false" class="avatarImage-JNCoQelY" src="https://cdn.colonist.io/dist/assets/icon_player_loggedin.0269225ae4f7db8480ca.svg"></div><span class="messagePart-XeUsOgLX"><span style="font-weight:600;word-break:break-all;color:#CF4449">StanTheMan01</span> stole 4 <img src="https://cdn.colonist.io/dist/assets/card_brick.5950ea07a7ea01bc54a5.svg" alt="brick" height="20" width="14.25" class="lobbyChatTextIcon"></span></div>`,

  // "StanTheMan01 gave [wool][grain] and got [ore] from Thant" — 2-for-1 trade.
  trade_two_for_one: `<div class="feedMessage-O8TLknGe" style="opacity: 1;"><div class="container-k26ZLqas hideBackground-tkyRocbV avatar-yelUykqb"><img draggable="false" class="avatarImage-JNCoQelY" src="https://cdn.colonist.io/dist/assets/icon_player_loggedin.0269225ae4f7db8480ca.svg"></div><span class="messagePart-XeUsOgLX"><span style="font-weight:600;word-break:break-all;color:#CF4449">StanTheMan01</span> gave <img src="https://cdn.colonist.io/dist/assets/card_wool.17a6dea8d559949f0ccc.svg" alt="Wool" height="20" width="14.25" class="lobbyChatTextIcon"> <img src="https://cdn.colonist.io/dist/assets/card_grain.09c9d82146a64bce69b5.svg" alt="Grain" height="20" width="14.25" class="lobbyChatTextIcon"> and got <img src="https://cdn.colonist.io/dist/assets/card_ore.117f64dab28e1c987958.svg" alt="Ore" height="20" width="14.25" class="lobbyChatTextIcon"> from <span style="font-weight:600;word-break:break-all;color:#285FBD">Thant</span></span></div>`,

  // "No player to steal from" — robber landed but no victim. Contains "steal"
  // (NOT "stole"); must be ignored.
  no_player_to_steal: `<div class="feedMessage-O8TLknGe" style="opacity: 1;"><div class="container-k26ZLqas hideBackground-tkyRocbV avatar-yelUykqb"><img draggable="false" class="avatarImage-JNCoQelY undefined" src="https://cdn.colonist.io/dist/assets/icon_bot.551858c518b9f2f8357a.svg"></div><span class="messagePart-XeUsOgLX">No player to steal from</span></div>`,

  // "[tile] is blocked by the Robber. No resources produced" — info line, no
  // player span, no card. Must be ignored (and the tile icon not miscounted).
  blocked_by_robber: `<div class="feedMessage-O8TLknGe" style="opacity: 1;"><span class="messagePart-XeUsOgLX"> <img src="https://cdn.colonist.io/dist/assets/prob_11.102e16ed661168ddeec8.svg" alt="prob_11" height="20" width="20" class="lobbyChatTextIcon"> <img src="https://cdn.colonist.io/dist/assets/generated_tile_wool.29bcdda6873893e2a506.svg" alt="wool tile" height="20" width="17.299999999999997" class="lobbyChatTextIcon"> is blocked by the Robber. No resources produced</span></div>`,

  // ---- Fourth capture: Year of Plenty, Road Building, Largest Army. ----

  // "StanTheMan01 used Year of Plenty [icon]" — announcement only (tooltip
  // split structure). The actual take is the next message.
  year_of_plenty_used: `<div class="feedMessage-O8TLknGe" style="opacity: 1;"><div class="container-k26ZLqas hideBackground-tkyRocbV avatar-yelUykqb"><img draggable="false" class="avatarImage-JNCoQelY" src="https://cdn.colonist.io/dist/assets/icon_player_loggedin.0269225ae4f7db8480ca.svg"></div><span class="messagePart-XeUsOgLX"><span style="font-weight:600;word-break:break-all;color:#CF4449">StanTheMan01</span> used </span><div class="tooltipTrigger-RHbo1Dby messageWithTooltip-NtPXPG_9"><span> Year of Plenty <img src="https://cdn.colonist.io/dist/assets/card_yearofplenty.3df210b5455b7438db09.svg" alt="Year of Plenty" height="20" width="14.25" class="lobbyChatTextIcon"> </span></div><span class="messagePart-XeUsOgLX"></span></div>`,

  // "StanTheMan01 took from bank [grain][grain]" — Year of Plenty RESULT: a
  // free +2 from the bank. Handled by the gain branch's "took from bank" clause.
  year_of_plenty_took: `<div class="feedMessage-O8TLknGe" style="opacity: 1;"><div class="container-k26ZLqas hideBackground-tkyRocbV avatar-yelUykqb"><img draggable="false" class="avatarImage-JNCoQelY" src="https://cdn.colonist.io/dist/assets/icon_player_loggedin.0269225ae4f7db8480ca.svg"></div><span class="messagePart-XeUsOgLX"><span style="font-weight:600;word-break:break-all;color:#CF4449">StanTheMan01</span> took from bank <img src="https://cdn.colonist.io/dist/assets/card_grain.09c9d82146a64bce69b5.svg" alt="Grain" height="20" width="14.25" class="lobbyChatTextIcon"> <img src="https://cdn.colonist.io/dist/assets/card_grain.09c9d82146a64bce69b5.svg" alt="Grain" height="20" width="14.25" class="lobbyChatTextIcon"></span></div>`,

  // "StanTheMan01 used Road Building [icon]" — announcement; the two roads it
  // grants appear as FREE "placed a Road" lines (below), not "built".
  road_building_used: `<div class="feedMessage-O8TLknGe" style="opacity: 1;"><div class="container-k26ZLqas hideBackground-tkyRocbV avatar-yelUykqb"><img draggable="false" class="avatarImage-JNCoQelY" src="https://cdn.colonist.io/dist/assets/icon_player_loggedin.0269225ae4f7db8480ca.svg"></div><span class="messagePart-XeUsOgLX"><span style="font-weight:600;word-break:break-all;color:#CF4449">StanTheMan01</span> used </span><div class="tooltipTrigger-RHbo1Dby messageWithTooltip-NtPXPG_9"><span> Road Building <img src="https://cdn.colonist.io/dist/assets/card_roadbuilding.994e8f21698ce6c350bd.svg" alt="Road Building" height="20" width="14.25" class="lobbyChatTextIcon"> </span></div><span class="messagePart-XeUsOgLX"></span></div>`,

  // "StanTheMan01 placed a Road [icon]" — a FREE road (here from Road Building,
  // also used for initial placement). "placed" must NOT be charged like "built".
  placed_road: `<div class="feedMessage-O8TLknGe" style="opacity: 1;"><div class="container-k26ZLqas hideBackground-tkyRocbV avatar-yelUykqb"><img draggable="false" class="avatarImage-JNCoQelY" src="https://cdn.colonist.io/dist/assets/icon_player_loggedin.0269225ae4f7db8480ca.svg"></div><span class="messagePart-XeUsOgLX"><span style="font-weight:600;word-break:break-all;color:#CF4449">StanTheMan01</span> placed a Road <img src="https://cdn.colonist.io/dist/assets/road_red.41c6cbd9278108542715.svg" alt="road" height="20" width="20" class="lobbyChatTextIcon"></span></div>`,

  // "Frazer received Largest Army [icon] (+2 VPs)" — VP award, no resources. The
  // icon is icon_largest_army (not a card_<resource>), so nothing is counted.
  received_largest_army: `<div class="feedMessage-O8TLknGe" style="opacity: 1;"><div class="container-k26ZLqas hideBackground-tkyRocbV avatar-yelUykqb"><img draggable="false" class="avatarImage-JNCoQelY undefined" src="https://cdn.colonist.io/dist/assets/icon_bot.551858c518b9f2f8357a.svg"></div><span class="messagePart-XeUsOgLX"><span style="font-weight:600;word-break:break-all;color:#285FBD">Frazer</span> received Largest Army <img src="https://cdn.colonist.io/dist/assets/icon_largest_army.206b49b3c9d2b206f699.svg" alt="largest army" height="20" width="20" class="lobbyChatTextIcon"> (<span class="vp-text">+2 VPs</span>)</span></div>`,
};

module.exports = { fixtures };
