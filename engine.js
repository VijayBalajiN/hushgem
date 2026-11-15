/* Hushgem engine: gems, missions, auctions, scoring, a probability model for gem values, and bots. No DOM, so it also runs in Node. */
(function(root,factory){
  const E=factory();
  if(typeof module==='object'&&module.exports)module.exports=E;else root.HushgemEngine=E;
})(typeof self!=='undefined'?self:this,function(){
'use strict';

const COLORS=[
  {id:'Y',name:'Yellow',cut:'Square-cut'},
  {id:'B',name:'Blue',cut:'Circle-cut'},
  {id:'P',name:'Purple',cut:'Triangle-cut'},
  {id:'K',name:'Pink',cut:'Pentagon-cut'},
  {id:'G',name:'Green',cut:'Oval-cut'}
];
const NC=COLORS.length,PER_COLOR=6,TOTAL_GEMS=NC*PER_COLOR;

// Points per gem of a color, indexed by how many gems of that color are in the public display (5 means 5 or more).
const CHARTS={
  A:[0,4,8,12,16,20],
  B:[20,16,12,8,4,0],
  C:[0,2,5,9,14,20],
  D:[20,18,15,11,6,0],
  E:[0,4,10,18,6,0]
};
const CHART_NOTES={
  A:'Linear and rising: the more of a color is revealed, the more each copy is worth.',
  B:'Descending mirror of A: scarcity pays.',
  C:'A rising curve that starts slow and steepens.',
  D:'A falling curve that drops slowly, then fast.',
  E:'Peaks at exactly three revealed and punishes overshooting.'
};

const SETUP={3:{coins:35,hand:5},4:{coins:25,hand:4},5:{coins:20,hand:3}};

// 25 auction cards. Gem lots take the oldest visible gem (1 Gem) or both visible gems (2 Gems).
const AUCTION_CARDS=[
  {kind:'gems',gems:1,n:12},{kind:'gems',gems:2,n:5},
  {kind:'invest',amt:5,n:2},{kind:'invest',amt:10,n:2},
  {kind:'loan',amt:10,n:2},{kind:'loan',amt:20,n:2}
];

const PERSONAS=[
  {name:'dumEinstein',tag:'Steady',agg:.78,noise:.10},
  {name:'aniket',tag:'Bold',agg:.90,noise:.14},
  {name:'tweakinn',tag:'Frugal',agg:.68,noise:.10},
  {name:'reeshabh',tag:'Erratic',agg:.78,noise:.30}
];

function mulberry32(a){
  return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};
}
function shuffle(arr,rng){
  for(let i=arr.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[arr[i],arr[j]]=[arr[j],arr[i]];}
  return arr;
}
const sum=a=>a.reduce((x,y)=>x+y,0);
const zeros=()=>Array(NC).fill(0);
const hist=a=>{const h=zeros();a.forEach(c=>h[c]++);return h;};

// ---- missions ----
function buildMissions(){
  const list=[];let id=0;
  for(let i=0;i<NC;i++)for(let j=i;j<NC;j++){
    const need=zeros();need[i]++;need[j]++;
    list.push({id:id++,rule:'set',need,pts:5,spots:[i,j]});
  }
  for(let i=0;i<NC;i++)for(let j=i+1;j<NC;j++)for(let k=j+1;k<NC;k++){
    const need=zeros();need[i]++;need[j]++;need[k]++;
    list.push({id:id++,rule:'set',need,pts:10,spots:[i,j,k]});
  }
  [['pair','Any pair',5,2],['twopairs','Any two pairs',15,4],['trips','Three of a kind',10,3],
   ['three','Three different',5,3],['four','Four different',10,4]].forEach(([rule,label,pts,n])=>{
    list.push({id:id++,rule,label,pts,spots:Array(n).fill(-1)});
  });
  list.forEach(m=>{m.shape=m.spots.length===2?'Pendant':m.spots.length===3?'Crown':'Shield';m.takenBy=null;});
  return list;
}
function missionDone(m,cnt){
  switch(m.rule){
    case'set':return m.need.every((n,c)=>cnt[c]>=n);
    case'pair':return Math.max(...cnt)>=2;
    case'twopairs':return sum(cnt.map(n=>Math.floor(n/2)))>=2;
    case'trips':return Math.max(...cnt)>=3;
    case'three':return cnt.filter(n=>n>0).length>=3;
    case'four':return cnt.filter(n=>n>0).length>=4;
  }
  return false;
}
function missionLabel(m){
  if(m.label)return m.label;
  return m.spots.map(c=>COLORS[c].name).join(' + ');
}

// ---- setup ----
function createGame(opts){
  opts=opts||{};
  const n=opts.players||4,chart=opts.chart||'A';
  if(!SETUP[n])throw new Error('Hushgem takes 3 to 5 players');
  const rng=opts.seed!=null?mulberry32(opts.seed):Math.random;
  const {coins,hand}=SETUP[n];
  const gems=[];
  for(let c=0;c<NC;c++)for(let k=0;k<PER_COLOR;k++)gems.push(c);
  shuffle(gems,rng);
  const hands=[];
  for(let p=0;p<n;p++)hands.push(gems.splice(0,hand).sort((a,b)=>a-b));
  const auction=[];
  AUCTION_CARDS.forEach(c=>{for(let k=0;k<c.n;k++)auction.push({kind:c.kind,gems:c.gems,amt:c.amt});});
  shuffle(auction,rng);
  const pool=shuffle(buildMissions(),rng);
  const g={
    n,chart,rng,infoTotal:n*hand,
    names:opts.names||Array.from({length:n},(_,p)=>p===0?'You':PERSONAS[(p-1)%PERSONAS.length].name),
    persona:Array.from({length:n},(_,p)=>PERSONAS[Math.max(0,p-1)%PERSONAS.length]),
    coins:Array(n).fill(coins),startCoins:coins,
    locked:Array(n).fill(0),invRet:Array(n).fill(0),loans:Array(n).fill(0),
    hands,coll:Array.from({length:n},zeros),taken:Array.from({length:n},()=>[]),
    missions:pool.slice(0,4),
    display:zeros(),drawn:zeros(),revealed:[],
    gemDeck:gems,visible:[],auctionDeck:auction,lot:null,
    round:1,lastWinner:null,phase:'bid',result:null,wins:Array.from({length:n},()=>[]),
    history:[],scores:null,done:false
  };
  refill(g);
  g.lot=g.auctionDeck.pop();
  return g;
}
function refill(g){
  while(g.visible.length<2&&g.gemDeck.length){
    const c=g.gemDeck.pop();g.drawn[c]++;g.visible.push(c);
  }
}

// ---- beliefs ----
function binom(n,k){
  if(k<0||k>n)return 0;
  k=Math.min(k,n-k);let r=1;
  for(let i=1;i<=k;i++)r=r*(n-k+i)/i;
  return r;
}
// What viewer p can infer about the final public display. Every starting-hand gem is revealed by the end,
// so the final count of a color is: revealed + p's own hand + however many of that color sit in the other hands.
function belief(g,p){
  const mine=hist(g.hands[p]);
  const H=sum(g.hands.map((h,q)=>q===p?0:h.length));
  const u=COLORS.map((_,c)=>PER_COLOR-g.display[c]-mine[c]-g.drawn[c]);
  const U=H+g.gemDeck.length;
  const ch=CHARTS[g.chart];
  const pmf=[],ev=[],deckExp=[];
  for(let c=0;c<NC;c++){
    const dist=Array(6).fill(0);
    const base=g.display[c]+mine[c];
    const tot=binom(U,H);
    for(let x=0;x<=Math.min(u[c],H);x++){
      const pr=tot?binom(u[c],x)*binom(U-u[c],H-x)/tot:0;
      dist[Math.min(5,base+x)]+=pr;
    }
    pmf.push(dist);
    ev.push(sum(dist.map((pr,d)=>pr*ch[d])));
    deckExp.push(U?u[c]*g.gemDeck.length/U:0);
  }
  return {ev,pmf,U,H,mine,floor:COLORS.map((_,c)=>g.display[c]+mine[c])};
}
function spotValue(g,c){return CHARTS[g.chart][Math.min(5,g.display[c])];}

// Value to p of the gems and missions on the current gem lot.
function lotValue(g,p,b){
  b=b||belief(g,p);
  const lot=g.lot;
  if(lot.kind!=='gems')return {gems:[],gv:0,mission:0,total:0,missions:[]};
  const k=Math.min(lot.gems,g.visible.length);
  const gems=g.visible.slice(0,k);
  const gv=sum(gems.map(c=>b.ev[c]));
  const after=g.coll[p].slice();gems.forEach(c=>after[c]++);
  const hit=g.missions.filter(m=>m.takenBy==null&&!missionDone(m,g.coll[p])&&missionDone(m,after));
  const mission=sum(hit.map(m=>m.pts));
  return {gems,gv,mission,total:gv+mission,missions:hit};
}
// Market-clearing guess: how many points one coin buys, given all coins left and the value still to be auctioned.
function coinWorth(g,p,b){
  b=b||belief(g,p);
  const lot=g.lot;
  if(lot.kind==='gems'){
    const k=Math.min(lot.gems,g.visible.length);
    if(g.visible.length+g.gemDeck.length-k<=0)return 1;
  }
  let V=0;
  g.visible.forEach(c=>{V+=b.ev[c];});
  for(let c=0;c<NC;c++)V+=(b.U?b.ev[c]*(PER_COLOR-g.display[c]-b.mine[c]-g.drawn[c])*g.gemDeck.length/b.U:0);
  const C=sum(g.coins);
  return Math.max(1,V/Math.max(C,1));
}

// ---- rounds ----
function maxBid(g,p){return g.coins[p]+(g.lot.kind==='loan'?g.lot.amt:0);}
function clampBid(g,p,b){return Math.max(0,Math.min(maxBid(g,p),Math.floor(Number(b)||0)));}

function tiePriority(g,p){
  if(g.lastWinner==null)return null;
  return (p-g.lastWinner-1+g.n)%g.n+1;
}

function resolve(g,bids){
  if(g.phase!=='bid')throw new Error('not bidding');
  const lot=g.lot;
  bids=bids.map((b,p)=>clampBid(g,p,b));
  const top=Math.max(...bids);
  const tied=[];bids.forEach((b,p)=>{if(b===top)tied.push(p);});
  let winner=tied[0],tieNote=null;
  if(tied.length>1){
    if(g.lastWinner==null){winner=tied[Math.floor(g.rng()*tied.length)];tieNote='Tie on the first lot, settled by rock-paper-scissors';}
    else{
      const order=Array.from({length:g.n},(_,i)=>(g.lastWinner+1+i)%g.n);
      winner=order.find(p=>tied.includes(p));
      tieNote='Tie, broken clockwise from '+g.names[g.lastWinner];
    }
  }
  const res={round:g.round,lot:{...lot},bids,winner,price:top,tied:tied.length>1?tied:null,tieNote,gems:[],missions:[],revealed:null,fair:null};
  if(lot.kind==='gems'){
    const b=belief(g,winner);
    const lv=lotValue(g,winner,b);
    res.fair=lv.total;res.fairGems=lv.gv;res.fairMission=lv.mission;
    const k=Math.min(lot.gems,g.visible.length);
    res.gems=g.visible.splice(0,k);
    res.gems.forEach(c=>g.coll[winner][c]++);
    g.coins[winner]-=top;
    g.wins[winner].push({round:g.round,gems:res.gems.slice(),paid:top,fair:lv.gv,mission:lv.mission});
  }else if(lot.kind==='invest'){
    g.coins[winner]-=top;g.locked[winner]+=top;g.invRet[winner]+=lot.amt;
  }else{
    g.coins[winner]+=lot.amt-top;g.loans[winner]+=lot.amt;
  }
  res.needsReveal=g.hands[winner].length>0;
  g.result=res;g.phase='reveal';
  return res;
}
function reveal(g,p,c){
  const i=g.hands[p].indexOf(c);
  if(i<0)throw new Error('not in hand');
  g.hands[p].splice(i,1);g.display[c]++;
  g.revealed.push({p,c,round:g.round});
  g.result.revealed=c;
  return c;
}
function advance(g){
  const res=g.result,w=res.winner;
  if(res.lot.kind==='gems'){
    g.missions.forEach(m=>{
      if(m.takenBy==null&&missionDone(m,g.coll[w])){m.takenBy=w;g.taken[w].push(m);res.missions.push(m);}
    });
  }
  refill(g);
  // What each player's gems are expected to be worth at this moment, from that player's own point of view (for the review graph).
  res.evHeld=g.coll.map((cl,p)=>{const b=belief(g,p);return sum(cl.map((n,c)=>n*b.ev[c]));});
  g.lastWinner=w;
  g.history.push(res);
  // Once the last gem is bought, gem lots cannot be played, but the Invest and Loan cards still left in the deck are.
  if(g.gemDeck.length===0&&g.visible.length===0)g.auctionDeck=g.auctionDeck.filter(c=>c.kind!=='gems');
  if(!g.auctionDeck.length){finish(g);return g;}
  g.round++;g.lot=g.auctionDeck.pop();g.phase='bid';g.result=null;
  return g;
}
function finish(g){
  g.hands.forEach((h,p)=>{h.forEach(c=>{g.display[c]++;g.revealed.push({p,c,round:g.round,final:true});});h.length=0;});
  g.phase='done';g.done=true;g.scores=score(g);
}
function score(g){
  const ch=CHARTS[g.chart];
  return g.coins.map((_,p)=>{
    const rows=COLORS.map((_,c)=>{
      const n=g.coll[p][c],per=ch[Math.min(5,g.display[c])];
      return {c,n,per,pts:n*per};
    });
    const gemPts=sum(rows.map(r=>r.pts));
    const missionPts=sum(g.taken[p].map(m=>m.pts));
    const total=g.coins[p]+g.locked[p]+g.invRet[p]+gemPts+missionPts-g.loans[p];
    return {p,rows,gemPts,missionPts,coins:g.coins[p],locked:g.locked[p],invRet:g.invRet[p],loans:g.loans[p],total};
  });
}

// ---- advice and bots ----
// The most worth paying for the current lot, by the same rule the bots use: lot value divided by what a coin buys.
function suggest(g,p){
  const lot=g.lot,coins=g.coins[p],b=belief(g,p),lam=coinWorth(g,p,b);
  if(lot.kind==='gems'){
    const lv=lotValue(g,p,b);
    return {kind:'gems',gems:lv.gems,gv:lv.gv,mission:lv.mission,missions:lv.missions,total:lv.total,lam,max:lv.total/lam};
  }
  if(lot.kind==='invest'){
    if(!g.visible.length&&!g.gemDeck.length)return {kind:'invest',lam,max:coins};
    return {kind:'invest',lam,max:lam<1.08?coins*.5:Math.min(lot.amt/(lam-1),coins*.5)};
  }
  const use=coins<8?1:coins<16?.6:coins<26?.3:.1;
  // The bid is paid out of the loan, so only (amt - bid) is spendable, and amt is owed back: break-even where
  // (amt - bid) * (1 + use*(lam-1)) = amt, with `use` the share of that cash you expect to put to work.
  const k=use*(lam-1);
  return {kind:'loan',lam,use,max:lam<1.05?0:lot.amt*k/(1+k)};
}
function botBid(g,p){
  const per=g.persona[p];
  let raw=suggest(g,p).max;
  raw*=per.agg*(1+per.noise*(g.rng()*2-1));
  return Math.max(0,Math.min(maxBid(g,p),Math.round(raw)));
}
function botReveal(g,p){
  const hand=g.hands[p];
  let best=null,bs=1e9;
  hand.forEach(c=>{const s=g.coll[p][c]+g.rng()*.5;if(s<bs){bs=s;best=c;}});
  return best;
}

// ---- shared table record ----
// A multiplayer table is a seeded game plus every human decision, so each client rebuilds the identical game by replaying it.
// Record: e = epoch (a rematch bumps it), s = start {seed,chart,n,seats:[{u,n,b}]} (u = player id, b = bot persona index or -1 for a human),
// b[round-1][seat] = sealed bid (-1 unknown), v[round-1] = gem the winner revealed (-1 unknown), tk[seat] = round a bot took over from (-1 none).
const MAX_ROUNDS=40;
const isInt=(v,lo,hi)=>Number.isInteger(v)&&v>=lo&&v<=hi;
function cleanName(s){return String(s==null?'':s).replace(/[^\p{L}\p{N} _.'-]/gu,'').trim().slice(0,16);}
function emptyRecord(e){return {e:e||0,s:null,b:[],v:[],tk:[]};}
// Everything a peer sends is untrusted, so rebuild a record field by field.
function sanitizeRecord(x){
  if(!x||typeof x!=='object')return null;
  const R=emptyRecord(isInt(x.e,0,9999)?x.e:0),s=x.s;
  if(s&&typeof s==='object'&&isInt(s.n,3,5)&&typeof s.chart==='string'&&s.chart.length===1&&'ABCDE'.includes(s.chart)
     &&isInt(s.seed,0,2147483647)&&Array.isArray(s.seats)&&s.seats.length===s.n){
    const seats=s.seats.map(t=>t&&typeof t==='object'&&typeof t.u==='string'&&typeof t.n==='string'
      ?{u:t.u.slice(0,80),n:cleanName(t.n)||'Player',b:isInt(t.b,-1,PERSONAS.length-1)?t.b:-1}:null);
    if(seats.every(Boolean))R.s={seed:s.seed,chart:s.chart,n:s.n,seats};
  }
  if(Array.isArray(x.b))for(let i=0;i<Math.min(x.b.length,MAX_ROUNDS);i++){
    const row=Array.isArray(x.b[i])?x.b[i]:[];
    R.b[i]=Array.from({length:5},(_,p)=>isInt(row[p],0,500)?row[p]:-1);
  }
  if(Array.isArray(x.v))for(let i=0;i<Math.min(x.v.length,MAX_ROUNDS);i++)R.v[i]=isInt(x.v[i],0,NC-1)?x.v[i]:-1;
  R.tk=Array.from({length:5},(_,p)=>isInt(Array.isArray(x.tk)?x.tk[p]:null,1,MAX_ROUNDS)?x.tk[p]:-1);
  return R;
}
// Knowledge only grows: a higher epoch replaces the old game, and within one epoch each cell keeps whatever is known.
// Two starts in the same epoch (two rematch clicks at once) settle on the lower seed, so every client lands on the same game.
function mergeRecords(a,b){
  if(b.e!==a.e)return b.e>a.e?b:a;
  const at=(arr,i)=>arr[i]==null?-1:arr[i];
  const rows=Math.max(a.b.length,b.b.length),nv=Math.max(a.v.length,b.v.length);
  return {e:a.e,s:a.s&&b.s?(b.s.seed<a.s.seed?b.s:a.s):a.s||b.s,
    b:Array.from({length:rows},(_,i)=>Array.from({length:5},(_,p)=>Math.max(at(a.b[i]||[],p),at(b.b[i]||[],p)))),
    v:Array.from({length:nv},(_,i)=>Math.max(at(a.v,i),at(b.v,i))),
    tk:Array.from({length:5},(_,p)=>{const x=at(a.tk,p),y=at(b.tk,p);return x<0?y:y<0?x:Math.min(x,y);})};
}
const getBid=(R,r,p)=>{const x=(R.b[r-1]||[])[p];return x==null||x<0?null:x;};
const getReveal=(R,r)=>{const x=R.v[r-1];return x==null||x<0?null:x;};
function setBid(R,r,p,val){while(R.b.length<r)R.b.push(Array(5).fill(-1));R.b[r-1][p]=val;}
function setReveal(R,r,c){while(R.v.length<r)R.v.push(-1);R.v[r-1]=c;}
function setTakeover(R,p,r){while(R.tk.length<5)R.tk.push(-1);if(!(R.tk[p]>=1))R.tk[p]=r;}
const takenOver=(R,p,r)=>R.tk[p]>=1&&R.tk[p]<=r;
const botControlled=(R,p,r)=>R.s.seats[p].b>=0||takenOver(R,p,r);

// Host side: seat the humans plus bots up to n seats, in a random order.
function makeStart(humans,opts){
  const rand=opts.rand||Math.random;
  if(humans.length>5)throw new Error('A table seats at most 5 people');
  const n=Math.min(5,Math.max(3,opts.n||4,humans.length));
  const taken=new Set();
  const uniq=name=>{
    let nm=name||'Player',k=2;
    while(taken.has(nm.toLowerCase()))nm=name.slice(0,13)+' '+k++;
    taken.add(nm.toLowerCase());return nm;
  };
  const seats=humans.map(h=>({u:String(h.u).slice(0,80),n:uniq(cleanName(h.n)),b:-1}));
  for(let i=0;seats.length<n;i++){const k=i%PERSONAS.length;seats.push({u:'',n:uniq(PERSONAS[k].name),b:k});}
  shuffle(seats,rand);
  return {seed:Math.floor(rand()*2147483647),chart:opts.chart||'A',n,seats};
}

// Rebuild the game from a record, stopping at the first decision that has not arrived yet.
// wait is null when the game is over, else {kind:'bids',need:[seats]} or {kind:'reveal',who:seat}.
function replay(R){
  const S=R.s,n=S.n;
  const g=createGame({players:n,chart:S.chart,seed:S.seed,names:S.seats.map(t=>t.n)});
  S.seats.forEach((t,p)=>{g.persona[p]=PERSONAS[t.b>=0?t.b:p%PERSONAS.length];});
  let wait=null;
  for(let guard=0;!g.done&&guard<MAX_ROUNDS+5;guard++){
    const r=g.round;
    if(g.phase==='bid'){
      const bids=Array(n).fill(0),need=[],auto=[];
      S.seats.forEach((t,p)=>{
        const v=t.b>=0?null:getBid(R,r,p);
        if(v!=null)bids[p]=v;
        else if(botControlled(R,p,r))auto.push(p);
        else need.push(p);
      });
      if(need.length){wait={kind:'bids',need};break;}
      auto.forEach(p=>{bids[p]=botBid(g,p);});
      resolve(g,bids);
    }
    const w=g.result.winner;
    if(g.result.needsReveal){
      let c=S.seats[w].b>=0?null:getReveal(R,r);
      if(c!=null&&!g.hands[w].includes(c))c=null;
      if(c==null&&!botControlled(R,w,r)){wait={kind:'reveal',who:w};break;}
      reveal(g,w,c!=null?c:botReveal(g,w));
    }
    advance(g);
  }
  return {g,wait};
}

return {COLORS,CHARTS,CHART_NOTES,SETUP,PERSONAS,AUCTION_CARDS,
  createGame,resolve,reveal,advance,score,belief,lotValue,coinWorth,suggest,spotValue,maxBid,clampBid,tiePriority,
  missionDone,missionLabel,botBid,botReveal,mulberry32,
  cleanName,emptyRecord,sanitizeRecord,mergeRecords,getBid,getReveal,setBid,setReveal,setTakeover,botControlled,makeStart,replay};
});
