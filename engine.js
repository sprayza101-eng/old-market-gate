/* กติกาเกม "ด่านตลาดเก่า" — ใช้ร่วมกันทั้งเซิร์ฟเวอร์ (Node) และเบราว์เซอร์ */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.Engine=factory();
})(typeof self!=='undefined'?self:this,function(){
'use strict';

const GOODS={
  apple:{name:'แอปเปิล',emoji:'🍎',value:2,pen:2,legal:true,king:20,queen:10},
  cheese:{name:'ชีส',emoji:'🧀',value:3,pen:2,legal:true,king:15,queen:10},
  bread:{name:'ขนมปัง',emoji:'🍞',value:3,pen:2,legal:true,king:15,queen:10},
  chicken:{name:'ไก่',emoji:'🐔',value:4,pen:2,legal:true,king:10,queen:5},
  pepper:{name:'พริกไทย',emoji:'🌶️',value:6,pen:4,legal:false,bonus:{chicken:2}},
  mead:{name:'น้ำผึ้งหมัก',emoji:'🍯',value:7,pen:4,legal:false,bonus:{bread:2}},
  silk:{name:'ผ้าไหม',emoji:'🧵',value:8,pen:4,legal:false,bonus:{cheese:3}},
  crossbow:{name:'หน้าไม้',emoji:'🏹',value:9,pen:4,legal:false,bonus:{apple:2}}
};
const ALL=Object.keys(GOODS);
const LEGAL=ALL.filter(function(k){return GOODS[k].legal;});
const DECK_COUNTS={apple:48,cheese:36,bread:36,chicken:24,pepper:22,mead:21,silk:12,crossbow:5};
const HAND=6,BAG_MAX=5,DISCARD_MAX=5,START_COINS=50;

function shuffle(a,rnd){for(let i=a.length-1;i>0;i--){const j=Math.floor(rnd()*(i+1));const t=a[i];a[i]=a[j];a[j]=t;}return a;}
function emptyStall(){const o={};ALL.forEach(function(k){o[k]=0;});return o;}
function uniq(ids){return Array.from(new Set(ids));}

function newGame(names,rounds,rnd){
  rnd=rnd||Math.random;
  const S={
    nextId:1,extra:0,
    players:names.map(function(n){return {name:n,coins:START_COINS,hand:[],stall:emptyStall()};}),
    deck:[],piles:[[],[]],
    rounds:rounds,totalRounds:names.length*rounds,roundNo:0,sheriff:0,
    merchants:[],prep:{},bags:{},inspIdx:0,offer:0,offerItems:{hand:[],stall:{}},bounty:{},last:null,phase:'prep',log:[]
  };
  const scale=Math.max(1,Math.ceil(names.length/5));
  ALL.forEach(function(t){for(let i=0;i<DECK_COUNTS[t]*scale;i++)S.deck.push({id:S.nextId++,t:t});});
  shuffle(S.deck,rnd);
  S.players.forEach(function(p){for(let i=0;i<HAND;i++)p.hand.push(S.deck.pop());});
  for(let k=0;k<2;k++)for(let i=0;i<5;i++)S.piles[k].push(S.deck.pop());
  beginRound(S);
  return S;
}
function beginRound(S){
  const n=S.players.length;
  S.merchants=[];
  for(let i=1;i<n;i++)S.merchants.push((S.sheriff+i)%n);
  S.prep={};
  S.merchants.forEach(function(mi){S.prep[mi]={step:'market',discarded:0};});
  S.bags={};S.inspIdx=0;S.offer=0;S.offerItems={hand:[],stall:{}};S.bounty={};S.last=null;S.log=[];S.phase='prep';
}
function canReshuffle(S){return S.piles.some(function(p){return p.length>1;});}
function reshuffle(S,rnd){
  rnd=rnd||Math.random;
  let pool=[];
  S.piles.forEach(function(p){
    if(p.length>1){const top=p[p.length-1];pool=pool.concat(p.slice(0,-1));p.length=0;p.push(top);}
  });
  shuffle(pool,rnd);
  S.deck=S.deck.concat(pool);
}
function freshDeck(S,rnd){
  // ไพ่หมดจริง (สินค้าไปอยู่ในแผงหมด) — เติมสำรองชุดใหม่ให้เกมเดินต่อได้
  const add=[];
  ALL.forEach(function(t){for(let i=0;i<DECK_COUNTS[t];i++)add.push({id:S.nextId++,t:t});});
  shuffle(add,rnd||Math.random);
  S.deck=S.deck.concat(add);
  S.extra+=add.length;
}
function drawCard(S,pi,src,rnd){
  const pr=S.prep[pi],p=S.players[pi];
  if(S.phase!=='prep'||!pr||pr.step!=='market'||p.hand.length>=HAND)return false;
  if(src==='deck'){
    if(!S.deck.length&&canReshuffle(S))reshuffle(S,rnd);
    if(!S.deck.length)freshDeck(S,rnd);
    p.hand.push(S.deck.pop());return true;
  }
  const pile=S.piles[src];
  if(!pile||!pile.length)return false;
  p.hand.push(pile.pop());return true;
}
function discardCards(S,pi,ids,pile){
  const pr=S.prep[pi],p=S.players[pi];
  if(S.phase!=='prep'||!pr||pr.step!=='market'||(pile!==0&&pile!==1))return false;
  ids=uniq(ids);
  if(!ids.length||pr.discarded+ids.length>DISCARD_MAX)return false;
  if(!ids.every(function(id){return p.hand.some(function(c){return c.id===id;});}))return false;
  ids.forEach(function(id){
    const k=p.hand.findIndex(function(c){return c.id===id;});
    S.piles[pile].push(p.hand.splice(k,1)[0]);pr.discarded++;
  });
  return true;
}
function toLoad(S,pi){
  const pr=S.prep[pi],p=S.players[pi];
  if(S.phase!=='prep'||!pr||pr.step!=='market'||p.hand.length<HAND)return false;
  pr.step='load';return true;
}
function loadBag(S,pi,ids,declared){
  const pr=S.prep[pi],p=S.players[pi];
  if(S.phase!=='prep'||!pr||pr.step!=='load')return false;
  ids=uniq(ids);
  if(ids.length<1||ids.length>BAG_MAX||LEGAL.indexOf(declared)<0)return false;
  if(!ids.every(function(id){return p.hand.some(function(c){return c.id===id;});}))return false;
  const cards=ids.map(function(id){
    const k=p.hand.findIndex(function(c){return c.id===id;});
    return p.hand.splice(k,1)[0];
  });
  S.bags[pi]={cards:cards,declared:declared};
  pr.step='done';
  if(S.merchants.every(function(mi){return S.prep[mi].step==='done';})){
    S.phase='inspect';S.inspIdx=0;S.offer=0;S.offerItems={hand:[],stall:{}};S.bounty={};
  }
  return true;
}
function offerEmpty(S){
  const o=S.offerItems;
  return !(S.offer>0||o.hand.length>0||Object.keys(o.stall).some(function(k){return o.stall[k]>0;}));
}
function describeGave(g){
  const parts=[];
  if(g.coins>0)parts.push(g.coins+' เหรียญ');
  const st=Object.keys(g.stall).filter(function(t){return g.stall[t]>0;}).map(function(t){return GOODS[t].emoji+'×'+g.stall[t];});
  if(st.length)parts.push('สินค้าจากแผง '+st.join(' '));
  if(g.hand.length)parts.push('ไพ่จากมือ '+g.hand.map(function(c){return GOODS[c.t].emoji;}).join(''));
  return parts.join(' + ');
}
function setOffer(S,amount,hand,stall){
  // ข้อเสนอสินบนของพ่อค้า: เหรียญ + ไพ่จากมือ + สินค้าจากแผง (ส่งใหม่ทั้งชุดทุกครั้ง)
  if(S.phase!=='inspect')return false;
  const m=S.players[S.merchants[S.inspIdx]];
  let a=Math.floor(Number(amount));
  if(!isFinite(a)||a<0)a=0;
  S.offer=Math.min(a,m.coins);
  const hs=uniq(Array.isArray(hand)?hand.map(Number):[]).filter(function(id){
    return m.hand.some(function(c){return c.id===id;});
  });
  const st={};
  if(stall&&typeof stall==='object'){
    ALL.forEach(function(t){
      let n=Math.floor(Number(stall[t]));
      if(isFinite(n)&&n>0){n=Math.min(n,m.stall[t]);if(n>0)st[t]=n;}
    });
  }
  S.offerItems={hand:hs,stall:st};
  return true;
}
function setBounty(S,pi,amount){
  // ผู้เล่นอื่น (ไม่ใช่นายด่าน/เจ้าของถุง) เสนอเงินให้นายด่านเปิดถุงที่กำลังตรวจ — จ่ายจริงเมื่อนายด่านเปิดถุงเท่านั้น
  if(S.phase!=='inspect'||!S.players[pi])return false;
  if(pi===S.sheriff||pi===S.merchants[S.inspIdx])return false;
  let a=Math.floor(Number(amount));
  if(!isFinite(a)||a<0)a=0;
  a=Math.min(a,S.players[pi].coins);
  if(a<1)delete S.bounty[pi];else S.bounty[pi]=a;
  return true;
}
function pay(from,to,amt){
  const a=Math.max(0,Math.min(amt,from.coins));
  from.coins-=a;to.coins+=a;return a;
}
function resolve(S,mode){
  if(S.phase!=='inspect')return null;
  const mi=S.merchants[S.inspIdx];
  const m=S.players[mi],sh=S.players[S.sheriff],bag=S.bags[mi];
  if(mode==='bribe'&&offerEmpty(S))return null;
  const truth=bag.cards.every(function(c){return c.t===bag.declared;});
  const res={merchant:mi,declared:bag.declared,cards:bag.cards.slice(),mode:mode,truth:truth,paid:0,due:0,honest:null,kept:[],seized:[],bounty:[]};
  if(mode==='bribe'){
    const gave={coins:0,hand:[],stall:{}};
    res.due=Math.min(S.offer,m.coins);
    res.paid=pay(m,sh,res.due);
    gave.coins=res.paid;
    S.offerItems.hand.forEach(function(id){
      const k=m.hand.findIndex(function(c){return c.id===id;});
      if(k>=0){const c=m.hand.splice(k,1)[0];sh.stall[c.t]++;gave.hand.push(c);}
    });
    Object.keys(S.offerItems.stall).forEach(function(t){
      const n=Math.min(S.offerItems.stall[t],m.stall[t]);
      if(n>0){m.stall[t]-=n;sh.stall[t]+=n;gave.stall[t]=n;}
    });
    res.gave=gave;
    res.kept=bag.cards.slice();
    S.log.push(m.name+' จ่ายสินบน '+describeGave(gave)+' ให้ '+sh.name+' — ถุงผ่านโดยไม่เปิด');
  }else if(mode==='pass'){
    res.kept=bag.cards.slice();
    S.log.push(sh.name+' ปล่อยถุงของ '+m.name+' ผ่านโดยไม่เปิด');
  }else{
    let tot=0;const who=[];
    Object.keys(S.bounty).forEach(function(k){
      const pi=Number(k),pd=pay(S.players[pi],sh,S.bounty[k]);
      if(pd>0){res.bounty.push({seat:pi,paid:pd});tot+=pd;who.push(S.players[pi].name);}
    });
    if(tot>0)S.log.push(who.join(', ')+' จ่ายเงินรวม '+tot+' เหรียญให้ '+sh.name+' เพื่อให้เปิดถุงของ '+m.name);
    const kept=[],seized=[];
    bag.cards.forEach(function(c){(c.t===bag.declared?kept:seized).push(c);});
    if(!seized.length){
      res.honest=true;
      res.due=GOODS[bag.declared].pen*bag.cards.length;
      res.paid=pay(sh,m,res.due);
      S.log.push(sh.name+' เปิดถุงของ '+m.name+' — พูดจริง! จ่ายค่าปรับ '+res.paid+' เหรียญ');
    }else{
      res.honest=false;
      res.due=seized.reduce(function(s,c){return s+GOODS[c.t].pen;},0);
      res.paid=pay(m,sh,res.due);
      seized.forEach(function(c){const k=S.piles[0].length<=S.piles[1].length?0:1;S.piles[k].push(c);});
      S.log.push(sh.name+' เปิดถุงของ '+m.name+' — จับได้! ยึด '+seized.length+' ใบ ค่าปรับ '+res.paid+' เหรียญ');
    }
    res.kept=kept;res.seized=seized;
  }
  res.kept.forEach(function(c){m.stall[c.t]++;});
  delete S.bags[mi];
  S.offer=0;S.offerItems={hand:[],stall:{}};S.bounty={};
  S.last=res;S.phase='result';
  return res;
}
function nextAfterResult(S){
  if(S.phase!=='result')return false;
  S.inspIdx++;S.last=null;S.offer=0;S.offerItems={hand:[],stall:{}};S.bounty={};
  S.phase=S.inspIdx>=S.merchants.length?'roundEnd':'inspect';
  return true;
}
function startNextRound(S){
  if(S.phase!=='roundEnd')return false;
  S.roundNo++;
  if(S.roundNo>=S.totalRounds){S.phase='final';return true;}
  S.sheriff=(S.sheriff+1)%S.players.length;
  beginRound(S);
  return true;
}
function score(S){
  const eff=S.players.map(function(p){
    const c={};LEGAL.forEach(function(k){c[k]=p.stall[k];});
    ALL.forEach(function(k){const b=GOODS[k].bonus;if(b)for(const t in b)c[t]+=b[t]*p.stall[k];});
    return c;
  });
  const bonus=S.players.map(function(){return 0;});
  const bonusList=S.players.map(function(){return [];});
  const kq=[];
  LEGAL.forEach(function(t){
    const g=GOODS[t];
    const arr=eff.map(function(c,i){return {i:i,n:c[t]};}).filter(function(x){return x.n>0;}).sort(function(a,b){return b.n-a.n;});
    if(!arr.length){kq.push({t:t,kings:[],queens:[],tie:false});return;}
    const top=arr[0].n;
    const kings=arr.filter(function(x){return x.n===top;});
    if(kings.length>1){
      const share=Math.floor((g.king+g.queen)/kings.length);
      kings.forEach(function(x){bonus[x.i]+=share;bonusList[x.i].push({t:t,role:'tie',amt:share});});
      kq.push({t:t,kings:kings.map(function(x){return x.i;}),queens:[],tie:true});
    }else{
      bonus[kings[0].i]+=g.king;bonusList[kings[0].i].push({t:t,role:'king',amt:g.king});
      const rest=arr.filter(function(x){return x.n<top;});
      let queens=[];
      if(rest.length){
        const q=rest[0].n;
        queens=rest.filter(function(x){return x.n===q;});
        const share=Math.floor(g.queen/queens.length);
        queens.forEach(function(x){bonus[x.i]+=share;bonusList[x.i].push({t:t,role:'queen',amt:share});});
      }
      kq.push({t:t,kings:[kings[0].i],queens:queens.map(function(x){return x.i;}),tie:false});
    }
  });
  const rows=S.players.map(function(p,i){
    let goods=0;ALL.forEach(function(k){goods+=GOODS[k].value*p.stall[k];});
    return {i:i,name:p.name,coins:p.coins,goods:goods,bonus:bonus[i],bonusList:bonusList[i],total:p.coins+goods+bonus[i]};
  });
  return {rows:rows,kq:kq};
}

return {describeGave:describeGave,GOODS:GOODS,ALL:ALL,LEGAL:LEGAL,HAND:HAND,BAG_MAX:BAG_MAX,DISCARD_MAX:DISCARD_MAX,
  newGame:newGame,drawCard:drawCard,discardCards:discardCards,toLoad:toLoad,loadBag:loadBag,
  setOffer:setOffer,setBounty:setBounty,resolve:resolve,nextAfterResult:nextAfterResult,startNextRound:startNextRound,score:score};
});
