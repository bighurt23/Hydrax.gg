/* Hydrax.GG — calculators + live prices.  Vanilla JS, no deps.
   All math is real and shown transparently; live prices are best-effort
   (CoinGecko) with a graceful manual fallback. */
'use strict';

const $ = id => document.getElementById(id);
const fmt = n => (isFinite(n) ? n : 0).toLocaleString('en-US', {style:'currency', currency:'USD'});
const fmtN = (n,d=2) => (isFinite(n)?n:0).toLocaleString('en-US',{maximumFractionDigits:d});

document.getElementById('yr').textContent = new Date().getFullYear();

/* ── Operator private-beta waitlist ──────────────────────────────────────────────
   Set BETA.endpoint to a Formspree URL (https://formspree.io/f/xxxx) to capture
   signups straight to your inbox (no client needed). Until then, signups open a
   mailto to BETA.email so they still land in your inbox. */
const BETA = {
  endpoint: '',                 // ← paste your Formspree endpoint here when ready
  email: 'admin@hydrax.gg',     // ← waitlist inbox (mailto fallback)
};
(function wireBeta(){
  const form = $('beta-form'), msg = $('beta-msg'), inp = $('beta-email');
  if(!form) return;
  form.addEventListener('submit', async e=>{
    e.preventDefault();
    const email = (inp.value || '').trim();
    if(!/^\S+@\S+\.\S+$/.test(email)){ msg.textContent = 'Please enter a valid email.'; return; }
    if(BETA.endpoint){
      msg.textContent = 'Adding you…';
      try{
        const r = await fetch(BETA.endpoint, { method:'POST',
          headers:{ 'Accept':'application/json', 'Content-Type':'application/json' },
          body: JSON.stringify({ email, _subject:'HydraX Operator beta signup', source:'hydrax.gg' }) });
        if(r.ok){ form.style.display='none'; msg.innerHTML = "✅ You're on the list — we'll email you when the beta opens. 🐉"; return; }
      }catch(err){}
      msg.innerHTML = "Couldn't submit — email <b>"+BETA.email+"</b> and we'll add you.";
    } else {
      const sub  = encodeURIComponent('HydraX Operator beta — add me');
      const body = encodeURIComponent('Please add me to the HydraX Operator private beta.\n\nEmail: '+email);
      window.location.href = 'mailto:'+BETA.email+'?subject='+sub+'&body='+body;
      msg.textContent = 'Opening your email app to confirm your spot…';
    }
  });
})();

/* ── live prices (CoinGecko, best-effort) ──────────────────────────────────── */
const COINS = [
  {id:'bitcoin',          sym:'BTC'},
  {id:'ethereum',         sym:'ETH'},
  {id:'monero',           sym:'XMR'},
  {id:'ethereum-classic', sym:'ETC'},
  {id:'ravencoin',        sym:'RVN'},
];
const MINEABLE = ['monero','ethereum-classic','ravencoin'];  // coin selector in the profit calc
let PRICES = {};

function cachePrices(d){ try{ localStorage.setItem('hx_prices', JSON.stringify({t:Date.now(), d})); }catch(e){} }
function cachedPrices(){
  try{ const o = JSON.parse(localStorage.getItem('hx_prices') || 'null');
       return (o && Date.now() - o.t < 21600000) ? o.d : null; }catch(e){ return null; }  // <6h old
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function fetchPrices(){
  const ids = COINS.map(c=>c.id).join(',');
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`;
  const r = await fetch(url, {cache:'no-store', mode:'cors'});
  if(!r.ok) throw new Error('http '+r.status);
  const data = await r.json();
  if(!data || !data.bitcoin) throw new Error('bad payload');
  return data;
}
async function loadPrices(){
  for(let i=0;i<3;i++){                       // retry transient rate-limits/blips
    try{ PRICES = await fetchPrices(); cachePrices(PRICES); renderTicker(); return; }
    catch(e){ if(i<2) await sleep(2500); }
  }
  const c = cachedPrices();                   // all retries failed → last good prices (<6h)
  if(c){ PRICES = c; renderTicker(true); }
  else { $('ticker').innerHTML = '<span class="dn">live prices loading…</span>'; }
}
function pdec(v){ return v < 0.01 ? 6 : (v < 1 ? 4 : 2); }
function renderTicker(stale){
  const parts = COINS.map(c=>{
    const p = PRICES[c.id]; if(!p) return '';
    const ch = p.usd_24h_change || 0;
    const cls = ch >= 0 ? 'b' : 'dn';
    const arrow = ch >= 0 ? '▲' : '▼';
    return `${c.sym} <span class="${cls}">$${fmtN(p.usd, pdec(p.usd))} ${arrow}${Math.abs(ch).toFixed(1)}%</span>`;
  }).filter(Boolean);
  if(!parts.length) return;
  const sep = '&nbsp;·&nbsp;';
  const body = (stale ? '<span class="dn">~ </span>' : '') + parts.join(sep);
  // duplicate the run so the -50% marquee transform loops seamlessly
  $('ticker').innerHTML = `<span class="tickmove">${body}${sep}${body}${sep}</span>`;
}

/* ── tabs ──────────────────────────────────────────────────────────────────── */
document.querySelectorAll('.tab').forEach(t=>{
  t.addEventListener('click', ()=>{
    document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));
    t.classList.add('active');
    const which = t.dataset.t;
    document.querySelectorAll('.panel').forEach(p=>p.classList.toggle('hidden', p.dataset.p!==which));
  });
});

/* ── profit calculator ─────────────────────────────────────────────────────── */
// all-coin profit calculator — data from data/coins.json (97 GPU+ASIC coins)
const UNIT_MULT = {'H/s':1,'kH/s':1e3,'MH/s':1e6,'GH/s':1e9,'TH/s':1e12,'Sol/s':1};
let COINDATA = [];
const coinSel = $('pr-coin');

async function loadCoins(){
  try{
    const d = await (await fetch('data/coins.json', {cache:'no-store'})).json();
    COINDATA = d.coins || [];
    coinSel.innerHTML = '';
    const grp = (label, type)=>{
      const list = COINDATA.map((c,i)=>[c,i]).filter(([c])=>c.type===type);
      if(!list.length) return;
      const og=document.createElement('optgroup'); og.label=label;
      list.forEach(([c,i])=>{ const o=document.createElement('option'); o.value=String(i);
        o.textContent = `${c.name} (${c.tag||c.algo}) · ${c.algo}`; og.appendChild(o); });
      coinSel.appendChild(og);
    };
    grp(`GPU coins (${COINDATA.filter(c=>c.type==='gpu').length})`,'gpu');
    grp(`ASIC coins (${COINDATA.filter(c=>c.type==='asic').length})`,'asic');
    const def = COINDATA.findIndex(c=>['RVN','ETC','XMR','NEOX'].includes(c.tag));
    coinSel.value = String(def>=0?def:0);
    onCoin();
  }catch(e){ const m=$('pr-coinmeta'); if(m) m.textContent='(coin list unavailable)'; }
}
function selectedCoin(){ return COINDATA[+coinSel.value] || null; }
function onCoin(){
  const c = selectedCoin(); if(!c) return;
  const u=$('pr-unit'); if([...u.options].some(o=>o.value===c.unit)) u.value=c.unit;  // default to algo's unit
  $('pr-coinmeta').textContent = `live · $${fmtN(c.price, c.price<1?6:2)} · net ${fmtN(c.nethash/UNIT_MULT[c.unit],0)} ${c.unit}`;
  calcProfit();
}
function toggleMode(){
  const auto = $('pr-mode').value === 'auto';
  ['pr-coin-wrap','pr-hs-wrap','pr-unit-wrap'].forEach(w=>$(w).classList.toggle('hidden', !auto));
  $('pr-gross-wrap').classList.toggle('hidden', auto);
  calcProfit();
}
function calcProfit(){
  const watts  = +$('pr-watts').value || 0;
  const rate   = +$('pr-rate').value  || 0;
  const fee    = (+$('pr-fee').value  || 0)/100;
  const uptime = (+$('pr-uptime').value || 0)/100;
  let gross = 0, extra = '';
  if($('pr-mode').value === 'gross'){
    gross = +$('pr-gross').value || 0;
  } else {
    const c = selectedCoin();
    if(c){
      const hs = (+$('pr-hs').value || 0) * (UNIT_MULT[$('pr-unit').value] || 1);
      const perDay = (hs / c.nethash) * (86400 / c.blocktime) * c.reward;   // coins/day
      gross = perDay * c.price;
      extra = `Mining <b>${c.name}</b>: ~${fmtN(perDay,6)} ${c.tag||''}/day × $${fmtN(c.price,c.price<1?6:2)}. `;
    }
  }
  const power = (watts/1000) * 24 * rate;
  const revenue = gross * (1 - fee) * uptime;
  const net = revenue - power;
  const margin = revenue > 0 ? (net/revenue)*100 : 0;
  const cls = net >= 0 ? 'good' : 'bad';
  $('pr-out').innerHTML = `
    <div class="o ${cls}"><b>${fmt(net)}</b><span>net profit / day</span></div>
    <div class="o ${cls}"><b>${fmt(net*30.4)}</b><span>net / month</span></div>
    <div class="o"><b>${fmt(power)}</b><span>power cost / day</span></div>
    <div class="note">${extra}Gross ${fmt(gross)}/day → after ${(fee*100).toFixed(1)}% fee &amp; ${(uptime*100).toFixed(0)}% uptime = ${fmt(revenue)}/day, minus ${fmt(power)} power. Margin <b>${margin.toFixed(0)}%</b>.
      ${net<0?'⚠ Loses money here — lower your power rate or pick a more profitable coin.':''}</div>`;
}
['pr-mode','pr-gross','pr-hs','pr-unit','pr-watts','pr-rate','pr-fee','pr-uptime']
  .forEach(id=>{ const e=$(id); if(e) e.addEventListener('input', id==='pr-mode'?toggleMode:calcProfit); });
coinSel.addEventListener('change', onCoin);

/* ── ROI / breakeven (with monthly difficulty growth) ──────────────────────── */
function calcRoi(){
  const cost   = +$('roi-cost').value   || 0;
  const profit = +$('roi-profit').value || 0;   // $/day today
  const growth = (+$('roi-growth').value || 0)/100;  // monthly difficulty growth shrinks daily profit
  let out;
  if(profit <= 0){
    out = `<div class="o bad"><b>never</b><span>breakeven</span></div>
           <div class="note">Net daily profit must be positive to ever pay back.</div>`;
  } else {
    const simple = cost / profit;                 // days, ignoring growth
    // model growth: each 30.4-day month, daily profit *= 1/(1+growth)
    let cum=0, days=0, p=profit, be=null, oneYr=0;
    for(let m=0; m<240 && be===null; m++){        // up to 20 yrs
      for(let d=0; d<30.4; d++){
        cum += p; days++;
        if(days<=365) oneYr += p;
        if(be===null && cum>=cost) be = days;
      }
      p = p / (1+growth);
    }
    const beDate = be ? new Date(Date.now()+be*864e5).toLocaleDateString() : '20+ yrs';
    $('roi-out').innerHTML = `
      <div class="o key"><b>${be?Math.round(be)+' days':'20+ yrs'}</b><span>breakeven (w/ growth)</span></div>
      <div class="o"><b>${Math.round(simple)} days</b><span>breakeven (flat)</span></div>
      <div class="o ${oneYr-cost>=0?'good':''}"><b>${fmt(oneYr)}</b><span>1-yr gross profit</span></div>
      <div class="note">At ${growth*100}%/mo difficulty growth your payback lands around <b>${beDate}</b>.
        First-year profit ≈ ${fmt(oneYr)} vs ${fmt(cost)} hardware → net Y1 <b>${fmt(oneYr-cost)}</b>.</div>`;
    return;
  }
  $('roi-out').innerHTML = out;
}
['roi-cost','roi-profit','roi-growth'].forEach(id=>$(id).addEventListener('input', calcRoi));

/* ── electricity cost ──────────────────────────────────────────────────────── */
function calcPower(){
  const watts = +$('pw-watts').value || 0;
  const rate  = +$('pw-rate').value  || 0;
  const hours = +$('pw-hours').value || 0;
  const day = (watts/1000)*hours*rate;
  $('pw-out').innerHTML = `
    <div class="o"><b>${fmt(day)}</b><span>per day</span></div>
    <div class="o"><b>${fmt(day*30.4)}</b><span>per month</span></div>
    <div class="o"><b>${fmt(day*365)}</b><span>per year</span></div>
    <div class="note">${fmtN(watts)} W for ${hours} h/day at ${fmt(rate)}/kWh.
      That's ${fmtN(watts/1000*hours,1)} kWh/day.</div>`;
}
['pw-watts','pw-rate','pw-hours'].forEach(id=>$(id).addEventListener('input', calcPower));

/* ── electricity rate by region (avg residential $/kWh; user can override) ─────
   Exact rate is on the user's bill — these are regional averages to start from. */
const ELEC_COUNTRIES = {
  US:["United States (avg)",0.17], CA:["Canada",0.13], MX:["Mexico",0.09], GB:["United Kingdom",0.34],
  IE:["Ireland",0.36], DE:["Germany",0.40], FR:["France",0.28], ES:["Spain",0.25], IT:["Italy",0.36],
  NL:["Netherlands",0.35], NO:["Norway",0.12], SE:["Sweden",0.20], FI:["Finland",0.20], PL:["Poland",0.20],
  RU:["Russia",0.06], UA:["Ukraine",0.05], AU:["Australia",0.30], NZ:["New Zealand",0.22], CN:["China",0.08],
  IN:["India",0.08], JP:["Japan",0.26], KR:["South Korea",0.10], BR:["Brazil",0.15], AR:["Argentina",0.06],
  AE:["United Arab Emirates",0.08], SA:["Saudi Arabia",0.05], ZA:["South Africa",0.15], KZ:["Kazakhstan",0.05],
  IS:["Iceland",0.14], PY:["Paraguay",0.05]
};
const US_STATES = {
  AL:["Alabama",0.15],AK:["Alaska",0.24],AZ:["Arizona",0.14],AR:["Arkansas",0.12],CA:["California",0.31],
  CO:["Colorado",0.15],CT:["Connecticut",0.30],DE:["Delaware",0.16],FL:["Florida",0.15],GA:["Georgia",0.14],
  HI:["Hawaii",0.42],ID:["Idaho",0.11],IL:["Illinois",0.16],IN:["Indiana",0.15],IA:["Iowa",0.13],
  KS:["Kansas",0.14],KY:["Kentucky",0.13],LA:["Louisiana",0.12],ME:["Maine",0.24],MD:["Maryland",0.17],
  MA:["Massachusetts",0.30],MI:["Michigan",0.18],MN:["Minnesota",0.15],MS:["Mississippi",0.13],MO:["Missouri",0.12],
  MT:["Montana",0.12],NE:["Nebraska",0.11],NV:["Nevada",0.15],NH:["New Hampshire",0.23],NJ:["New Jersey",0.18],
  NM:["New Mexico",0.14],NY:["New York",0.23],NC:["North Carolina",0.13],ND:["North Dakota",0.11],OH:["Ohio",0.16],
  OK:["Oklahoma",0.12],OR:["Oregon",0.13],PA:["Pennsylvania",0.18],RI:["Rhode Island",0.29],SC:["South Carolina",0.14],
  SD:["South Dakota",0.13],TN:["Tennessee",0.13],TX:["Texas",0.15],UT:["Utah",0.11],VT:["Vermont",0.21],
  VA:["Virginia",0.14],WA:["Washington",0.11],WV:["West Virginia",0.15],WI:["Wisconsin",0.17],WY:["Wyoming",0.12],DC:["Washington DC",0.16]
};
function buildLoc(sel){
  const blank=document.createElement('option'); blank.value=""; blank.textContent="— pick your region —"; sel.appendChild(blank);
  const g1=document.createElement('optgroup'); g1.label="Country";
  for(const [c,[n,r]] of Object.entries(ELEC_COUNTRIES)){ const o=document.createElement('option');
    o.value=r; o.dataset.cc=c; o.textContent=`${n} — $${r.toFixed(2)}/kWh`; g1.appendChild(o); }
  const g2=document.createElement('optgroup'); g2.label="U.S. state";
  for(const [c,[n,r]] of Object.entries(US_STATES)){ const o=document.createElement('option');
    o.value=r; o.textContent=`US · ${n} — $${r.toFixed(2)}/kWh`; g2.appendChild(o); }
  sel.appendChild(g1); sel.appendChild(g2);
}
function guessCC(){ try{ const m=(navigator.language||"").split("-")[1];
  if(m && ELEC_COUNTRIES[m.toUpperCase()]) return m.toUpperCase(); }catch(e){} return null; }
function wireLoc(selId, rateId, recalc){
  const sel=$(selId); if(!sel) return; buildLoc(sel);
  sel.addEventListener('change', ()=>{ if(sel.value){ $(rateId).value=sel.value; recalc(); } });
  const cc=guessCC();
  if(cc){ const opt=[...sel.options].find(o=>o.dataset.cc===cc);
    if(opt){ sel.value=opt.value; $(rateId).value=opt.value; } }  // pre-fill from browser locale
}
wireLoc('pr-loc','pr-rate',calcProfit);
wireLoc('pw-loc','pw-rate',calcPower);

/* ── init ──────────────────────────────────────────────────────────────────── */
toggleMode(); calcProfit(); calcRoi(); calcPower();
loadCoins();                       // all-coin calculator data (data/coins.json)
loadPrices();
setInterval(loadPrices, 120000);  // refresh prices every 2 min
