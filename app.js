// app.js — full trainer logic, fixed and self-contained
// Notes: includes canSplit, showConclusion, robust suggestAll (debounced), corrected monteCarlo,
// single-consume burn handling, defensive UI updates, and explicit re-enable of Start Round.

const RANKS = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
const MIN_BET = 50, BET_STEP = 50;
const clamp = (v,a,b) => Math.max(a, Math.min(b, v));
const randInt = n => Math.floor(Math.random()*n);
const rankValue = r => r === 'A' ? 11 : (['J','Q','K'].includes(r) ? 10 : Number(r));
const hiLo = r => (['2','3','4','5','6'].includes(r) ? 1 : (['7','8','9'].includes(r) ? 0 : -1));
const copy = o => JSON.parse(JSON.stringify(o));
const toNum = v => Number(v || 0);
const $ = id => document.getElementById(id);

// STATE
let state = {
  game: { defaultDecks: 8, deckCounts: {}, seen: 0, running: 0, rounds: [] },
  current: null,
  tableCards: [],
  burnPile: []
};
let nextTableId = 1, nextBurnId = 1;
let activeHandIndex = 0;
let pickerMode = null, pickerTimeout = null;

// --- Deck helpers
function initDeckCounts(decks) {
  const d = {};
  RANKS.forEach(r => d[r] = 4 * clamp(Math.round(decks), 1, 8));
  return d;
}
function consumeCard(rank) {
  if(!rank) return false;
  const avail = state.game.deckCounts[rank] || 0;
  if(avail <= 0) return false;
  state.game.deckCounts[rank] = avail - 1;
  state.game.seen++;
  state.game.running += hiLo(rank);
  return true;
}
function returnCard(rank) {
  if(!rank) return false;
  state.game.deckCounts[rank] = (state.game.deckCounts[rank] || 0) + 1;
  state.game.seen = Math.max(0, state.game.seen - 1);
  state.game.running -= hiLo(rank);
  return true;
}

// --- Logging
function log(msg) {
  const el = $('cardHistory');
  if(!el) return;
  const d = document.createElement('div');
  d.textContent = `${new Date().toLocaleTimeString()} — ${msg}`;
  el.prepend(d);
}

// --- UI: card grids
function buildCardGrid() {
  const cont = $('cardButtons'); if(!cont) return; cont.innerHTML = '';
  RANKS.forEach(r => {
    const b = document.createElement('div');
    b.className = 'card-btn';
    b.textContent = r;
    b.addEventListener('click', ev => {
      if(ev.shiftKey) addDealerCard(r);
      else if(ev.altKey) addTableCard(r);
      else addPlayerCard(r);
    });
    cont.appendChild(b);
  });

  const pg = $('pickerGrid'); if(pg){ pg.innerHTML = ''; RANKS.forEach(r => {
    const p = document.createElement('div');
    p.className = 'card-btn';
    p.textContent = r;
    p.addEventListener('click', () => {
      if(pickerMode === 'burn') pickBurnCard(r);
      else if(pickerMode === 'double') pickDoubleCard(r);
      else pickHitCard(r);
    });
    pg.appendChild(p);
  }); }
}

// --- UI updates
function updateAll() {
  if(!state.game.deckCounts || Object.keys(state.game.deckCounts).length === 0) {
    state.game.defaultDecks = clamp(toNum($('defaultDecks').value), 1, 8);
    state.game.deckCounts = initDeckCounts(state.game.defaultDecks);
  }
  if($('runCount')) $('runCount').textContent = state.game.running.toFixed(0);
  const decksLeft = Math.max(0.1, toNum($('decksLeft').value) || state.game.defaultDecks);
  if($('trueCount')) $('trueCount').textContent = (state.game.running / decksLeft).toFixed(2);
  if($('seenCount')) $('seenCount').textContent = state.game.seen;
  if($('balanceDisplay')) $('balanceDisplay').textContent = toNum($('cashBal').value).toFixed(2);
  updateUIState();
}
function updateUIState() {
  const hasRound = !!state.current && !state.current.locked;
  if($('startRound')) $('startRound').disabled = !!state.current && !state.current.locked;
  if($('cancelRound')) $('cancelRound').disabled = !hasRound;
  if($('endRound')) $('endRound').disabled = !hasRound;
  const actionsEnabled = hasRound && state.current.hands && state.current.hands.length > 0;
  if($('actHit')) $('actHit').disabled = !actionsEnabled;
  if($('actDouble')) $('actDouble').disabled = !actionsEnabled;
  if($('actStand')) $('actStand').disabled = !actionsEnabled;
  if($('actSplit')) $('actSplit').disabled = !actionsEnabled;
}

// --- Render hands, table, burns, rounds
function renderHands(){
  const area = $('handsArea'); if(!area) return; area.innerHTML = '';
  if(!state.current){ area.innerHTML = '<div class="small">No active round</div>'; updateUIState(); return; }

  const dealerPanel = document.createElement('div'); dealerPanel.className = 'hand';
  const dh = document.createElement('h4'); dh.textContent = 'Dealer cards (click to remove)'; dealerPanel.appendChild(dh);
  const drow = document.createElement('div'); drow.className = 'cards-row';
  state.current.dealer.forEach((c,i) => {
    const el = document.createElement('div'); el.className = 'card'; el.textContent = c; el.title = 'Click to remove dealer card'; el.style.cursor = 'pointer';
    el.addEventListener('click', () => { if(!confirm('Remove dealer card ' + c + '?')) return; removeDealerCardAt(i); });
    drow.appendChild(el);
  });
  dealerPanel.appendChild(drow);
  area.appendChild(dealerPanel);

  state.current.hands.forEach((h,i) => {
    const hp = document.createElement('div'); hp.className = 'hand' + (i===activeHandIndex ? ' active' : '');
    const header = document.createElement('h4'); header.textContent = i===0 ? 'Main hand' : 'Split hand ' + i;
    header.addEventListener('click', () => setActiveHand(i));
    hp.appendChild(header);

    const row = document.createElement('div'); row.className = 'cards-row';
    h.cards.forEach((c, ci) => {
      const ce = document.createElement('div'); ce.className = 'card'; ce.textContent = c;
      ce.addEventListener('click', () => {
        if(h.stood || h.finished) return;
        if(!confirm('Remove this card?')) return;
        const rem = h.cards.splice(ci,1)[0];
        returnCard(rem);
        log('Removed ' + rem + ' from hand ' + (i+1));
        renderHands(); updateAll(); suggestAll();
      });
      row.appendChild(ce);
    });
    hp.appendChild(row);

    const meta = document.createElement('div'); meta.className = 'meta';
    const sum = h.cards.length ? handValue(h.cards).sum : 0;
    const flags = []; if(h.doubled) flags.push('Doubled'); if(h.stood) flags.push('Stood'); if(h.isSplitAce) flags.push('SplitAce'); if(h.finished) flags.push('Done');
    meta.textContent = 'Sum: ' + sum + ' · Bet: ' + h.bet.toFixed(0) + (flags.length ? ' · ' + flags.join(' · ') : '');
    hp.appendChild(meta);

    area.appendChild(hp);
  });

  updateUIState();
}

function updateTable() {
  const wrap = $('tableCards'); if(!wrap) return; wrap.innerHTML = '';
  (state.tableCards || []).forEach(tc => {
    const el = document.createElement('div'); el.className = 'table-chip'; el.textContent = tc.rank;
    el.title = 'Click to remove table card';
    el.addEventListener('click', () => {
      if(!confirm('Remove table card ' + tc.rank + '?')) return;
      const idx = state.tableCards.findIndex(x => x.id === tc.id);
      if(idx >= 0){ const rem = state.tableCards.splice(idx,1)[0]; returnCard(rem.rank); updateTable(); updateAll(); suggestAll(); log('Removed table card ' + rem.rank); }
    });
    wrap.appendChild(el);
  });
}

function updateBurn() {
  const wrap = $('burnPile'); if(!wrap) return; wrap.innerHTML = '';
  (state.burnPile || []).forEach(b => {
    const el = document.createElement('div'); el.className = 'burn-chip'; el.textContent = b.rank;
    el.title = 'Click to remove burned card';
    el.addEventListener('click', () => {
      if(!confirm('Remove burned card ' + b.rank + '?')) return;
      const idx = state.burnPile.findIndex(x => x.id === b.id);
      if(idx >= 0){ const rem = state.burnPile.splice(idx,1)[0]; returnCard(rem.rank); updateBurn(); updateAll(); suggestAll(); log('Removed burned card ' + rem.rank); }
    });
    wrap.appendChild(el);
  });
}

function updateRounds() {
  const el = $('roundList'); if(!el) return; el.innerHTML = '';
  (state.game.rounds || []).slice().reverse().forEach(r => {
    const d = document.createElement('div'); d.className = 'small';
    const hands = r.hands.map(h => h.cards.join(' ') + ' (' + h.bet.toFixed(0) + ')').join(' | ');
    d.textContent = 'Dealer ' + (r.dealer||[]).join(', ') + ' · ' + hands + ' · Net ' + r.net.toFixed(2) + (r.burned && r.burned.length ? ' · Burned '+ r.burned.map(x=>x.rank).join(',') : '');
    el.appendChild(d);
  });
}

// --- Core flows
function startNewGame() {
  if(!confirm('Start a new game? This resets the composition and clears history.')) return;
  state.game.defaultDecks = clamp(toNum($('defaultDecks').value), 1, 8);
  state.game.deckCounts = initDeckCounts(state.game.defaultDecks);
  state.game.seen = 0; state.game.running = 0; state.game.rounds = [];
  state.current = null; state.tableCards = []; state.burnPile = [];
  nextTableId = 1; nextBurnId = 1; activeHandIndex = 0;
  updateAll(); renderHands(); updateTable(); updateBurn(); updateRounds();
  log('New game started.');
}

function resetAll() {
  if(!confirm('Reset everything?')) return;
  state.game = { defaultDecks: toNum($('defaultDecks').value)||8, deckCounts: initDeckCounts(toNum($('defaultDecks').value)||8), seen: 0, running: 0, rounds: [] };
  state.current = null; state.tableCards = []; state.burnPile = [];
  nextTableId = 1; nextBurnId = 1; activeHandIndex = 0;
  updateAll(); renderHands(); updateTable(); updateBurn(); updateRounds();
  log('Reset all.');
}

function startRound() {
  if(state.current && !state.current.locked) return alert('Finish active round first');
  const bet = normalizeBet(toNum($('bet').value));
  if($('bet')) $('bet').value = bet;
  const hand = { cards: [], bet, doubled: false, stood: false, finished: false, isSplitAce: false };
  state.current = { hands: [hand], dealer: [], splitUsed: false, locked: false };
  activeHandIndex = 0;
  updateAll(); renderHands(); suggestAll();
  log('Round started. Bet ' + bet);
}

function cancelRound() {
  if(!state.current) return;
  state.current.hands.forEach(h => h.cards.forEach(c => returnCard(c)));
  state.current.dealer.forEach(c => returnCard(c));
  state.tableCards.forEach(tc => returnCard(tc.rank));
  state.burnPile.forEach(b => returnCard(b.rank));
  state.current = null; state.tableCards = []; state.burnPile = [];
  nextTableId = 1; nextBurnId = 1; activeHandIndex = 0;
  updateAll(); renderHands(); updateTable(); updateBurn(); updateRounds();
  log('Round canceled and cards returned.');
}

// --- Add/remove actions
function addPlayerCard(rank) {
  if(!state.current) return alert('Start a round first');
  const idx = activeHandIndex>=0?activeHandIndex:0;
  const hand = state.current.hands[idx];
  if(!hand) return alert('No active hand');
  if(hand.stood || hand.finished) return alert('Active hand locked');
  if(!consumeCard(rank)) return alert('No ' + rank + ' left in composition');
  hand.cards.push(rank);
  log('Player card added to hand ' + (idx+1) + ': ' + rank);
  renderHands(); updateAll(); suggestAll();
}
function addDealerCard(rank) {
  if(!state.current){
    if(!consumeCard(rank)) return alert('No ' + rank + ' left');
    state.current = { hands: [], dealer: [rank], splitUsed: false, locked: false };
    log('Dealer card added (no round): ' + rank);
  } else {
    if(!consumeCard(rank)) return alert('No ' + rank + ' left');
    state.current.dealer.push(rank);
    log('Dealer card added: ' + rank);
  }
  renderHands(); updateAll(); suggestAll();
}
function removeDealerCardAt(i) {
  if(!state.current || !state.current.dealer || i < 0 || i >= state.current.dealer.length) return;
  const removed = state.current.dealer.splice(i,1)[0];
  returnCard(removed);
  log('Removed dealer card: ' + removed);
  renderHands(); updateAll(); suggestAll();
}
function addTableCard(rank) {
  if(!consumeCard(rank)) return alert('No ' + rank + ' left');
  const id = nextTableId++;
  state.tableCards.push({ rank, id });
  log('Table card added: ' + rank);
  updateTable(); updateAll(); suggestAll();
}

// --- Burn handling: addBurnCard does NOT consume; callers must consume once
function addBurnCard(rank){
  const id = nextBurnId++;
  state.burnPile.push({ rank, id });
  log('Burned card recorded: ' + rank);
  updateBurn(); updateAll(); suggestAll();
}

// --- Undo
function undoLast() {
  if(!state.current) return alert('No active round');
  for(let i=state.current.hands.length-1;i>=0;i--){
    const h = state.current.hands[i];
    if(h.cards.length>0 && !h.stood && !h.finished){
      const c = h.cards.pop(); returnCard(c); log('Undid player card ' + c); renderHands(); updateAll(); suggestAll(); return;
    }
  }
  if(state.current.dealer.length>0){ const d = state.current.dealer.pop(); returnCard(d); log('Undid dealer card ' + d); renderHands(); updateAll(); suggestAll(); return; }
  if(state.tableCards.length>0){ const t = state.tableCards.pop(); returnCard(t.rank); log('Undid table card ' + t.rank); updateTable(); updateAll(); suggestAll(); return; }
  if(state.burnPile.length>0){ const b = state.burnPile.pop(); returnCard(b.rank); log('Undid burned card ' + b.rank); updateBurn(); updateAll(); suggestAll(); return; }
  alert('Nothing to undo');
}

// --- Picker
function openPicker(mode){
  pickerMode = mode;
  if($('picker')) $('picker').style.display = 'block';
  if($('pickerTitle')) $('pickerTitle').textContent = mode==='burn' ? 'Select burned card (other hit)' : (mode==='double' ? 'Select card for Double' : 'Select card received');
  if(pickerTimeout) clearTimeout(pickerTimeout);
  pickerTimeout = setTimeout(closePicker, 30000);
}
function closePicker(){
  if($('picker')) $('picker').style.display = 'none';
  pickerMode = null;
  if(pickerTimeout) clearTimeout(pickerTimeout);
  pickerTimeout = null;
}
function pickHitCard(rank){
  if(rank === 'RANDOM'){
    const pool = []; RANKS.forEach(r => { for(let i=0;i<(state.game.deckCounts[r]||0);i++) pool.push(r); });
    if(pool.length === 0){ alert('No cards'); closePicker(); return; }
    const p = pool[randInt(pool.length)];
    if(!consumeCard(p)){ alert('Failed'); closePicker(); return; }
    applyHit(p); closePicker(); return;
  }
  if(!consumeCard(rank)){ alert('No ' + rank + ' left'); return; }
  applyHit(rank); closePicker();
}
function applyHit(rank){
  const idx = activeHandIndex>=0?activeHandIndex:0;
  const hand = state.current.hands[idx];
  if(!hand) return;
  hand.cards.push(rank);
  log('Hit applied: ' + rank + ' into hand ' + (idx+1));
  renderHands(); updateAll(); suggestAll();
}
function pickDoubleCard(rank){
  if(rank === 'RANDOM'){
    const pool = []; RANKS.forEach(r => { for(let i=0;i<(state.game.deckCounts[r]||0);i++) pool.push(r); });
    if(pool.length === 0){ alert('No cards'); closePicker(); return; }
    const p = pool[randInt(pool.length)];
    if(!consumeCard(p)){ alert('Failed'); closePicker(); return; }
    applyDouble(p); closePicker(); return;
  }
  if(!consumeCard(rank)){ alert('No ' + rank + ' left'); return; }
  applyDouble(rank); closePicker();
}
function applyDouble(rank){
  const idx = activeHandIndex>=0?activeHandIndex:0;
  const hand = state.current.hands[idx];
  if(!hand) return;
  hand.bet = hand.bet * 2;
  hand.doubled = true;
  hand.cards.push(rank);
  hand.finished = true;
  hand.stood = true;
  log('Double applied: ' + rank + ' into hand ' + (idx+1));
  renderHands(); updateAll(); suggestAll();
}
function pickBurnCard(rank){
  if(rank === 'RANDOM'){
    const pool = []; RANKS.forEach(r => { for(let i=0;i<(state.game.deckCounts[r]||0);i++) pool.push(r); });
    if(pool.length === 0){ alert('No cards'); closePicker(); return; }
    const p = pool[randInt(pool.length)];
    if(!consumeCard(p)){ alert('Failed to consume card'); closePicker(); return; }
    addBurnCard(p); closePicker(); return;
  }
  if(!consumeCard(rank)){ alert('No ' + rank + ' left'); return; }
  addBurnCard(rank); closePicker();
}

// --- Stand / Split / Resolve helpers
function standActive(){
  if(!state.current) return alert('Start a round first');
  const idx = activeHandIndex>=0?activeHandIndex:0;
  const hand = state.current.hands[idx];
  if(!hand) return alert('No active hand');
  hand.stood = true; hand.finished = true;
  log('Hand ' + (idx+1) + ' stood');
  const next = state.current.hands.findIndex((h,i) => i!==idx && !h.finished);
  if(next >= 0){ activeHandIndex = next; log('Auto-selected hand ' + (next+1)); }
  renderHands(); suggestAll(); updateAll();
}

function doSplit(){
  if(!state.current) return alert('Start a round first');
  if(state.current.splitUsed) return alert('Already split once');
  const main = state.current.hands[0];
  if(main.cards.length !== 2) return alert('Need exactly 2 cards to split');
  const c1 = main.cards[0], c2 = main.cards[1];
  const tenGroup = c => (c==='10'||c==='J'||c==='Q'||c==='K');
  const v1 = (c1==='A'?1:rankValue(c1)), v2 = (c2==='A'?1:rankValue(c2));
  if(!(c1===c2 || v1===v2 || (tenGroup(c1)&&tenGroup(c2)))) return alert('Not equal-value pair');
  const bet = main.bet; const bal = toNum($('cashBal').value);
  if(bal < bet) return alert('Insufficient bankroll for split');
  const hA = { cards:[c1], bet, doubled:false, stood:false, finished:false, isSplitAce:(c1==='A') };
  const hB = { cards:[c2], bet, doubled:false, stood:false, finished:false, isSplitAce:(c2==='A') };
  state.current.hands = [hA,hB]; state.current.splitUsed = true; activeHandIndex = 0;
  renderHands(); updateAll(); suggestAll(); log('Split executed');
}

// draw from a counts snapshot
function drawOneFrom(counts){ const pool=[]; RANKS.forEach(r=>{ for(let i=0;i<(counts[r]||0);i++) pool.push(r); }); if(pool.length===0) return null; const pick = pool[randInt(pool.length)]; counts[pick] = Math.max(0,(counts[pick]||0)-1); return pick; }
function handValue(cards){ let s=0, aces=0; cards.forEach(c=>{ if(c==='A'){ aces++; s+=11; } else s+=rankValue(c); }); while(s>21 && aces>0){ s-=10; aces--; } return { sum:s, aces }; }

// --- Monte Carlo (corrected: 'hit' = one card then follow policy; 'double' handled properly)
function monteCarlo(action, iterations = 800, handIndex = 0) {
  if (!state.current) return null;
  const iters = Math.max(200, iterations);
  const base = copy(state.game.deckCounts);
  const playerInit = (state.current.hands && state.current.hands[handIndex]) ? state.current.hands[handIndex].cards.slice() : [];
  const dealerUp = state.current.dealer && state.current.dealer[0] ? state.current.dealer[0] : null;
  const bet = (state.current.hands && state.current.hands[handIndex]) ? state.current.hands[handIndex].bet : MIN_BET;
  const bjPayout = 1.5;

  let wins = 0, pushes = 0, losses = 0, evTotal = 0;

  for (let t = 0; t < iters; t++) {
    const counts = copy(base);
    const drawFrom = () => {
      const pool = [];
      RANKS.forEach(r => { for (let i = 0; i < (counts[r] || 0); i++) pool.push(r); });
      if (pool.length === 0) return null;
      const p = pool[randInt(pool.length)];
      counts[p] = Math.max(0, (counts[p] || 0) - 1);
      return p;
    };

    const dealer = { cards: [] };
    if (dealerUp) dealer.cards.push(dealerUp);
    if (dealerUp) { const hole = drawFrom(); if (hole) dealer.cards.push(hole); }

    const player = playerInit.slice();
    let stake = 1;

    const playerFollowPolicy = () => {
      while (true) {
        const hvObj = handValue(player);
        const sum = hvObj.sum;
        const soft = hvObj.aces > 0;
        if (soft) { if (sum >= 18) break; }
        else { if (sum >= 17) break; }
        if (player.length >= 6 && ($('sixChar').value === 'true')) break;
        const c = drawFrom(); if(!c) break; player.push(c);
      }
    };

    if (action === 'stand') {
      // nothing
    } else if (action === 'hit') {
      const c = drawFrom(); if (c) player.push(c);
      playerFollowPolicy();
    } else if (action === 'double') {
      stake = 2;
      const c = drawFrom(); if (c) player.push(c);
      // stand after the single double card
    }

    while (true) {
      const dv = handValue(dealer.cards).sum;
      if (dv >= 17) break;
      const d = drawFrom(); if(!d) break; dealer.cards.push(d);
    }

    const pval = handValue(player).sum;
    const dval = handValue(dealer.cards).sum;

    if (player.length >= 6 && pval <= 21 && ($('sixChar').value === 'true')) { wins++; evTotal += stake * bet; continue; }
    if (pval > 21) { losses++; evTotal -= stake * bet; continue; }
    if (dval > 21) { wins++; evTotal += stake * bet; continue; }

    const playerBJ = (playerInit.length === 2 && handValue(playerInit).sum === 21);
    const dealerBJ = (dealer.cards.length === 2 && handValue(dealer.cards).sum === 21);
    if (playerBJ && !dealerBJ) { wins++; evTotal += bjPayout * bet; continue; }
    if (playerBJ && dealerBJ) { pushes++; continue; }

    if (pval > dval) { wins++; evTotal += stake * bet; }
    else if (pval === dval) { pushes++; }
    else { losses++; evTotal -= stake * bet; }
  }

  return { win: wins / iters, push: pushes / iters || 0, loss: losses / iters, ev: evTotal / iters };
}

// --- Split helper
function canSplit(pairRank, dealerUp, hasSplitAlready, bankroll, bet, trueCount) {
  if (hasSplitAlready) return { allowed: false, reason: 'Already split' };
  if (bankroll < bet) return { allowed: false, reason: 'Insufficient bankroll' };
  if (pairRank === 'A' || pairRank === '8') return { allowed: true, reason: `Always split ${pairRank}` };
  if (pairRank === '5' || pairRank === '10') return { allowed: false, reason: `Do not split ${pairRank}` };
  const up = (typeof dealerUp === 'string') ? dealerUp : '-';
  if (pairRank === '2' || pairRank === '3') return { allowed: ['2','3','4','5','6','7'].includes(up), reason: `Split ${pairRank}s vs 2-7` };
  if (pairRank === '4') return { allowed: ['5','6'].includes(up), reason: 'Split 4s vs 5-6' };
  if (pairRank === '6') return { allowed: ['2','3','4','5','6'].includes(up), reason: 'Split 6s vs 2-6' };
  if (pairRank === '7') return { allowed: ['2','3','4','5','6','7'].includes(up), reason: 'Split 7s vs 2-7' };
  if (pairRank === '9') return { allowed: ['2','3','4','5','6','8','9'].includes(up), reason: 'Split 9s vs 2-6,8-9' };
  if (pairRank === '10' && trueCount >= 4) return { allowed: true, reason: 'High TC overlay: split 10s' };
  return { allowed: false, reason: 'No split recommended' };
}

// --- Conclusion UI
function showConclusion(dealerCards, details, net) {
  const el = document.getElementById('conclusionArea');
  if (!el) return;
  el.hidden = false;
  el.innerHTML = '';
  const title = document.createElement('h4'); title.textContent = 'Round Conclusion'; el.appendChild(title);
  const dealerLine = document.createElement('div'); dealerLine.className = 'small'; dealerLine.textContent = 'Dealer final: ' + (Array.isArray(dealerCards) ? dealerCards.join(', ') : dealerCards); el.appendChild(dealerLine);
  details.forEach(d => {
    const row = document.createElement('div'); row.style.display = 'flex'; row.style.justifyContent = 'space-between'; row.style.padding = '6px 0';
    row.innerHTML = '<div class="small">Hand ' + d.hand + ': ' + d.outcome + '</div><div class="small">' + (d.net >= 0 ? '+' + d.net.toFixed(2) : d.net.toFixed(2)) + '</div>';
    el.appendChild(row);
  });
  const total = document.createElement('div'); total.style.marginTop = '8px'; total.innerHTML = '<strong>Total net: ' + (typeof net === 'number' ? net.toFixed(2) : net) + '</strong>'; el.appendChild(total);
  setTimeout(() => { el.hidden = true; }, 7000);
}

// --- Resolve
function lockResolve(){
  if(!state.current) return alert('No active round');
  state.current.locked = true;
  const counts = copy(state.game.deckCounts);
  const dealer = { cards: [] };
  if(state.current.dealer.length) dealer.cards = state.current.dealer.slice();
  else { const up = drawOneFrom(counts); if(up) dealer.cards.push(up); }
  if(dealer.cards.length === 1){ const hole = drawOneFrom(counts); if(hole) dealer.cards.push(hole); }
  while(true){ const dv = handValue(dealer.cards).sum; if(dv >= 17) break; const d = drawOneFrom(counts); if(!d) break; dealer.cards.push(d); }

  let net = 0; const details = [];
  const dealerBJ = (dealer.cards.length === 2 && handValue(dealer.cards).sum === 21);

  for(let i=0;i<state.current.hands.length;i++){
    const h = state.current.hands[i];
    const pval = handValue(h.cards).sum;
    const dval = handValue(dealer.cards).sum;

    if(h.cards.length >= 6 && pval <= 21 && ($('sixChar').value === 'true')){ net += h.bet; details.push({hand:i+1,outcome:'Six Card Charlie',net:h.bet}); continue; }
    if(pval > 21){ net -= h.bet; details.push({hand:i+1,outcome:'Player bust',net:-h.bet}); continue; }
    if(dval > 21){ net += h.bet; details.push({hand:i+1,outcome:'Dealer bust',net:h.bet}); continue; }

    const playerBJ = (h.cards.length === 2 && handValue(h.cards).sum === 21);
    if(playerBJ && !dealerBJ){ net += h.bet * 1.5; details.push({hand:i+1,outcome:'Blackjack (3:2)',net:h.bet*1.5}); continue; }
    if(playerBJ && dealerBJ){ details.push({hand:i+1,outcome:'Push (BJ)',net:0}); continue; }

    if(pval > dval){ net += h.bet; details.push({hand:i+1,outcome:'Player win',net:h.bet}); }
    else if(pval === dval){ details.push({hand:i+1,outcome:'Push',net:0}); }
    else { net -= h.bet; details.push({hand:i+1,outcome:'Player lose',net:-h.bet}); }
  }

  const prev = toNum($('cashBal').value); const newBal = Math.round((prev + net) * 100) / 100;
  if($('cashBal')) $('cashBal').value = newBal.toFixed(2);
  if($('balanceDisplay')) $('balanceDisplay').textContent = newBal.toFixed(2);

  state.game.rounds.push({
    hands: state.current.hands.map(h => ({ cards: h.cards.slice(), bet: h.bet })),
    dealer: dealer.cards.slice(),
    net, details, table: state.tableCards.slice(), burned: state.burnPile.slice()
  });

  showConclusion(dealer.cards, details, net);

  // Force-clear table & burns for next round
  state.tableCards.length = 0;
  state.burnPile.length = 0;

  // clear current
  state.current = null;
  activeHandIndex = 0;

  // Update UI
  updateTable(); updateBurn(); updateAll(); renderHands(); updateRounds();

  if($('endRound')) $('endRound').disabled = true;
  if($('cancelRound')) $('cancelRound').disabled = true;
  if($('startRound')) $('startRound').disabled = false;

  log('Round resolved. Net ' + net.toFixed(2));
}

// --- Suggested bet logic
function suggestedBetFromTC(bankroll, trueCount) {
  bankroll = Number(bankroll) || 0;
  trueCount = Number(trueCount) || 0;
  if (trueCount <= 0 || bankroll <= MIN_BET) return MIN_BET;
  const tcFloor = Math.floor(trueCount);
  let fraction;
  if (tcFloor <= 1) fraction = 0.01;
  else if (tcFloor === 2) fraction = 0.02;
  else if (tcFloor === 3) fraction = 0.04;
  else if (tcFloor === 4) fraction = 0.06;
  else if (tcFloor === 5) fraction = 0.08;
  else fraction = 0.10;
  let raw = Math.round((bankroll * fraction) / BET_STEP) * BET_STEP;
  if (raw < MIN_BET) raw = MIN_BET;
  if (raw > bankroll) raw = Math.max(MIN_BET, Math.floor(bankroll / BET_STEP) * BET_STEP);
  return raw;
}

// --- Debounced suggestion logic (safe guards)
let _suggestDebounceTimer = null;
let _lastSuggestContext = null;

function suggestAll() {
  if (_suggestDebounceTimer) clearTimeout(_suggestDebounceTimer);
  _suggestDebounceTimer = setTimeout(_runSuggestAll, 120);
}

function _runSuggestAll() {
  _suggestDebounceTimer = null;
  const bal = toNum($('cashBal').value);
  const decksLeft = Math.max(0.1, toNum($('decksLeft').value) || state.game.defaultDecks);
  const tc = state.game.running / decksLeft;
  const suggestedBet = suggestedBetFromTC(bal, tc);
  if($('betSuggestion')) {
    if (tc <= 0) $('betSuggestion').textContent = `Min ${suggestedBet} (TC ${tc.toFixed(2)})`;
    else $('betSuggestion').textContent = `${suggestedBet.toFixed(0)} (TC ${tc.toFixed(2)})`;
  }

  if (!state || !state.current) { if($('suggestBox')) $('suggestBox').textContent = 'No active round'; if($('oddsArea')) $('oddsArea').textContent = ''; return; }
  if (!state.current.hands || state.current.hands.length === 0) { if($('suggestBox')) $('suggestBox').textContent = 'No player hands'; if($('oddsArea')) $('oddsArea').textContent = ''; return; }

  const idx = (typeof activeHandIndex === 'number' && activeHandIndex >= 0) ? activeHandIndex : 0;
  const hand = state.current.hands[idx];
  if (!hand) { if($('suggestBox')) $('suggestBox').textContent = 'No active hand'; if($('oddsArea')) $('oddsArea').textContent = ''; return; }

  const hvObj = handValue(hand.cards);
  const hv = hvObj.sum;
  if (hv > 21) { if($('suggestBox')) $('suggestBox').textContent = 'Player bust'; if($('oddsArea')) $('oddsArea').textContent = ''; return; }
  if (hv === 21 && hand.cards.length >= 2) { if($('suggestBox')) $('suggestBox').textContent = 'Stand (21)'; if($('oddsArea')) $('oddsArea').textContent = ''; return; }

  const dealerUp = (state.current.dealer && state.current.dealer[0]) ? state.current.dealer[0] : '-';
  const dbl = canDouble(hand.cards, dealerUp, state.current.hands.length > 1, Math.floor(tc));

  // SPLIT uses main hand as basis per request
  let splitInfo = { allowed:false, reason:'N/A' };
  const main = (state.current.hands && state.current.hands[0]) ? state.current.hands[0] : null;
  if (main && main.cards && main.cards.length === 2) {
    const a = main.cards[0], b = main.cards[1];
    const tenGroup = r => (r === '10' || r === 'J' || r === 'Q' || r === 'K');
    let pairRank = null;
    if (a === b) pairRank = a;
    else if (tenGroup(a) && tenGroup(b)) pairRank = '10';
    if (pairRank) splitInfo = canSplit(pairRank, dealerUp, state.current.splitUsed, bal, main.bet, Math.floor(tc));
  }

  const candidates = ['hit','stand'];
  if(dbl.allowed) candidates.push('double');
  if(splitInfo.allowed) candidates.push('split');

  const isHard = (hvObj.aces === 0);
  if (isHard && hv >= 20) { if($('suggestBox')) $('suggestBox').textContent = 'Stand (Hard ' + hv + ')'; if($('oddsArea')) $('oddsArea').textContent = ''; return; }

  _lastSuggestContext = { handIndex: idx, handSnapshot: hand.cards.slice(), dealerUp, tc, candidates };

  if($('oddsArea')) $('oddsArea').textContent = 'Estimating...';
  setTimeout(() => {
    const iters = Math.max(300, Math.min(2400, toNum($('mcIters').value) || 1600));
    let best = { action: null, ev: -Infinity, reason: null };
    for (const a of candidates) {
      if (!state.game.deckCounts || Object.keys(state.game.deckCounts).length === 0) continue;
      const res = monteCarlo(a, Math.max(200, Math.floor(iters / Math.max(1, candidates.length))), idx);
      if (!res) continue;
      const reason = (a === 'double' ? dbl.reason : (a === 'split' ? splitInfo.reason : 'sim'));
      if (res.ev > best.ev) best = { action: a, ev: res.ev, reason };
    }
    if($('suggestBox')) {
      if (best.action) $('suggestBox').textContent = `${best.action.toUpperCase()} · EV ${best.ev.toFixed(2)} · ${best.reason}`;
      else $('suggestBox').textContent = 'No clear suggestion';
    }
    if($('oddsArea')) $('oddsArea').textContent = `Estimates done (iters ~ ${iters})`;
  }, 8);
}

// --- canDouble (existing logic)
function canDouble(p,d,isSplit,tc){ if(isSplit) return {allowed:false,reason:'No double after split'}; const hv=handValue(p).sum; const soft=handValue(p).aces>0; if(!soft){ if(hv===9 && ['3','4','5','6'].includes(d)) return {allowed:true,reason:'Hard 9 vs 3-6'}; if(hv===10 && ['2','3','4','5','6','7','8','9'].includes(d)) return {allowed:true,reason:'Hard 10 vs 2-9'}; if(hv===11 && d!=='A') return {allowed:true,reason:'Hard 11 vs 2-10'} } else { if((hv===13||hv===14)&&['5','6'].includes(d)) return {allowed:true,reason:'Soft 13/14 vs 5-6'}; if((hv===15||hv===16)&&['4','5','6'].includes(d)) return {allowed:true,reason:'Soft 15/16 vs 4-6'}; if(hv===17&&['3','4','5','6'].includes(d)) return {allowed:true,reason:'Soft 17 vs 3-6'}; if(hv===18&&['2','3','4','5','6'].includes(d)) return {allowed:true,reason:'Soft 18 vs 2-6'} } if(tc>=2){ if(hv===10&&d==='10') return {allowed:true,reason:'TC>=+2 overlay: double 10 vs 10'}; if(hv===9&&d==='2') return {allowed:true,reason:'TC>=+2 overlay: double 9 vs 2'} } return {allowed:false,reason:'Double not recommended'}; }

// --- Helpers
function normalizeBet(v){ let n=Math.round(v||0); if(n<MIN_BET) n=MIN_BET; n=Math.round(n/BET_STEP)*BET_STEP; if(n<MIN_BET) n=MIN_BET; return n; }
function normRank(s){ if(!s) return null; s=String(s).trim().toUpperCase(); if(s==='T') s='10'; if(s==='1') s='A'; return RANKS.includes(s)?s:null; }

// --- Init & wiring
function attach(){
  buildCardGrid();

  if($('startNew')) $('startNew').addEventListener('click', ()=>startNewGame());
  if($('resetGame')) $('resetGame').addEventListener('click', ()=>resetAll());
  if($('startRound')) $('startRound').addEventListener('click', ()=>startRound());
  if($('cancelRound')) $('cancelRound').addEventListener('click', ()=>cancelRound());
  if($('endRound')) $('endRound').addEventListener('click', ()=>lockResolve());

  if($('addManual')) $('addManual').addEventListener('click', ()=>{ const v=normRank($('manualCard').value||''); if(!v) return alert('Invalid'); addPlayerCard(v); if($('manualCard')) $('manualCard').value=''; });
  if($('undoLast')) $('undoLast').addEventListener('click', ()=>undoLast());
  if($('drawRandom')) $('drawRandom').addEventListener('click', ()=>{ const pool=[]; RANKS.forEach(r=>{ for(let i=0;i<(state.game.deckCounts[r]||0);i++) pool.push(r); }); if(pool.length===0) return alert('No cards'); const p=pool[randInt(pool.length)]; addPlayerCard(p); });

  if($('applyBurn')) $('applyBurn').addEventListener('click', ()=>openPicker('burn'));
  if($('autoBurnLast')) $('autoBurnLast').addEventListener('click', ()=>{ if(state.tableCards.length===0) return alert('No table cards'); const last = state.tableCards.pop(); state.burnPile.push({rank:last.rank,id:nextBurnId++}); updateTable(); updateBurn(); updateAll(); suggestAll(); log('Moved table to burn: '+last.rank); });
  if($('clearBurns')) $('clearBurns').addEventListener('click', ()=>{ if(!confirm('Clear burns?')) return; while(state.burnPile.length){ const b=state.burnPile.pop(); returnCard(b.rank); } updateBurn(); updateAll(); suggestAll(); log('Cleared burns'); });

  if($('actHit')) $('actHit').addEventListener('click', ()=>openPicker('hit'));
  if($('actDouble')) $('actDouble').addEventListener('click', ()=>openPicker('double'));
  if($('actStand')) $('actStand').addEventListener('click', ()=>standActive());
  if($('actSplit')) $('actSplit').addEventListener('click', ()=>doSplit());

  if($('pickerRandom')) $('pickerRandom').addEventListener('click', ()=>{ if(pickerMode==='burn') pickBurnCard('RANDOM'); else if(pickerMode==='double') pickDoubleCard('RANDOM'); else pickHitCard('RANDOM'); });
  if($('pickerCancel')) $('pickerCancel').addEventListener('click', ()=>closePicker());

  if($('manualCard')) $('manualCard').addEventListener('keydown', e=>{ if(e.key==='Enter') $('addManual').click(); });
  if($('bet')) $('bet').addEventListener('change', ()=> { if($('bet')) $('bet').value = normalizeBet(toNum($('bet').value)); });

  document.addEventListener('keydown', e=>{
    if(e.key.toLowerCase()==='h') if($('actHit')) $('actHit').click();
    if(e.key.toLowerCase()==='s') if($('actStand')) $('actStand').click();
    if(e.key.toLowerCase()==='d') if($('actDouble')) $('actDouble').click();
    if(e.key.toLowerCase()==='p') if($('actSplit')) $('actSplit').click();
    const k=e.key.toUpperCase();
    if(/^[2-9]$/.test(k)) addPlayerCard(k);
    if(k==='A') addPlayerCard('A');
    if(k==='J') addPlayerCard('J');
    if(k==='Q') addPlayerCard('Q');
    if(k==='K') addPlayerCard('K');
    if(k==='0') addPlayerCard('10');
  });

  // initialize
  if($('startNew')) $('startNew').click();
}
try { attach(); } catch(e){ console.error('Attach failed', e); }
