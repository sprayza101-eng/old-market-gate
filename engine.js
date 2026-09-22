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

function newStats(){
  return {bags:0,lies:0,liesPassed:0,caught:0,honestOpened:0,inspected:0,passed:0,contrabandPassed:0,
    bribeGiven:0,bribeGivenCount:0,bribeTaken:0,bribeTakenCount:0,bountyGiven:0,penPaid:0,penGot:0};
}
function giftValue(g){
  let v=g.coins||0;
  Object.keys(g.stall||{}).forEach(function(t){v+=GOODS[t].value*g.stall[t];});
  (g.hand||[]).forEach(function(c){v+=GOODS[c.t].value;});
  return v;
}
function newGame(names,rounds,rnd,startCoins){
  rnd=rnd||Math.random;
  const sc=(startCoins==null||isNaN(startCoins))?START_COINS:Math.max(0,Math.min(999,startCoins|0));
  const S={
    nextId:1,extra:0,
    players:names.map(function(n){return {name:n,coins:sc,hand:[],stall:emptyStall()};}),
    deck:[],piles:[[],[]],
    rounds:rounds,totalRounds:names.length*rounds,roundNo:0,sheriff:0,
    merchants:[],prep:{},bags:{},inspIdx:0,offer:0,offerItems:{hand:[],stall:{}},bounty:{},last:null,phase:'prep',log:[]
  };
  S.stats=S.players.map(newStats);
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
function cleanGift(p,amount,hand,stall){
  // ตรวจและตัดของที่เสนอให้เหลือเท่าที่ผู้เสนอมีจริง: เหรียญ + ไพ่จากมือ + สินค้าจากแผง
  let a=Math.floor(Number(amount));
  if(!isFinite(a)||a<0)a=0;
  const hs=uniq(Array.isArray(hand)?hand.map(Number):[]).filter(function(id){
    return p.hand.some(function(c){return c.id===id;});
  });
  const st={};
  if(stall&&typeof stall==='object'){
    ALL.forEach(function(t){
      let n=Math.floor(Number(stall[t]));
      if(isFinite(n)&&n>0){n=Math.min(n,p.stall[t]);if(n>0)st[t]=n;}
    });
  }
  return {coins:Math.min(a,p.coins),hand:hs,stall:st};
}
function giftEmpty(g){
  return !(g.coins>0||g.hand.length>0||Object.keys(g.stall).length>0);
}
function setOffer(S,amount,hand,stall){
  // ข้อเสนอสินบนของพ่อค้าเจ้าของถุง (ส่งใหม่ทั้งชุดทุกครั้ง)
  if(S.phase!=='inspect')return false;
  const g=cleanGift(S.players[S.merchants[S.inspIdx]],amount,hand,stall);
  S.offer=g.coins;
  S.offerItems={hand:g.hand,stall:g.stall};
  return true;
}
function setBounty(S,pi,amount,hand,stall){
  // ผู้เล่นอื่น (ไม่ใช่นายด่าน/เจ้าของถุง) เสนอของให้นายด่านเปิดถุงที่กำลังตรวจ — มอบให้จริงเมื่อนายด่านเปิดถุงเท่านั้น
  if(S.phase!=='inspect'||!S.players[pi])return false;
  if(pi===S.sheriff||pi===S.merchants[S.inspIdx])return false;
  const g=cleanGift(S.players[pi],amount,hand,stall);
  if(giftEmpty(g))delete S.bounty[pi];else S.bounty[pi]=g;
  return true;
}
function handOver(from,to,g){
  const gave={coins:0,hand:[],stall:{}};
  gave.coins=pay(from,to,g.coins);
  g.hand.forEach(function(id){
    const k=from.hand.findIndex(function(c){return c.id===id;});
    if(k>=0){const c=from.hand.splice(k,1)[0];to.stall[c.t]++;gave.hand.push(c);}
  });
  Object.keys(g.stall).forEach(function(t){
    const n=Math.min(g.stall[t],from.stall[t]);
    if(n>0){from.stall[t]-=n;to.stall[t]+=n;gave.stall[t]=n;}
  });
  return gave;
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
    res.due=Math.min(S.offer,m.coins);
    const gave=handOver(m,sh,{coins:S.offer,hand:S.offerItems.hand,stall:S.offerItems.stall});
    res.paid=gave.coins;
    res.gave=gave;
    res.kept=bag.cards.slice();
    S.log.push(m.name+' จ่ายสินบน '+describeGave(gave)+' ให้ '+sh.name+' — ถุงผ่านโดยไม่เปิด');
  }else if(mode==='pass'){
    res.kept=bag.cards.slice();
    S.log.push(sh.name+' ปล่อยถุงของ '+m.name+' ผ่านโดยไม่เปิด');
  }else{
    const who=[];
    Object.keys(S.bounty).forEach(function(k){
      const pi=Number(k),gv=handOver(S.players[pi],sh,S.bounty[k]);
      if(!giftEmpty(gv)){res.bounty.push({seat:pi,paid:gv.coins,gave:gv});who.push(S.players[pi].name+' '+describeGave(gv));}
    });
    if(who.length)S.log.push(who.join(' · ')+' มอบให้ '+sh.name+' เพื่อให้เปิดถุงของ '+m.name);
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
  const stt=S.stats,ms=stt[mi],ss=stt[S.sheriff];
  ms.bags++;
  if(!truth){ms.lies++;if(mode!=='inspect')ms.liesPassed++;}
  if(mode==='inspect'){
    ss.inspected++;
    if(res.honest){ss.honestOpened++;ss.penPaid+=res.paid;ms.penGot+=res.paid;}
    else{ms.caught++;ms.penPaid+=res.paid;ss.penGot+=res.paid;}
  }else if(mode==='pass'){ss.passed++;}
  else{
    const gv=giftValue(res.gave);
    ms.bribeGiven+=gv;ms.bribeGivenCount++;ss.bribeTaken+=gv;ss.bribeTakenCount++;
  }
  res.kept.forEach(function(c){if(!GOODS[c.t].legal)ms.contrabandPassed++;});
  res.bounty.forEach(function(b){stt[b.seat].bountyGiven+=giftValue(b.gave);});
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

function awards(S){
  const defs=[
    {k:'liar',icon:'🤥',title:'นักโกหกตัวยง',f:'lies',t:function(v){return 'โกหกในถุง '+v+' ครั้ง';}},
    {k:'smooth',icon:'😏',title:'เนียนกริบ',f:'liesPassed',t:function(v){return 'โกหกแล้วผ่านด่านไปได้ '+v+' ครั้ง';}},
    {k:'caught',icon:'🚨',title:'ซวยที่สุด',f:'caught',t:function(v){return 'ถูกจับได้ '+v+' ครั้ง';}},
    {k:'smuggler',icon:'🏴‍☠️',title:'จอมลักลอบ',f:'contrabandPassed',t:function(v){return 'ลักของเถื่อนผ่านด่าน '+v+' ใบ';}},
    {k:'briber',icon:'💰',title:'ราชาสินบน',f:'bribeGiven',t:function(v){return 'จ่ายสินบนมูลค่ารวม '+v+' เหรียญ';}},
    {k:'takenSheriff',icon:'🤫',title:'นายด่านรับใต้โต๊ะ',f:'bribeTaken',t:function(v){return 'รับสินบนมูลค่ารวม '+v+' เหรียญ';}},
    {k:'wrong',icon:'🤦',title:'สงสัยผิดคน',f:'honestOpened',t:function(v){return 'เปิดถุงคนพูดจริง '+v+' ครั้ง';}},
    {k:'strict',icon:'🔍',title:'นายด่านเหล็ก',f:'inspected',t:function(v){return 'เปิดถุงตรวจ '+v+' ครั้ง';}},
    {k:'maker',icon:'🕴️',title:'ผู้ชักใย',f:'bountyGiven',t:function(v){return 'เสนอให้เปิดถุงรวมมูลค่า '+v+' เหรียญ';}}
  ];
  return defs.map(function(d){
    const vals=S.stats.map(function(x){return x[d.f];});
    const max=Math.max.apply(null,vals);
    if(!(max>0))return null;
    return {key:d.k,icon:d.icon,title:d.title,text:d.t(max),
      seats:vals.map(function(v,i){return v===max?i:-1;}).filter(function(i){return i>=0;})};
  }).filter(Boolean);
}

return {awards:awards,describeGave:describeGave,GOODS:GOODS,ALL:ALL,LEGAL:LEGAL,HAND:HAND,BAG_MAX:BAG_MAX,DISCARD_MAX:DISCARD_MAX,
  newGame:newGame,drawCard:drawCard,discardCards:discardCards,toLoad:toLoad,loadBag:loadBag,
  setOffer:setOffer,setBounty:setBounty,resolve:resolve,nextAfterResult:nextAfterResult,startNextRound:startNextRound,score:score};
});
