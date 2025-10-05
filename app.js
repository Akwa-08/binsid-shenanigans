// app.js — Complete Blackjack Trainer with fixed calculations and betting

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
  burnPile: [],
  sideBets: {
    hot3Enabled: false,
    twentyOnePlus3Enabled: false,
    perfectPairsEnabled: false,
    bustItEnabled: false
  }
};
let nextTableId = 1, nextBurnId = 1;
let activeHandIndex = 0;
let pickerMode = null, pickerTimeout = null;
let currentSuggestedBet = MIN_BET;


// Add after the existing constants at the top
const SIDE_BETS = {
  hot3: { name: 'HOT 3', minBet: 50, maxBet: 5000 },
  twentyOnePlus3: { name: '21+3', minBet: 50, maxBet: 5000 },
  perfectPairs: { name: 'Perfect Pairs', minBet: 50, maxBet: 5000 },
  bustIt: { name: 'Bust It', minBet: 50, maxBet: 5000 }
};

// Add side bet tracking to state initialization
// Modify the state object initialization


// Side bet analysis functions

// HOT 3 Analysis - Based on first 3 cards totaling 19, 20, or 21
function analyzeHot3() {
  const counts = state.game.deckCounts;
  const totalCards = Object.values(counts).reduce((a, b) => a + b, 0);
  if (totalCards < 50) return { recommend: false, tc: 0, ev: -10, reason: 'Insufficient cards' };
  
  // Count high cards (9, 10, J, Q, K, A)
  let highCards = 0;
  ['9', '10', 'J', 'Q', 'K', 'A'].forEach(r => {
    highCards += counts[r] || 0;
  });
  
  const highRatio = totalCards > 0 ? highCards / totalCards : 0;
  const decksLeft = Math.max(0.1, toNum($('decksLeft').value) || state.game.defaultDecks);
  const tc = state.game.running / decksLeft;
  
  // HOT 3 becomes favorable when TC is high (more high cards remaining)
  // Base EV is around -7% to -10%, improves with high count
  let ev = -9.5 + (tc * 1.8); // Approximate EV calculation
  
  const recommend = tc >= 4 && highRatio > 0.35;
  const reason = recommend ? 
    `High count favorable (TC: ${tc.toFixed(1)}, ${(highRatio * 100).toFixed(1)}% high cards)` :
    `Not favorable (TC: ${tc.toFixed(1)}, need TC ≥ +4)`;
  
  return { recommend, tc, ev, highRatio, reason };
}

// 21+3 Analysis - Three card poker with dealer upcard and player first two cards
function analyze21Plus3() {
  const counts = state.game.deckCounts;
  const totalCards = Object.values(counts).reduce((a, b) => a + b, 0);
  if (totalCards < 50) return { recommend: false, tc: 0, ev: -8, reason: 'Insufficient cards' };
  
  const decksLeft = Math.max(0.1, toNum($('decksLeft').value) || state.game.defaultDecks);
  const tc = state.game.running / decksLeft;
  
  // Calculate suited cards proportion
  let suitedPotential = 0;
  RANKS.forEach(r => {
    const count = counts[r] || 0;
    // Each rank has 4 cards, ideally distributed across suits
    if (count >= 3) suitedPotential += count;
  });
  
  const suitedRatio = totalCards > 0 ? suitedPotential / totalCards : 0;
  
  // 21+3 base EV is around -3% to -8% depending on paytable
  // Favorable when there's higher concentration of same ranks (suited opportunities)
  let ev = -6.5 + (tc * 1.2) + (suitedRatio * 8);
  
  const recommend = tc >= 3 && suitedRatio > 0.28;
  const reason = recommend ?
    `Favorable for flush/straight combos (TC: ${tc.toFixed(1)})` :
    `Not favorable (TC: ${tc.toFixed(1)}, need TC ≥ +3)`;
  
  return { recommend, tc, ev, suitedRatio, reason };
}

// Perfect Pairs Analysis
function analyzePerfectPairs() {
  const counts = state.game.deckCounts;
  const totalCards = Object.values(counts).reduce((a, b) => a + b, 0);
  if (totalCards < 50) return { recommend: false, tc: 0, ev: -7, reason: 'Insufficient cards' };
  
  const decksLeft = Math.max(0.1, toNum($('decksLeft').value) || state.game.defaultDecks);
  const tc = state.game.running / decksLeft;
  
  // Check for ranks with multiple cards remaining (pair potential)
  let pairPotential = 0;
  let perfectPairPotential = 0; // Same suit pairs
  
  RANKS.forEach(r => {
    const count = counts[r] || 0;
    if (count >= 2) {
      pairPotential += count * (count - 1) / 2; // Combinations
      // Perfect pairs are 1/4 of all pairs (same suit)
      if (count >= 2) perfectPairPotential += count / 4;
    }
  });
  
  const pairRatio = totalCards > 1 ? pairPotential / (totalCards * (totalCards - 1) / 2) : 0;
  
  // Perfect Pairs base EV is around -6% to -10%
  // Most favorable when specific ranks are concentrated
  let ev = -7.5 + (pairRatio * 35) + (tc * 0.8);
  
  const recommend = pairRatio > 0.08 && tc >= 1;
  const reason = recommend ?
    `High pair concentration (${(pairRatio * 100).toFixed(2)}% pair potential)` :
    `Low pair potential (${(pairRatio * 100).toFixed(2)}%, need > 8%)`;
  
  return { recommend, tc, ev, pairRatio, perfectPairPotential, reason };
}

// Bust It Analysis - Dealer busts with specific number of cards
function analyzeBustIt() {
  const counts = state.game.deckCounts;
  const totalCards = Object.values(counts).reduce((a, b) => a + b, 0);
  if (totalCards < 50) return { recommend: false, tc: 0, ev: -10, reason: 'Insufficient cards' };
  
  const decksLeft = Math.max(0.1, toNum($('decksLeft').value) || state.game.defaultDecks);
  const tc = state.game.running / decksLeft;
  
  // Count low cards (2-6) that cause dealer to bust
  let lowCards = 0;
  ['2', '3', '4', '5', '6'].forEach(r => {
    lowCards += counts[r] || 0;
  });
  
  // Count mid cards (7-9)
  let midCards = 0;
  ['7', '8', '9'].forEach(r => {
    midCards += counts[r] || 0;
  });
  
  const lowRatio = totalCards > 0 ? lowCards / totalCards : 0;
  const midRatio = totalCards > 0 ? midCards / totalCards : 0;
  
  // Bust It becomes favorable when there are MORE low cards (dealer draws more)
  // Inverse of typical card counting - negative count is better!
  // Base EV is around -8% to -12%
  let ev = -10.5 - (tc * 2.5) + (lowRatio * 25) + (midRatio * 10);
  
  const recommend = tc <= -2 && lowRatio > 0.32;
  const reason = recommend ?
    `Favorable for dealer bust (TC: ${tc.toFixed(1)}, ${(lowRatio * 100).toFixed(1)}% low cards)` :
    `Not favorable (TC: ${tc.toFixed(1)}, need TC ≤ -2 and high low card ratio)`;
  
  return { recommend, tc, ev, lowRatio, midRatio, reason };
}

// Combined side bet analysis
function analyzeSideBets() {
  const hot3 = analyzeHot3();
  const twentyOnePlus3 = analyze21Plus3();
  const perfectPairs = analyzePerfectPairs();
  const bustIt = analyzeBustIt();
  
  return {
    hot3,
    twentyOnePlus3,
    perfectPairs,
    bustIt
  };
}

// Update the UI to show side bet recommendations
function updateSideBetRecommendations() {
  const analysis = analyzeSideBets();
  const container = $('sideBetAnalysis');
  if (!container) return;
  
  container.innerHTML = '';
  
  const title = document.createElement('div');
  title.className = 'small';
  title.style.fontWeight = '800';
  title.style.marginBottom = '8px';
  title.textContent = 'Side Bet Recommendations';
  container.appendChild(title);
  
  // HOT 3
  const hot3Div = createSideBetDisplay('HOT 3', analysis.hot3);
  container.appendChild(hot3Div);
  
  // 21+3
  const plus3Div = createSideBetDisplay('21+3', analysis.twentyOnePlus3);
  container.appendChild(plus3Div);
  
  // Perfect Pairs
  const ppDiv = createSideBetDisplay('Perfect Pairs', analysis.perfectPairs);
  container.appendChild(ppDiv);
  
  // Bust It
  const bustDiv = createSideBetDisplay('Bust It', analysis.bustIt);
  container.appendChild(bustDiv);
}

function createSideBetDisplay(name, analysis) {
  const div = document.createElement('div');
  div.style.padding = '8px';
  div.style.marginBottom = '6px';
  div.style.borderRadius = '8px';
  div.style.border = '1px solid rgba(255,255,255,0.04)';
  div.style.background = analysis.recommend ? 
    'linear-gradient(90deg, rgba(32,192,187,0.08), rgba(32,192,187,0.02))' : 
    'rgba(255,255,255,0.01)';
  
  const header = document.createElement('div');
  header.style.display = 'flex';
  header.style.justifyContent = 'space-between';
  header.style.alignItems = 'center';
  header.style.marginBottom = '4px';
  
  const nameSpan = document.createElement('span');
  nameSpan.style.fontWeight = '800';
  nameSpan.style.fontSize = '13px';
  nameSpan.textContent = name;
  
  const statusSpan = document.createElement('span');
  statusSpan.style.fontSize = '12px';
  statusSpan.style.fontWeight = '800';
  statusSpan.style.color = analysis.recommend ? '#20c0bb' : '#9fb0b6';
  statusSpan.textContent = analysis.recommend ? '✓ BET' : '✗ SKIP';
  
  header.appendChild(nameSpan);
  header.appendChild(statusSpan);
  
  const info = document.createElement('div');
  info.style.fontSize = '11px';
  info.style.color = 'var(--muted)';
  info.textContent = `EV: ${analysis.ev.toFixed(2)}% · ${analysis.reason}`;
  
  div.appendChild(header);
  div.appendChild(info);
  
  return div;
}

// Modify the updateAll function to include side bet analysis
// Find the existing updateAll function and add this line before updateUIState():
// Add this right before the existing updateUIState() call in updateAll():

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
  // Keep only last 50 log entries
  while(el.children.length > 50) el.removeChild(el.lastChild);
}

// --- UI: card grids
function buildCardGrid() {
  const cont = $('cardButtons'); 
  if(!cont) return; 
  cont.innerHTML = '';
  
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

  const pg = $('pickerGrid'); 
  if(pg){ 
    pg.innerHTML = ''; 
    RANKS.forEach(r => {
      const p = document.createElement('div');
      p.className = 'card-btn';
      p.textContent = r;
      p.addEventListener('click', () => {
        if(pickerMode === 'burn') pickBurnCard(r);
        else if(pickerMode === 'double') pickDoubleCard(r);
        else pickHitCard(r);
      });
      pg.appendChild(p);
    }); 
  }
}

// --- UI updates
function updateAll() {
  if(!state.game.deckCounts || Object.keys(state.game.deckCounts).length === 0) {
    state.game.defaultDecks = clamp(toNum($('defaultDecks').value), 1, 8);
    state.game.deckCounts = initDeckCounts(state.game.defaultDecks);
  }
  
  if($('runCount')) $('runCount').textContent = state.game.running.toFixed(0);
  const decksLeft = Math.max(0.1, toNum($('decksLeft').value) || state.game.defaultDecks);
  const trueCount = state.game.running / decksLeft;
  if($('trueCount')) $('trueCount').textContent = trueCount.toFixed(2);
  if($('seenCount')) $('seenCount').textContent = state.game.seen;
  
  const balance = toNum($('cashBal').value);
  if($('balanceDisplay')) $('balanceDisplay').textContent = balance.toFixed(2);
  
  // Update suggested bet
  currentSuggestedBet = calculateOptimalBet(balance, trueCount);
  updateBetSuggestion(trueCount);
  
  // Update side bet recommendations
  updateSideBetRecommendations();
  
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

// --- Betting calculation (Kelly Criterion based)
function calculateOptimalBet(bankroll, trueCount) {
  bankroll = Number(bankroll) || 0;
  trueCount = Number(trueCount) || 0;
  
  // If TC is negative or zero, minimum bet
  if (trueCount <= 0 || bankroll <= MIN_BET) return MIN_BET;
  
  // Kelly-inspired betting with risk management
  let betFraction = 0;
  
  if (trueCount < 1) {
    betFraction = 0.005; // 0.5% of bankroll
  } else if (trueCount < 2) {
    betFraction = 0.01; // 1% of bankroll
  } else if (trueCount < 3) {
    betFraction = 0.02; // 2% of bankroll
  } else if (trueCount < 4) {
    betFraction = 0.04; // 4% of bankroll
  } else if (trueCount < 5) {
    betFraction = 0.06; // 6% of bankroll
  } else if (trueCount < 6) {
    betFraction = 0.08; // 8% of bankroll
  } else {
    // Cap at 10% for very high counts
    betFraction = Math.min(0.10, 0.02 * trueCount);
  }
  
  // Calculate raw bet
  let rawBet = bankroll * betFraction;
  
  // Round to nearest BET_STEP
  let bet = Math.round(rawBet / BET_STEP) * BET_STEP;
  
  // Ensure minimum bet
  if (bet < MIN_BET) bet = MIN_BET;
  
  // Cap at bankroll (leave at least MIN_BET in reserve)
  if (bet > bankroll - MIN_BET) {
    bet = Math.max(MIN_BET, Math.floor((bankroll - MIN_BET) / BET_STEP) * BET_STEP);
  }
  
  return bet;
}

function updateBetSuggestion(trueCount) {
  if($('betSuggestion')) {
    if (trueCount <= 0) {
      $('betSuggestion').textContent = `${currentSuggestedBet} (TC: ${trueCount.toFixed(2)} - Min bet)`;
    } else {
      const betRatio = (currentSuggestedBet / MIN_BET).toFixed(1);
      $('betSuggestion').textContent = `${currentSuggestedBet} (TC: ${trueCount.toFixed(2)} - ${betRatio}x min)`;
    }
  }
}

// --- Render functions
function renderHands() {
  const area = $('handsArea'); 
  if(!area) return; 
  area.innerHTML = '';
  
  if(!state.current) { 
    area.innerHTML = '<div class="small">No active round</div>'; 
    updateUIState(); 
    return; 
  }

  // Dealer panel
  const dealerPanel = document.createElement('div'); 
  dealerPanel.className = 'hand';
  const dh = document.createElement('h4'); 
  dh.textContent = 'Dealer cards (click to remove)'; 
  dealerPanel.appendChild(dh);
  
  const drow = document.createElement('div'); 
  drow.className = 'cards-row';
  state.current.dealer.forEach((c, i) => {
    const el = document.createElement('div'); 
    el.className = 'card'; 
    el.textContent = c; 
    el.title = 'Click to remove dealer card'; 
    el.style.cursor = 'pointer';
    el.addEventListener('click', () => { 
      if(!confirm('Remove dealer card ' + c + '?')) return; 
      removeDealerCardAt(i); 
    });
    drow.appendChild(el);
  });
  dealerPanel.appendChild(drow);
  area.appendChild(dealerPanel);

  // Player hands
  state.current.hands.forEach((h, i) => {
    const hp = document.createElement('div'); 
    hp.className = 'hand' + (i === activeHandIndex ? ' active' : '');
    
    const header = document.createElement('h4'); 
    header.textContent = i === 0 ? 'Main hand' : 'Split hand ' + i;
    header.style.cursor = 'pointer';
    header.addEventListener('click', () => setActiveHand(i));
    hp.appendChild(header);

    const row = document.createElement('div'); 
    row.className = 'cards-row';
    h.cards.forEach((c, ci) => {
      const ce = document.createElement('div'); 
      ce.className = 'card'; 
      ce.textContent = c;
      ce.style.cursor = 'pointer';
      ce.addEventListener('click', () => {
        if(h.stood || h.finished) return;
        if(!confirm('Remove this card?')) return;
        const rem = h.cards.splice(ci, 1)[0];
        returnCard(rem);
        log('Removed ' + rem + ' from hand ' + (i+1));
        renderHands(); 
        updateAll(); 
        suggestAll();
      });
      row.appendChild(ce);
    });
    hp.appendChild(row);

    const meta = document.createElement('div'); 
    meta.className = 'meta';
    const sum = h.cards.length ? handValue(h.cards).sum : 0;
    const flags = []; 
    if(h.doubled) flags.push('Doubled'); 
    if(h.stood) flags.push('Stood'); 
    if(h.isSplitAce) flags.push('SplitAce'); 
    if(h.finished) flags.push('Done');
    meta.textContent = 'Sum: ' + sum + ' · Bet: ' + h.bet.toFixed(0) + (flags.length ? ' · ' + flags.join(' · ') : '');
    hp.appendChild(meta);

    area.appendChild(hp);
  });

  updateUIState();
}

function updateTable() {
  const wrap = $('tableCards'); 
  if(!wrap) return; 
  wrap.innerHTML = '';
  
  (state.tableCards || []).forEach(tc => {
    const el = document.createElement('div'); 
    el.className = 'table-chip'; 
    el.textContent = tc.rank;
    el.title = 'Click to remove table card';
    el.style.cursor = 'pointer';
    el.addEventListener('click', () => {
      if(!confirm('Remove table card ' + tc.rank + '?')) return;
      const idx = state.tableCards.findIndex(x => x.id === tc.id);
      if(idx >= 0) { 
        const rem = state.tableCards.splice(idx, 1)[0]; 
        returnCard(rem.rank); 
        updateTable(); 
        updateAll(); 
        suggestAll(); 
        log('Removed table card ' + rem.rank); 
      }
    });
    wrap.appendChild(el);
  });
}

function updateBurn() {
  const wrap = $('burnPile'); 
  if(!wrap) return; 
  wrap.innerHTML = '';
  
  (state.burnPile || []).forEach(b => {
    const el = document.createElement('div'); 
    el.className = 'burn-chip'; 
    el.textContent = b.rank;
    el.title = 'Click to remove burned card';
    el.style.cursor = 'pointer';
    el.addEventListener('click', () => {
      if(!confirm('Remove burned card ' + b.rank + '?')) return;
      const idx = state.burnPile.findIndex(x => x.id === b.id);
      if(idx >= 0) { 
        const rem = state.burnPile.splice(idx, 1)[0]; 
        returnCard(rem.rank); 
        updateBurn(); 
        updateAll(); 
        suggestAll(); 
        log('Removed burned card ' + rem.rank); 
      }
    });
    wrap.appendChild(el);
  });
}

function updateRounds() {
  const el = $('roundList'); 
  if(!el) return; 
  el.innerHTML = '';
  
  (state.game.rounds || []).slice(-10).reverse().forEach(r => {
    const d = document.createElement('div'); 
    d.className = 'small';
    const hands = r.hands.map(h => h.cards.join(' ') + ' (' + h.bet.toFixed(0) + ')').join(' | ');
    d.textContent = 'Dealer ' + (r.dealer||[]).join(', ') + ' · ' + hands + ' · Net ' + r.net.toFixed(2);
    el.appendChild(d);
  });
}

// --- Core flows
function startNewGame() {
  if(!confirm('Start a new game? This resets the composition and clears history.')) return;
  state.game.defaultDecks = clamp(toNum($('defaultDecks').value), 1, 8);
  state.game.deckCounts = initDeckCounts(state.game.defaultDecks);
  state.game.seen = 0; 
  state.game.running = 0; 
  state.game.rounds = [];
  state.current = null; 
  state.tableCards = []; 
  state.burnPile = [];
  nextTableId = 1; 
  nextBurnId = 1; 
  activeHandIndex = 0;
  updateAll(); 
  renderHands(); 
  updateTable(); 
  updateBurn(); 
  updateRounds();
  log('New game started.');
}

function resetAll() {
  if(!confirm('Reset everything?')) return;
  const decks = toNum($('defaultDecks').value) || 8;
  state.game = { 
    defaultDecks: decks, 
    deckCounts: initDeckCounts(decks), 
    seen: 0, 
    running: 0, 
    rounds: [] 
  };
  state.current = null; 
  state.tableCards = []; 
  state.burnPile = [];
  nextTableId = 1; 
  nextBurnId = 1; 
  activeHandIndex = 0;
  updateAll(); 
  renderHands(); 
  updateTable(); 
  updateBurn(); 
  updateRounds();
  log('Reset all.');
}

function startRound() {
  if(state.current && !state.current.locked) return alert('Finish active round first');
  
  const bet = normalizeBet(toNum($('bet').value));
  const balance = toNum($('cashBal').value);
  
  if(bet > balance) {
    alert('Insufficient balance for bet');
    return;
  }
  
  if($('bet')) $('bet').value = bet;
  
  const hand = { 
    cards: [], 
    bet, 
    doubled: false, 
    stood: false, 
    finished: false, 
    isSplitAce: false 
  };
  
  state.current = { 
    hands: [hand], 
    dealer: [], 
    splitUsed: false, 
    locked: false 
  };
  
  activeHandIndex = 0;
  updateAll(); 
  renderHands(); 
  suggestAll();
  log('Round started. Bet ' + bet);
}

function cancelRound() {
  if(!state.current) return;
  
  // Return all cards
  state.current.hands.forEach(h => h.cards.forEach(c => returnCard(c)));
  state.current.dealer.forEach(c => returnCard(c));
  state.tableCards.forEach(tc => returnCard(tc.rank));
  state.burnPile.forEach(b => returnCard(b.rank));
  
  state.current = null; 
  state.tableCards = []; 
  state.burnPile = [];
  nextTableId = 1; 
  nextBurnId = 1; 
  activeHandIndex = 0;
  
  updateAll(); 
  renderHands(); 
  updateTable(); 
  updateBurn(); 
  updateRounds();
  log('Round canceled and cards returned.');
}

function setActiveHand(idx) {
  if(!state.current || !state.current.hands[idx]) return;
  activeHandIndex = idx;
  renderHands();
  suggestAll();
  log('Selected hand ' + (idx + 1));
}

// --- Add/remove actions
function addPlayerCard(rank) {
  if(!state.current) return alert('Start a round first');
  const idx = activeHandIndex >= 0 ? activeHandIndex : 0;
  const hand = state.current.hands[idx];
  if(!hand) return alert('No active hand');
  if(hand.stood || hand.finished) return alert('Active hand locked');
  if(!consumeCard(rank)) return alert('No ' + rank + ' left in composition');
  
  hand.cards.push(rank);
  log('Player card added to hand ' + (idx + 1) + ': ' + rank);
  renderHands(); 
  updateAll(); 
  suggestAll();
}

function addDealerCard(rank) {
  if(!state.current) {
    if(!consumeCard(rank)) return alert('No ' + rank + ' left');
    state.current = { 
      hands: [], 
      dealer: [rank], 
      splitUsed: false, 
      locked: false 
    };
    log('Dealer card added (no round): ' + rank);
  } else {
    if(!consumeCard(rank)) return alert('No ' + rank + ' left');
    state.current.dealer.push(rank);
    log('Dealer card added: ' + rank);
  }
  renderHands(); 
  updateAll(); 
  suggestAll();
}

function removeDealerCardAt(i) {
  if(!state.current || !state.current.dealer || i < 0 || i >= state.current.dealer.length) return;
  const removed = state.current.dealer.splice(i, 1)[0];
  returnCard(removed);
  log('Removed dealer card: ' + removed);
  renderHands(); 
  updateAll(); 
  suggestAll();
}

function addTableCard(rank) {
  if(!consumeCard(rank)) return alert('No ' + rank + ' left');
  const id = nextTableId++;
  state.tableCards.push({ rank, id });
  log('Table card added: ' + rank);
  updateTable(); 
  updateAll(); 
  suggestAll();
}

// --- Burn handling
function addBurnCard(rank) {
  const id = nextBurnId++;
  state.burnPile.push({ rank, id });
  log('Burned card recorded: ' + rank);
  updateBurn(); 
  updateAll(); 
  suggestAll();
}

// --- Undo
function undoLast() {
  if(!state.current) return alert('No active round');
  
  // Try player cards first
  for(let i = state.current.hands.length - 1; i >= 0; i--) {
    const h = state.current.hands[i];
    if(h.cards.length > 0 && !h.stood && !h.finished) {
      const c = h.cards.pop(); 
      returnCard(c); 
      log('Undid player card ' + c); 
      renderHands(); 
      updateAll(); 
      suggestAll(); 
      return;
    }
  }
  
  // Then dealer
  if(state.current.dealer.length > 0) { 
    const d = state.current.dealer.pop(); 
    returnCard(d); 
    log('Undid dealer card ' + d); 
    renderHands(); 
    updateAll(); 
    suggestAll(); 
    return; 
  }
  
  // Then table cards
  if(state.tableCards.length > 0) { 
    const t = state.tableCards.pop(); 
    returnCard(t.rank); 
    log('Undid table card ' + t.rank); 
    updateTable(); 
    updateAll(); 
    suggestAll(); 
    return; 
  }
  
  // Then burn pile
  if(state.burnPile.length > 0) { 
    const b = state.burnPile.pop(); 
    returnCard(b.rank); 
    log('Undid burned card ' + b.rank); 
    updateBurn(); 
    updateAll(); 
    suggestAll(); 
    return; 
  }
  
  alert('Nothing to undo');
}

// --- Picker modal
function openPicker(mode) {
  pickerMode = mode;
  if($('picker')) $('picker').style.display = 'block';
  if($('pickerTitle')) {
    $('pickerTitle').textContent = mode === 'burn' ? 
      'Select burned card (other hit)' : 
      (mode === 'double' ? 'Select card for Double' : 'Select card received');
  }
  if(pickerTimeout) clearTimeout(pickerTimeout);
  pickerTimeout = setTimeout(closePicker, 30000);
}

function closePicker() {
  if($('picker')) $('picker').style.display = 'none';
  pickerMode = null;
  if(pickerTimeout) clearTimeout(pickerTimeout);
  pickerTimeout = null;
}

function pickHitCard(rank) {
  if(rank === 'RANDOM') {
    const pool = []; 
    RANKS.forEach(r => { 
      for(let i = 0; i < (state.game.deckCounts[r] || 0); i++) pool.push(r); 
    });
    if(pool.length === 0) { 
      alert('No cards'); 
      closePicker(); 
      return; 
    }
    const p = pool[randInt(pool.length)];
    if(!consumeCard(p)) { 
      alert('Failed'); 
      closePicker(); 
      return; 
    }
    applyHit(p); 
    closePicker(); 
    return;
  }
  if(!consumeCard(rank)) { 
    alert('No ' + rank + ' left'); 
    return; 
  }
  applyHit(rank); 
  closePicker();
}

function applyHit(rank) {
  const idx = activeHandIndex >= 0 ? activeHandIndex : 0;
  const hand = state.current.hands[idx];
  if(!hand) return;
  hand.cards.push(rank);
  log('Hit applied: ' + rank + ' into hand ' + (idx + 1));
  renderHands(); 
  updateAll(); 
  suggestAll();
}

function pickDoubleCard(rank) {
  if(rank === 'RANDOM') {
    const pool = []; 
    RANKS.forEach(r => { 
      for(let i = 0; i < (state.game.deckCounts[r] || 0); i++) pool.push(r); 
    });
    if(pool.length === 0) { 
      alert('No cards'); 
      closePicker(); 
      return; 
    }
    const p = pool[randInt(pool.length)];
    if(!consumeCard(p)) { 
      alert('Failed'); 
      closePicker(); 
      return; 
    }
    applyDouble(p); 
    closePicker(); 
    return;
  }
  if(!consumeCard(rank)) { 
    alert('No ' + rank + ' left'); 
    return; 
  }
  applyDouble(rank); 
  closePicker();
}

function applyDouble(rank) {
  const idx = activeHandIndex >= 0 ? activeHandIndex : 0;
  const hand = state.current.hands[idx];
  if(!hand) return;
  
  const balance = toNum($('cashBal').value);
  if(balance < hand.bet) {
    alert('Insufficient balance to double');
    returnCard(rank);
    return;
  }
  
  hand.bet = hand.bet * 2;
  hand.doubled = true;
  hand.cards.push(rank);
  hand.finished = true;
  hand.stood = true;
  log('Double applied: ' + rank + ' into hand ' + (idx + 1));
  
  // Auto-select next hand if available
  const next = state.current.hands.findIndex((h, i) => i !== idx && !h.finished);
  if(next >= 0) {
    activeHandIndex = next;
    log('Auto-selected hand ' + (next + 1));
  }
  
  renderHands(); 
  updateAll(); 
  suggestAll();
}

function pickBurnCard(rank) {
  if(rank === 'RANDOM') {
    const pool = []; 
    RANKS.forEach(r => { 
      for(let i = 0; i < (state.game.deckCounts[r] || 0); i++) pool.push(r); 
    });
    if(pool.length === 0) { 
      alert('No cards'); 
      closePicker(); 
      return; 
    }
    const p = pool[randInt(pool.length)];
    if(!consumeCard(p)) { 
      alert('Failed to consume card'); 
      closePicker(); 
      return; 
    }
    addBurnCard(p); 
    closePicker(); 
    return;
  }
  if(!consumeCard(rank)) { 
    alert('No ' + rank + ' left'); 
    return; 
  }
  addBurnCard(rank); 
  closePicker();
}

// --- Stand / Split / Resolve helpers
function standActive() {
  if(!state.current) return alert('Start a round first');
  const idx = activeHandIndex >= 0 ? activeHandIndex : 0;
  const hand = state.current.hands[idx];
  if(!hand) return alert('No active hand');
  
  hand.stood = true; 
  hand.finished = true;
  log('Hand ' + (idx + 1) + ' stood');
  
  // Auto-select next unfinished hand
  const next = state.current.hands.findIndex((h, i) => i !== idx && !h.finished);
  if(next >= 0) { 
    activeHandIndex = next; 
    log('Auto-selected hand ' + (next + 1)); 
  }
  
  renderHands(); 
  suggestAll(); 
  updateAll();
}

function doSplit() {
  if(!state.current) return alert('Start a round first');
  if(state.current.splitUsed) return alert('Already split once');
  
  const main = state.current.hands[0];
  if(main.cards.length !== 2) return alert('Need exactly 2 cards to split');
  
  const c1 = main.cards[0], c2 = main.cards[1];
  const tenGroup = c => (c === '10' || c === 'J' || c === 'Q' || c === 'K');
  const v1 = (c1 === 'A' ? 1 : rankValue(c1));
  const v2 = (c2 === 'A' ? 1 : rankValue(c2));
  
  if(!(c1 === c2 || v1 === v2 || (tenGroup(c1) && tenGroup(c2)))) {
    return alert('Not equal-value pair');
  }
  
  const bet = main.bet; 
  const bal = toNum($('cashBal').value);
  if(bal < bet) return alert('Insufficient bankroll for split');
  
  const hA = { 
    cards: [c1], 
    bet, 
    doubled: false, 
    stood: false, 
    finished: false, 
    isSplitAce: (c1 === 'A') 
  };
  const hB = { 
    cards: [c2], 
    bet, 
    doubled: false, 
    stood: false, 
    finished: false, 
    isSplitAce: (c2 === 'A') 
  };
  
  state.current.hands = [hA, hB]; 
  state.current.splitUsed = true; 
  activeHandIndex = 0;
  
  renderHands(); 
  updateAll(); 
  suggestAll(); 
  log('Split executed');
}

// --- Hand evaluation
function handValue(cards) { 
  let s = 0, aces = 0; 
  cards.forEach(c => { 
    if(c === 'A') { 
      aces++; 
      s += 11; 
    } else {
      s += rankValue(c); 
    }
  }); 
  while(s > 21 && aces > 0) { 
    s -= 10; 
    aces--; 
  } 
  return { sum: s, aces }; 
}

// --- Monte Carlo simulation for best action
function monteCarlo(action, iterations = 800, handIndex = 0) {
  if (!state.current) return null;
  
  const iters = Math.max(200, iterations);
  const base = copy(state.game.deckCounts);
  const playerInit = (state.current.hands && state.current.hands[handIndex]) ? 
    state.current.hands[handIndex].cards.slice() : [];
  const dealerUp = state.current.dealer && state.current.dealer[0] ? state.current.dealer[0] : null;
  const bet = (state.current.hands && state.current.hands[handIndex]) ? 
    state.current.hands[handIndex].bet : MIN_BET;
  const bjPayout = 1.5;

  let wins = 0, pushes = 0, losses = 0, evTotal = 0;

  for (let t = 0; t < iters; t++) {
    const counts = copy(base);
    const drawFrom = () => {
      const pool = [];
      RANKS.forEach(r => { 
        for (let i = 0; i < (counts[r] || 0); i++) pool.push(r); 
      });
      if (pool.length === 0) return null;
      const p = pool[randInt(pool.length)];
      counts[p] = Math.max(0, (counts[p] || 0) - 1);
      return p;
    };

    // Setup dealer
    const dealer = { cards: [] };
    if (dealerUp) dealer.cards.push(dealerUp);
    if (dealerUp) { 
      const hole = drawFrom(); 
      if (hole) dealer.cards.push(hole); 
    }

    // Setup player
    const player = playerInit.slice();
    let stake = 1;

    // Player strategy after action
    const playerFollowPolicy = () => {
      while (true) {
        const hvObj = handValue(player);
        const sum = hvObj.sum;
        const soft = hvObj.aces > 0;
        
        // Basic strategy
        if (soft) { 
          if (sum >= 18) break; 
        } else { 
          if (sum >= 17) break; 
        }
        
        // Six Card Charlie
        if (player.length >= 6 && ($('sixChar').value === 'true')) break;
        
        const c = drawFrom(); 
        if(!c) break; 
        player.push(c);
      }
    };

    // Execute action
    if (action === 'stand') {
      // Player stands
    } else if (action === 'hit') {
      const c = drawFrom(); 
      if (c) player.push(c);
      playerFollowPolicy();
    } else if (action === 'double') {
      stake = 2;
      const c = drawFrom(); 
      if (c) player.push(c);
      // No more cards after double
    }

    // Dealer plays
    while (true) {
      const dv = handValue(dealer.cards).sum;
      if (dv >= 17) break;
      const d = drawFrom(); 
      if(!d) break; 
      dealer.cards.push(d);
    }

    // Evaluate outcome
    const pval = handValue(player).sum;
    const dval = handValue(dealer.cards).sum;

    // Six Card Charlie
    if (player.length >= 6 && pval <= 21 && ($('sixChar').value === 'true')) { 
      wins++; 
      evTotal += stake * bet; 
      continue; 
    }
    
    // Busts
    if (pval > 21) { 
      losses++; 
      evTotal -= stake * bet; 
      continue; 
    }
    if (dval > 21) { 
      wins++; 
      evTotal += stake * bet; 
      continue; 
    }

    // Blackjacks
    const playerBJ = (playerInit.length === 2 && handValue(playerInit).sum === 21);
    const dealerBJ = (dealer.cards.length === 2 && handValue(dealer.cards).sum === 21);
    
    if (playerBJ && !dealerBJ) { 
      wins++; 
      evTotal += bjPayout * bet; 
      continue; 
    }
    if (playerBJ && dealerBJ) { 
      pushes++; 
      continue; 
    }

    // Regular comparison
    if (pval > dval) { 
      wins++; 
      evTotal += stake * bet; 
    } else if (pval === dval) { 
      pushes++; 
    } else { 
      losses++; 
      evTotal -= stake * bet; 
    }
  }

  return { 
    win: wins / iters, 
    push: pushes / iters, 
    loss: losses / iters, 
    ev: evTotal / iters 
  };
}

// --- Strategy helpers
function canSplit(pairRank, dealerUp, hasSplitAlready, bankroll, bet, trueCount) {
  if (hasSplitAlready) return { allowed: false, reason: 'Already split' };
  if (bankroll < bet) return { allowed: false, reason: 'Insufficient bankroll' };
  
  // Always split aces and 8s
  if (pairRank === 'A' || pairRank === '8') {
    return { allowed: true, reason: `Always split ${pairRank}s` };
  }
  
  // Never split 5s or 10s (unless high count)
  if (pairRank === '5') return { allowed: false, reason: 'Never split 5s' };
  if (pairRank === '10' && trueCount < 4) return { allowed: false, reason: 'Don\'t split 10s' };
  
  const up = (typeof dealerUp === 'string') ? dealerUp : '-';
  
  // Split decisions based on dealer up card
  if (pairRank === '2' || pairRank === '3') {
    return { allowed: ['2','3','4','5','6','7'].includes(up), reason: `Split ${pairRank}s vs 2-7` };
  }
  if (pairRank === '4') {
    return { allowed: ['5','6'].includes(up), reason: 'Split 4s vs 5-6' };
  }
  if (pairRank === '6') {
    return { allowed: ['2','3','4','5','6'].includes(up), reason: 'Split 6s vs 2-6' };
  }
  if (pairRank === '7') {
    return { allowed: ['2','3','4','5','6','7'].includes(up), reason: 'Split 7s vs 2-7' };
  }
  if (pairRank === '9') {
    return { allowed: ['2','3','4','5','6','8','9'].includes(up), reason: 'Split 9s vs 2-6,8-9' };
  }
  
  // High true count overlay
  if (pairRank === '10' && trueCount >= 4) {
    return { allowed: true, reason: 'High TC overlay: split 10s' };
  }
  
  return { allowed: false, reason: 'No split recommended' };
}

function canDouble(playerCards, dealerUp, isSplit, trueCount) { 
  if(isSplit) return { allowed: false, reason: 'No double after split' };
  
  const hv = handValue(playerCards).sum; 
  const soft = handValue(playerCards).aces > 0;
  
  if(!soft) {
    // Hard doubles
    if(hv === 9 && ['3','4','5','6'].includes(dealerUp)) {
      return { allowed: true, reason: 'Hard 9 vs 3-6' };
    }
    if(hv === 10 && ['2','3','4','5','6','7','8','9'].includes(dealerUp)) {
      return { allowed: true, reason: 'Hard 10 vs 2-9' };
    }
    if(hv === 11 && dealerUp !== 'A') {
      return { allowed: true, reason: 'Hard 11 vs 2-10' };
    }
  } else {
    // Soft doubles
    if((hv === 13 || hv === 14) && ['5','6'].includes(dealerUp)) {
      return { allowed: true, reason: 'Soft 13/14 vs 5-6' };
    }
    if((hv === 15 || hv === 16) && ['4','5','6'].includes(dealerUp)) {
      return { allowed: true, reason: 'Soft 15/16 vs 4-6' };
    }
    if(hv === 17 && ['3','4','5','6'].includes(dealerUp)) {
      return { allowed: true, reason: 'Soft 17 vs 3-6' };
    }
    if(hv === 18 && ['2','3','4','5','6'].includes(dealerUp)) {
      return { allowed: true, reason: 'Soft 18 vs 2-6' };
    }
  }
  
  // True count overlays
  if(trueCount >= 2) {
    if(hv === 10 && dealerUp === '10') {
      return { allowed: true, reason: 'TC>=+2: double 10 vs 10' };
    }
    if(hv === 9 && dealerUp === '2') {
      return { allowed: true, reason: 'TC>=+2: double 9 vs 2' };
    }
  }
  
  return { allowed: false, reason: 'Double not recommended' };
}

// --- Conclusion UI
function showConclusion(dealerCards, details, net) {
  const el = document.getElementById('conclusionArea');
  if (!el) return;
  
  el.hidden = false;
  el.innerHTML = '';
  
  const title = document.createElement('h4'); 
  title.textContent = 'Round Conclusion'; 
  el.appendChild(title);
  
  const dealerLine = document.createElement('div'); 
  dealerLine.className = 'small'; 
  dealerLine.textContent = 'Dealer final: ' + (Array.isArray(dealerCards) ? dealerCards.join(', ') : dealerCards); 
  el.appendChild(dealerLine);
  
  details.forEach(d => {
    const row = document.createElement('div'); 
    row.style.display = 'flex'; 
    row.style.justifyContent = 'space-between'; 
    row.style.padding = '6px 0';
    row.innerHTML = '<div class="small">Hand ' + d.hand + ': ' + d.outcome + '</div>' +
                    '<div class="small">' + (d.net >= 0 ? '+' + d.net.toFixed(2) : d.net.toFixed(2)) + '</div>';
    el.appendChild(row);
  });
  
  const total = document.createElement('div'); 
  total.style.marginTop = '8px'; 
  total.innerHTML = '<strong>Total net: ' + (typeof net === 'number' ? net.toFixed(2) : net) + '</strong>'; 
  el.appendChild(total);
  
  setTimeout(() => { el.hidden = true; }, 7000);
}

// --- Resolve round
function lockResolve() {
  if(!state.current) return alert('No active round');
  
  state.current.locked = true;
  const counts = copy(state.game.deckCounts);
  
  // Complete dealer hand
  const dealer = { cards: [] };
  if(state.current.dealer.length) {
    dealer.cards = state.current.dealer.slice();
  } else { 
    const up = drawOneFrom(counts); 
    if(up) dealer.cards.push(up); 
  }
  
  if(dealer.cards.length === 1) { 
    const hole = drawOneFrom(counts); 
    if(hole) dealer.cards.push(hole); 
  }
  
  // Dealer plays
  while(true) { 
    const dv = handValue(dealer.cards).sum; 
    if(dv >= 17) break; 
    const d = drawOneFrom(counts); 
    if(!d) break; 
    dealer.cards.push(d); 
  }

  let net = 0; 
  const details = [];
  const dealerBJ = (dealer.cards.length === 2 && handValue(dealer.cards).sum === 21);

  // Evaluate each hand
  for(let i = 0; i < state.current.hands.length; i++) {
    const h = state.current.hands[i];
    const pval = handValue(h.cards).sum;
    const dval = handValue(dealer.cards).sum;

    // Six Card Charlie
    if(h.cards.length >= 6 && pval <= 21 && ($('sixChar').value === 'true')) { 
      net += h.bet; 
      details.push({hand: i+1, outcome: 'Six Card Charlie', net: h.bet}); 
      continue; 
    }
    
    // Player bust
    if(pval > 21) { 
      net -= h.bet; 
      details.push({hand: i+1, outcome: 'Player bust', net: -h.bet}); 
      continue; 
    }
    
    // Dealer bust
    if(dval > 21) { 
      net += h.bet; 
      details.push({hand: i+1, outcome: 'Dealer bust', net: h.bet}); 
      continue; 
    }

    // Blackjacks
    const playerBJ = (h.cards.length === 2 && handValue(h.cards).sum === 21 && !h.isSplitAce);
    if(playerBJ && !dealerBJ) { 
      net += h.bet * 1.5; 
      details.push({hand: i+1, outcome: 'Blackjack (3:2)', net: h.bet * 1.5}); 
      continue; 
    }
    if(playerBJ && dealerBJ) { 
      details.push({hand: i+1, outcome: 'Push (BJ)', net: 0}); 
      continue; 
    }

    // Regular comparison
    if(pval > dval) { 
      net += h.bet; 
      details.push({hand: i+1, outcome: 'Player win', net: h.bet}); 
    } else if(pval === dval) { 
      details.push({hand: i+1, outcome: 'Push', net: 0}); 
    } else { 
      net -= h.bet; 
      details.push({hand: i+1, outcome: 'Player lose', net: -h.bet}); 
    }
  }

  // Update balance
  const prev = toNum($('cashBal').value); 
  const newBal = Math.round((prev + net) * 100) / 100;
  if($('cashBal')) $('cashBal').value = newBal.toFixed(2);
  if($('balanceDisplay')) $('balanceDisplay').textContent = newBal.toFixed(2);

  // Save round
  state.game.rounds.push({
    hands: state.current.hands.map(h => ({ cards: h.cards.slice(), bet: h.bet })),
    dealer: dealer.cards.slice(),
    net, 
    details, 
    table: state.tableCards.slice(), 
    burned: state.burnPile.slice()
  });

  showConclusion(dealer.cards, details, net);

  // Clear for next round
  state.tableCards.length = 0;
  state.burnPile.length = 0;
  state.current = null;
  activeHandIndex = 0;

  // Update UI
  updateTable(); 
  updateBurn(); 
  updateAll(); 
  renderHands(); 
  updateRounds();

  if($('endRound')) $('endRound').disabled = true;
  if($('cancelRound')) $('cancelRound').disabled = true;
  if($('startRound')) $('startRound').disabled = false;

  log('Round resolved. Net ' + net.toFixed(2));
}

function drawOneFrom(counts) { 
  const pool = []; 
  RANKS.forEach(r => { 
    for(let i = 0; i < (counts[r] || 0); i++) pool.push(r); 
  }); 
  if(pool.length === 0) return null; 
  const pick = pool[randInt(pool.length)]; 
  counts[pick] = Math.max(0, (counts[pick] || 0) - 1); 
  return pick; 
}

// --- Suggestion system (debounced)
let _suggestDebounceTimer = null;

function suggestAll() {
  if (_suggestDebounceTimer) clearTimeout(_suggestDebounceTimer);
  _suggestDebounceTimer = setTimeout(_runSuggestAll, 120);
}

function _runSuggestAll() {
  _suggestDebounceTimer = null;
  
  const bal = toNum($('cashBal').value);
  const decksLeft = Math.max(0.1, toNum($('decksLeft').value) || state.game.defaultDecks);
  const tc = state.game.running / decksLeft;
  
  // Always update bet suggestion
  currentSuggestedBet = calculateOptimalBet(bal, tc);
  updateBetSuggestion(tc);

  if (!state || !state.current) { 
    if($('suggestBox')) $('suggestBox').textContent = 'No active round'; 
    if($('oddsArea')) $('oddsArea').textContent = ''; 
    return; 
  }
  
  if (!state.current.hands || state.current.hands.length === 0) { 
    if($('suggestBox')) $('suggestBox').textContent = 'No player hands'; 
    if($('oddsArea')) $('oddsArea').textContent = ''; 
    return; 
  }

  const idx = (typeof activeHandIndex === 'number' && activeHandIndex >= 0) ? activeHandIndex : 0;
  const hand = state.current.hands[idx];
  if (!hand) { 
    if($('suggestBox')) $('suggestBox').textContent = 'No active hand'; 
    if($('oddsArea')) $('oddsArea').textContent = ''; 
    return; 
  }

  const hvObj = handValue(hand.cards);
  const hv = hvObj.sum;
  
  if (hv > 21) { 
    if($('suggestBox')) $('suggestBox').textContent = 'Player bust'; 
    if($('oddsArea')) $('oddsArea').textContent = ''; 
    return; 
  }
  
  if (hv === 21 && hand.cards.length >= 2) { 
    if($('suggestBox')) $('suggestBox').textContent = 'Stand (21)'; 
    if($('oddsArea')) $('oddsArea').textContent = ''; 
    return; 
  }

  const dealerUp = (state.current.dealer && state.current.dealer[0]) ? state.current.dealer[0] : '-';
  const dbl = canDouble(hand.cards, dealerUp, state.current.hands.length > 1, Math.floor(tc));

  // Check split possibility (on main hand)
  let splitInfo = { allowed: false, reason: 'N/A' };
  const main = (state.current.hands && state.current.hands[0]) ? state.current.hands[0] : null;
  if (main && main.cards && main.cards.length === 2) {
    const a = main.cards[0], b = main.cards[1];
    const tenGroup = r => (r === '10' || r === 'J' || r === 'Q' || r === 'K');
    let pairRank = null;
    
    if (a === b) {
      pairRank = a;
    } else if (tenGroup(a) && tenGroup(b)) {
      pairRank = '10';
    }
    
    if (pairRank) {
      splitInfo = canSplit(pairRank, dealerUp, state.current.splitUsed, bal, main.bet, Math.floor(tc));
    }
  }

  // Determine candidates
  const candidates = ['hit', 'stand'];
  if(dbl.allowed && hand.cards.length === 2) candidates.push('double');
  if(splitInfo.allowed && idx === 0) candidates.push('split');

  // Quick decisions for obvious plays
  const isHard = (hvObj.aces === 0);
  if (isHard && hv >= 20) { 
    if($('suggestBox')) $('suggestBox').textContent = 'Stand (Hard ' + hv + ')'; 
    if($('oddsArea')) $('oddsArea').textContent = ''; 
    return; 
  }

  // Run simulation
  if($('oddsArea')) $('oddsArea').textContent = 'Calculating best action...';
  
  setTimeout(() => {
    const iters = Math.max(300, Math.min(2400, toNum($('mcIters').value) || 1600));
    let best = { action: null, ev: -Infinity, reason: null };
    
    for (const a of candidates) {
      if (!state.game.deckCounts || Object.keys(state.game.deckCounts).length === 0) continue;
      
      const res = monteCarlo(a, Math.max(200, Math.floor(iters / Math.max(1, candidates.length))), idx);
      if (!res) continue;
      
      const reason = (a === 'double' ? dbl.reason : 
                     (a === 'split' ? splitInfo.reason : 
                     'simulation'));
      
      if (res.ev > best.ev) {
        best = { action: a, ev: res.ev, reason, stats: res };
      }
    }
    
    if (!best.action) {
      if($('suggestBox')) $('suggestBox').textContent = 'Unable to determine best action';
      if($('oddsArea')) $('oddsArea').textContent = '';
      return;
    }
    
    const actionLabel = best.action.toUpperCase();
    const evLabel = (best.ev >= 0 ? '+' : '') + best.ev.toFixed(2);
    const winPct = (best.stats.win * 100).toFixed(1);
    const pushPct = (best.stats.push * 100).toFixed(1);
    const lossPct = (best.stats.loss * 100).toFixed(1);
    
    if($('suggestBox')) {
      $('suggestBox').textContent = `Best: ${actionLabel} (EV: ${evLabel}) — ${best.reason}`;
    }
    
    if($('oddsArea')) {
      $('oddsArea').textContent = `${actionLabel}: Win ${winPct}% · Push ${pushPct}% · Loss ${lossPct}%`;
    }
  }, 50);
}

// --- Bet normalization
function normalizeBet(v) {
  const n = Number(v) || MIN_BET;
  return Math.max(MIN_BET, Math.round(n / BET_STEP) * BET_STEP);
}

// --- Manual card add
function addManualCard() {
  const input = $('manualCard');
  if (!input) return;
  const val = input.value.trim().toUpperCase();
  if (!val) return;
  
  if (!RANKS.includes(val)) {
    alert('Invalid rank: ' + val);
    return;
  }
  
  addPlayerCard(val);
  input.value = '';
}

// --- Random draw
function drawRandomCard() {
  const pool = [];
  RANKS.forEach(r => {
    for (let i = 0; i < (state.game.deckCounts[r] || 0); i++) pool.push(r);
  });
  
  if (pool.length === 0) {
    alert('No cards left in composition');
    return;
  }
  
  const picked = pool[randInt(pool.length)];
  addPlayerCard(picked);
}

// --- Apply suggested bet
function applySuggestedBet() {
  if ($('bet')) {
    $('bet').value = currentSuggestedBet;
    log('Applied suggested bet: ' + currentSuggestedBet);
  }
}

// --- Burn last table card
function burnLastTable() {
  if (!state.tableCards || state.tableCards.length === 0) {
    alert('No table cards to burn');
    return;
  }
  
  const last = state.tableCards.pop();
  addBurnCard(last.rank);
  updateTable();
  log('Moved table card to burn pile: ' + last.rank);
}

// --- Clear burns
function clearBurns() {
  if (!state.burnPile || state.burnPile.length === 0) return;
  if (!confirm('Clear all burned cards?')) return;
  
  state.burnPile.forEach(b => returnCard(b.rank));
  state.burnPile = [];
  updateBurn();
  updateAll();
  suggestAll();
  log('Cleared burn pile');
}

// --- Initialize
function init() {
  buildCardGrid();
  
  // Wire up all buttons
  if ($('startNew')) $('startNew').addEventListener('click', startNewGame);
  if ($('resetGame')) $('resetGame').addEventListener('click', resetAll);
  if ($('startRound')) $('startRound').addEventListener('click', startRound);
  if ($('cancelRound')) $('cancelRound').addEventListener('click', cancelRound);
  if ($('endRound')) $('endRound').addEventListener('click', lockResolve);
  if ($('undoLast')) $('undoLast').addEventListener('click', undoLast);
  if ($('addManual')) $('addManual').addEventListener('click', addManualCard);
  if ($('drawRandom')) $('drawRandom').addEventListener('click', drawRandomCard);
  if ($('applyBurn')) $('applyBurn').addEventListener('click', () => openPicker('burn'));
  if ($('autoBurnLast')) $('autoBurnLast').addEventListener('click', burnLastTable);
  if ($('clearBurns')) $('clearBurns').addEventListener('click', clearBurns);
  if ($('applyBet')) $('applyBet').addEventListener('click', applySuggestedBet);
  
  // Action buttons
  if ($('actHit')) $('actHit').addEventListener('click', () => openPicker('hit'));
  if ($('actDouble')) $('actDouble').addEventListener('click', () => openPicker('double'));
  if ($('actStand')) $('actStand').addEventListener('click', standActive);
  if ($('actSplit')) $('actSplit').addEventListener('click', doSplit);
  
  // Picker modal
  if ($('pickerRandom')) $('pickerRandom').addEventListener('click', () => {
    if (pickerMode === 'burn') pickBurnCard('RANDOM');
    else if (pickerMode === 'double') pickDoubleCard('RANDOM');
    else pickHitCard('RANDOM');
  });
  if ($('pickerCancel')) $('pickerCancel').addEventListener('click', closePicker);
  
  // Input changes
  if ($('defaultDecks')) $('defaultDecks').addEventListener('input', () => {
    state.game.defaultDecks = clamp(toNum($('defaultDecks').value), 1, 8);
    updateAll();
  });
  if ($('decksLeft')) $('decksLeft').addEventListener('input', updateAll);
  if ($('cashBal')) $('cashBal').addEventListener('input', updateAll);
  if ($('bet')) $('bet').addEventListener('input', updateAll);
  if ($('manualCard')) $('manualCard').addEventListener('keypress', e => {
    if (e.key === 'Enter') addManualCard();
  });
  
  // Keyboard shortcuts
  document.addEventListener('keydown', e => {
    if (!state.current || state.current.locked) return;
    if (e.target.tagName === 'INPUT') return;
    
    switch(e.key.toLowerCase()) {
      case 'h':
        e.preventDefault();
        if ($('actHit') && !$('actHit').disabled) openPicker('hit');
        break;
      case 'd':
        e.preventDefault();
        if ($('actDouble') && !$('actDouble').disabled) openPicker('double');
        break;
      case 's':
        e.preventDefault();
        if ($('actStand') && !$('actStand').disabled) standActive();
        break;
      case 'p':
        e.preventDefault();
        if ($('actSplit') && !$('actSplit').disabled) doSplit();
        break;
    }
  });
  
  updateAll();
  renderHands();
  updateTable();
  updateBurn();
  updateRounds();
  
  log('Trainer initialized');
}

// Start when DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}