/* Hydrax.GG — calculators + live prices.  Vanilla JS, no deps.
   All math is real and shown transparently; live prices are best-effort
   (CoinGecko) with a graceful manual fallback. */
'use strict';

const $ = id => document.getElementById(id);
const fmt = n => (isFinite(n) ? n : 0).toLocaleString('en-US', {style:'currency', currency:'USD'});
const fmtN = (n,d=2) => (isFinite(n)?n:0).toLocaleString('en-US',{maximumFractionDigits:d});

document.getElementById('yr').textContent = new Date().getFullYear();

/* ── affiliate / product links (swap these for your real URLs) ──────────────── */
const LINKS = {
  buy:  'https://wyattjr6.gumroad.com/l/gyanqh',  // Pro Tracker — Gumroad checkout
  operator: '#ecosystem',                          // Operator console — set to its public URL when live
};
const bl = $('buy-link'); if (bl) bl.href = LINKS.buy;
const ol = $('op-link');  if (ol) ol.href = LINKS.operator;

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
    try{ PRICES = await fetchPrices(); cachePrices(PRICES); renderTicker(); fillCoinPrice(); return; }
    catch(e){ if(i<2) await sleep(2500); }
  }
  const c = cachedPrices();                   // all retries failed → last good prices (<6h)
  if(c){ PRICES = c; renderTicker(true); fillCoinPrice(); }
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
  $('ticker').innerHTML = (stale ? '<span class="dn">~ </span>' : '') + parts.join('&nbsp;·&nbsp;');
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
// populate mineable coin selector
const coinSel = $('pr-coin');
COINS.filter(c=>MINEABLE.includes(c.id)).forEach(c=>{
  const o=document.createElement('option'); o.value=c.id; o.textContent=c.sym; coinSel.appendChild(o);
});
function fillCoinPrice(){
  const id = coinSel.value; const p = PRICES[id];
  const liveEl = $('pr-live');
  if(p){ $('pr-price').value = p.usd; liveEl.textContent = `(live $${fmtN(p.usd,p.usd<1?4:2)})`; }
  else { liveEl.textContent = ''; }
}
function toggleMode(){
  const gross = $('pr-mode').value === 'gross';
  $('pr-gross-wrap').classList.toggle('hidden', !gross);
  ['pr-coin-wrap','pr-amt-wrap','pr-price-wrap'].forEach(w=>$(w).classList.toggle('hidden', gross));
  if(!gross) fillCoinPrice();
  calcProfit();
}
function calcProfit(){
  const watts  = +$('pr-watts').value || 0;
  const rate   = +$('pr-rate').value  || 0;
  const fee    = (+$('pr-fee').value  || 0)/100;
  const uptime = (+$('pr-uptime').value || 0)/100;
  let gross;
  if($('pr-mode').value === 'gross'){
    gross = +$('pr-gross').value || 0;
  } else {
    gross = (+$('pr-amt').value || 0) * (+$('pr-price').value || 0);
  }
  const power = (watts/1000) * 24 * rate;             // $/day to run
  const revenue = gross * (1 - fee) * uptime;          // $/day after fees + downtime
  const net = revenue - power;                         // $/day profit
  const margin = revenue > 0 ? (net/revenue)*100 : 0;
  const cls = net >= 0 ? 'good' : 'bad';
  $('pr-out').innerHTML = `
    <div class="o ${cls}"><b>${fmt(net)}</b><span>net profit / day</span></div>
    <div class="o ${cls}"><b>${fmt(net*30.4)}</b><span>net / month</span></div>
    <div class="o"><b>${fmt(power)}</b><span>power cost / day</span></div>
    <div class="note">Gross ${fmt(gross)}/day → after ${(fee*100).toFixed(1)}% fee &amp; ${(uptime*100).toFixed(0)}% uptime = ${fmt(revenue)}/day,
      minus ${fmt(power)} power. Profit margin <b>${margin.toFixed(0)}%</b>.
      ${net<0?'⚠ This rig loses money at these inputs — drop your power rate or pick a more profitable coin.':''}</div>`;
}
['pr-mode','pr-gross','pr-coin','pr-amt','pr-price','pr-watts','pr-rate','pr-fee','pr-uptime']
  .forEach(id=>{ const e=$(id); e.addEventListener('input', id==='pr-mode'?toggleMode:calcProfit); });
coinSel.addEventListener('change', ()=>{ fillCoinPrice(); calcProfit(); });

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

/* ── init ──────────────────────────────────────────────────────────────────── */
toggleMode(); calcProfit(); calcRoi(); calcPower();
loadPrices();
setInterval(loadPrices, 120000);  // refresh prices every 2 min
