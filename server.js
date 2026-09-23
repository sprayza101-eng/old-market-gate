'use strict';
/* เซิร์ฟเวอร์เกม "ด่านตลาดเก่า" ออนไลน์ — ใช้เฉพาะ Node.js (ไม่ต้อง npm install)
   รัน:  node server.js   แล้วเปิด http://localhost:3000 */
const http=require('http');
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const E=require('./engine.js');

const PORT=parseInt(process.env.PORT,10)||3000;
const MAX_PLAYERS=20,MAX_ROOMS=300,MAX_MSG=64*1024;
const GUID='258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const STATIC={
  '/':['index.html','text/html; charset=utf-8'],
  '/index.html':['index.html','text/html; charset=utf-8'],
  '/engine.js':['engine.js','application/javascript; charset=utf-8']
};
const GOOD_KEYS=E.ALL; // ชื่อไฟล์ภาพที่อนุญาต: img/<ชนิดสินค้า>.jpg เท่านั้น
GOOD_KEYS.forEach(function(k){STATIC['/img/'+k+'.jpg']=['img/'+k+'.jpg','image/jpeg'];});

/* ---------- HTTP ---------- */
const server=http.createServer(function(req,res){
  const u=req.url.split('?')[0];
  if(u==='/healthz'){res.writeHead(200,{'Content-Type':'text/plain'});res.end('ok');return;}
  const f=STATIC[u];
  if(!f||(req.method!=='GET'&&req.method!=='HEAD')){res.writeHead(404,{'Content-Type':'text/plain'});res.end('Not found');return;}
  const isImg=u.indexOf('/img/')===0;
  fs.readFile(path.join(__dirname,f[0]),function(err,data){
    if(err){res.writeHead(500,{'Content-Type':'text/plain'});res.end('Server error');return;}
    res.writeHead(200,{'Content-Type':f[1],'Cache-Control':isImg?'public, max-age=604800, immutable':'no-cache'});
    res.end(req.method==='HEAD'?undefined:data);
  });
});

/* ---------- WebSocket (เขียนเองแบบย่อ ตาม RFC 6455) ---------- */
function frame(op,payload){
  const len=payload.length;
  let h;
  if(len<126){h=Buffer.from([0x80|op,len]);}
  else if(len<65536){h=Buffer.alloc(4);h[0]=0x80|op;h[1]=126;h.writeUInt16BE(len,2);}
  else{h=Buffer.alloc(10);h[0]=0x80|op;h[1]=127;h.writeBigUInt64BE(BigInt(len),2);}
  return Buffer.concat([h,payload]);
}
const conns=new Set();
class Conn{
  constructor(socket){
    this.socket=socket;this.buf=Buffer.alloc(0);this.frag=null;this.fragOp=0;
    this.alive=true;this.room=null;this.member=null;this.winStart=0;this.winCount=0;
    conns.add(this);
    socket.setNoDelay(true);
    socket.on('data',d=>this.onData(d));
    socket.on('close',()=>this.onClose());
    socket.on('error',()=>{try{socket.destroy();}catch(e){}});
  }
  send(obj){this.raw(1,Buffer.from(JSON.stringify(obj)));}
  raw(op,payload){
    if(this.socket.destroyed||!this.socket.writable)return;
    try{this.socket.write(frame(op,payload));}catch(e){}
  }
  close(){
    this.raw(8,Buffer.alloc(0));
    try{this.socket.end();}catch(e){}
  }
  onClose(){conns.delete(this);leaveRoom(this,true);}
  onData(chunk){
    this.alive=true;
    this.buf=Buffer.concat([this.buf,chunk]);
    for(;;){
      const b=this.buf;
      if(b.length<2)return;
      const fin=!!(b[0]&0x80),op=b[0]&0x0f,masked=!!(b[1]&0x80);
      let len=b[1]&0x7f,off=2;
      if(len===126){if(b.length<4)return;len=b.readUInt16BE(2);off=4;}
      else if(len===127){if(b.length<10)return;len=Number(b.readBigUInt64BE(2));off=10;}
      if(len>MAX_MSG){this.socket.destroy();return;}
      if(!masked){this.socket.destroy();return;}
      if(b.length<off+4+len)return;
      const mask=b.slice(off,off+4);
      const payload=Buffer.from(b.slice(off+4,off+4+len));
      for(let i=0;i<len;i++)payload[i]^=mask[i&3];
      this.buf=b.slice(off+4+len);
      if(op===8){this.close();return;}
      if(op===9){this.raw(10,payload);continue;}
      if(op===10)continue;
      if(op===1||op===2){
        if(fin){this.message(payload);}
        else{this.frag=[payload];this.fragOp=op;}
      }else if(op===0&&this.frag){
        this.frag.push(payload);
        if(fin){const all=Buffer.concat(this.frag);this.frag=null;this.message(all);}
      }
    }
  }
  message(payload){
    const now=Date.now();
    if(now-this.winStart>1000){this.winStart=now;this.winCount=0;}
    if(++this.winCount>40)return;
    let m;
    try{m=JSON.parse(payload.toString('utf8'));}catch(e){return;}
    try{handle(this,m);}catch(e){console.error('handler error',e);}
  }
}
server.on('upgrade',function(req,socket){
  if(req.url.split('?')[0]!=='/ws'||!req.headers['sec-websocket-key']){socket.destroy();return;}
  const accept=crypto.createHash('sha1').update(req.headers['sec-websocket-key']+GUID).digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+'\r\n\r\n');
  new Conn(socket);
});
setInterval(function(){
  conns.forEach(function(c){
    if(!c.alive){c.socket.destroy();return;}
    c.alive=false;c.raw(9,Buffer.alloc(0));
  });
},25000);

/* ---------- ห้องเล่น ---------- */
const rooms=new Map();
const CODE_CHARS='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function makeCode(){
  for(;;){
    let c='';
    for(let i=0;i<5;i++)c+=CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
    if(!rooms.has(c))return c;
  }
}
const newToken=()=>crypto.randomBytes(12).toString('hex');
function cleanName(s){
  return String(s==null?'':s).replace(/[\u0000-\u001f\u007f<>]/g,'').trim().slice(0,14);
}
function seatOf(room,member){return room.members.indexOf(member);}
function effHost(room){
  const i=room.members.findIndex(function(m){return !!m.conn;});
  return i<0?0:i;
}
function viewFor(room,seat){
  const v={code:room.code,phase:room.phase,me:seat,host:effHost(room),rounds:room.rounds,startCoins:room.startCoins,inspectDelay:room.inspectDelay==null?10:room.inspectDelay,
    members:room.members.map(function(m){return {name:m.name,online:!!m.conn,bot:!!m.bot};}),
    chat:room.chat.slice(-40)};
  if(room.phase!=='game')return v;
  const S=room.S;
  v.gphase=S.phase;v.roundNo=S.roundNo;v.totalRounds=S.totalRounds;v.sheriff=S.sheriff;v.merchants=S.merchants;
  v.deck=S.deck.length;
  v.piles=S.piles.map(function(p){return {n:p.length,top:p.length?p[p.length-1].t:null};});
  v.players=S.players.map(function(p,i){
    return {name:p.name,coins:p.coins,stall:p.stall,handN:p.hand.length,online:!!room.members[i].conn,bot:!!room.members[i].bot,hand:i===seat?p.hand:undefined};
  });
  v.prep=S.prep;v.inspIdx=S.inspIdx;v.offer=S.offer;v.bounty={};
  v.offerItems={hand:[],stall:{}};
  if(S.phase==='inspect'){
    const mh=S.players[S.merchants[S.inspIdx]].hand;
    v.offerItems={
      hand:S.offerItems.hand.map(function(id){const c=mh.find(function(x){return x.id===id;});return {id:id,t:c?c.t:null};}).filter(function(x){return x.t;}),
      stall:S.offerItems.stall
    };
    Object.keys(S.bounty).forEach(function(k){
      const g=S.bounty[k],ph=S.players[Number(k)].hand;
      v.bounty[k]={coins:g.coins,stall:g.stall,
        hand:g.hand.map(function(id){const c=ph.find(function(x){return x.id===id;});return {id:id,t:c?c.t:null};}).filter(function(x){return x.t;})};
    });
  }v.log=S.log;v.last=S.last;
  if(S.phase==='inspect'){
    const mi=S.merchants[S.inspIdx],b=S.bags[mi];
    v.insp={mi:mi,declared:b.declared,n:b.cards.length,startAt:S.inspStartAt||Date.now()};
  }
  v.myBag=S.bags[seat]||null;
  if(S.phase==='final'){v.score=E.score(S);v.awards=E.awards(S);v.stats=S.stats;}
  return v;
}
function broadcast(room){
  room.last=Date.now();
  room.members.forEach(function(m,i){
    if(m.conn)m.conn.send({t:'state',v:viewFor(room,i)});
  });
}

/* ---------- บอท ---------- */
// ดีเลย์ "คิด" ของบอทแต่ละสถานการณ์ (มิลลิวินาที) — นายด่านบอทตัดสินใจช้ากว่าพ่อค้าบอทเล็กน้อย
// เพื่อให้ข้อเสนอสินบน/เงินเปิดถุงของบอทตัวอื่น (ถ้ามี) มีโอกาสมาถึงก่อน
const BOT_DELAY={
  prep:[1500,3000],
  offer:[1200,2200],
  bounty:[1000,2000],
  decide:[2600,4000],
  next:[900,1600],
  roundEnd:[900,1600]
};
function randDelay(range){return range[0]+Math.floor(Math.random()*(range[1]-range[0]));}
function scheduleBot(room,key,range,fn){
  if(room.botBusy.has(key))return;
  room.botBusy.add(key);
  setTimeout(function(){
    room.botBusy.delete(key);
    if(!rooms.has(room.code))return;
    fn();
  },randDelay(range));
}
function botDoPrep(S,mi){
  const p=S.players[mi];
  const discardN=Math.random()<0.5?0:(1+Math.floor(Math.random()*3));
  if(discardN>0){
    const ids=p.hand.slice(0,Math.min(discardN,p.hand.length)).map(function(c){return c.id;});
    E.discardCards(S,mi,ids,Math.random()<0.5?0:1);
  }
  let guard=0;
  while(p.hand.length<E.HAND&&guard++<20)E.drawCard(S,mi,'deck');
  E.toLoad(S,mi);
  const counts={};E.LEGAL.forEach(function(t){counts[t]=0;});
  p.hand.forEach(function(c){if(counts[c.t]!==undefined)counts[c.t]++;});
  let declared=E.LEGAL[0],best=-1;
  E.LEGAL.forEach(function(t){if(counts[t]>best){best=counts[t];declared=t;}});
  let chosen=p.hand.filter(function(c){return c.t===declared;}).slice(0,5).map(function(c){return c.id;});
  if(!chosen.length){
    chosen=p.hand.slice(0,Math.min(3,p.hand.length)).map(function(c){return c.id;});
  }else if(Math.random()<0.35&&chosen.length<5){
    const extra=p.hand.filter(function(c){return chosen.indexOf(c.id)<0;}).slice(0,1+Math.floor(Math.random()*2));
    extra.forEach(function(c){if(chosen.length<5)chosen.push(c.id);});
  }
  if(!chosen.length&&p.hand.length)chosen=[p.hand[0].id];
  if(chosen.length)E.loadBag(S,mi,chosen,declared);
}
function botMaybeOffer(S,mi){
  if(Math.random()>=0.45)return;
  const m=S.players[mi];
  const coins=Math.min(m.coins,1+Math.floor(Math.random()*6));
  let handIds=[];
  if(m.hand.length&&Math.random()<0.2)handIds=[m.hand[Math.floor(Math.random()*m.hand.length)].id];
  const stall={};
  const owned=E.ALL.filter(function(t){return m.stall[t]>=3;});
  if(owned.length&&Math.random()<0.3)stall[owned[Math.floor(Math.random()*owned.length)]]=1;
  if(coins<1&&!handIds.length&&!Object.keys(stall).length)return;
  E.setOffer(S,coins,handIds,stall);
}
function botMaybeBounty(S,seat){
  if(Math.random()>=0.15)return;
  const p=S.players[seat];
  const coins=Math.min(p.coins,1+Math.floor(Math.random()*4));
  if(coins<1)return;
  E.setBounty(S,seat,coins,[],{});
}
function botDecide(S){
  const offerCoins=S.offer||0;
  const hasGoods=(S.offerItems.hand&&S.offerItems.hand.length>0)||Object.keys(S.offerItems.stall||{}).length>0;
  const bribeScore=offerCoins+(hasGoods?4:0);
  let bountyScore=0;
  Object.keys(S.bounty||{}).forEach(function(k){
    const g=S.bounty[k];
    bountyScore+=(g.coins||0)+(g.hand?g.hand.length*3:0)+Object.values(g.stall||{}).reduce(function(a,b){return a+b*3;},0);
  });
  const r=Math.random();
  if(bribeScore>0&&r<0.35+Math.min(0.5,bribeScore/12)){E.resolve(S,'bribe');return;}
  if(bountyScore>0&&Math.random()<0.3+Math.min(0.5,bountyScore/10)){E.resolve(S,'inspect');return;}
  E.resolve(S,Math.random()<0.5?'pass':'inspect');
}
function maybeScheduleBots(room){
  if(room.phase!=='game'||!room.S)return;
  const S=room.S,roundNo=S.roundNo;
  if(S.phase==='prep'){
    S.merchants.forEach(function(mi){
      const mem=room.members[mi];
      if(mem&&mem.bot&&S.prep[mi]&&S.prep[mi].step!=='done'){
        scheduleBot(room,'prep:'+mi+':'+roundNo,BOT_DELAY.prep,function(){
          if(room.phase!=='game'||room.S!==S||S.phase!=='prep'||S.roundNo!==roundNo||!S.prep[mi]||S.prep[mi].step==='done')return;
          botDoPrep(S,mi);broadcastAndBots(room);
        });
      }
    });
  }else if(S.phase==='inspect'&&S.merchants.length){
    const inspIdx=S.inspIdx,mi=S.merchants[inspIdx];
    const same=function(){return room.phase==='game'&&room.S===S&&S.phase==='inspect'&&S.roundNo===roundNo&&S.inspIdx===inspIdx;};
    const mMem=room.members[mi];
    if(mMem&&mMem.bot){
      scheduleBot(room,'offer:'+mi+':'+roundNo+':'+inspIdx,BOT_DELAY.offer,function(){
        if(!same())return;botMaybeOffer(S,mi);broadcastAndBots(room);
      });
    }
    room.members.forEach(function(m,seat){
      if(m&&m.bot&&seat!==S.sheriff&&seat!==mi){
        scheduleBot(room,'bounty:'+seat+':'+roundNo+':'+inspIdx,BOT_DELAY.bounty,function(){
          if(!same())return;botMaybeBounty(S,seat);broadcastAndBots(room);
        });
      }
    });
    const shMem=room.members[S.sheriff];
    if(shMem&&shMem.bot){
      // บอทนายด่านก็ต้องรอไม่น้อยกว่าเวลาหน่วงที่โฮสต์ตั้งไว้ เหมือนผู้เล่นจริง
      const waitMs=(room.inspectDelay||0)*1000;
      const decideRange=[Math.max(BOT_DELAY.decide[0],waitMs),Math.max(BOT_DELAY.decide[1],waitMs+1400)];
      scheduleBot(room,'decide:'+S.sheriff+':'+roundNo+':'+inspIdx,decideRange,function(){
        if(!same())return;botDecide(S);broadcastAndBots(room);
      });
    }
  }else if(S.phase==='result'){
    const shMem=room.members[S.sheriff];
    if(shMem&&shMem.bot){
      scheduleBot(room,'next:'+roundNo+':'+S.inspIdx,BOT_DELAY.next,function(){
        if(room.phase!=='game'||room.S!==S||S.phase!=='result'||S.roundNo!==roundNo)return;
        E.nextAfterResult(S);broadcastAndBots(room);
      });
    }
  }else if(S.phase==='roundEnd'){
    const shMem=room.members[S.sheriff];
    if(shMem&&shMem.bot){
      scheduleBot(room,'roundEnd:'+roundNo,BOT_DELAY.roundEnd,function(){
        if(room.phase!=='game'||room.S!==S||S.phase!=='roundEnd'||S.roundNo!==roundNo)return;
        E.startNextRound(S);broadcastAndBots(room);
      });
    }
  }
}
function broadcastAndBots(room){broadcast(room);maybeScheduleBots(room);}
function err(conn,msg,fatal){conn.send({t:'error',msg:msg,fatal:!!fatal});}
function detachOnly(conn){
  if(conn.member&&conn.member.conn===conn)conn.member.conn=null;
  conn.room=null;conn.member=null;
}
function leaveRoom(conn,closing){
  const room=conn.room,member=conn.member;
  if(!room||!member){conn.room=null;conn.member=null;return;}
  detachOnly(conn);
  if(room.phase==='lobby'){
    if(closing){
      // เน็ตหลุดชั่วคราว: เก็บที่นั่งไว้ 60 วินาทีเผื่อกลับเข้ามา
      setTimeout(function(){removeIfGone(room,member);},60000);
      broadcast(room);return;
    }
    removeMember(room,member);return;
  }
  broadcast(room);
}
function removeMember(room,member){
  const i=room.members.indexOf(member);
  if(i>=0)room.members.splice(i,1);
  if(!room.members.length){rooms.delete(room.code);return;}
  broadcast(room);
}
function removeIfGone(room,member){
  if(room.phase==='lobby'&&!member.conn&&room.members.indexOf(member)>=0)removeMember(room,member);
}
function attach(conn,room,member){
  if(member.conn&&member.conn!==conn){
    const old=member.conn;
    member.conn=null;old.room=null;old.member=null;
    old.send({t:'left'});old.close();
  }
  if(conn.member&&conn.member!==member)leaveRoom(conn);
  conn.room=room;conn.member=member;member.conn=conn;room.last=Date.now();
  conn.send({t:'hello',code:room.code,token:member.token});
}
function botName(room){
  let n=1;
  while(room.members.some(function(m){return m.name==='บอท '+n;}))n++;
  return 'บอท '+n;
}
function uniqueName(room,name){
  const base=name||('ผู้เล่น '+(room.members.length+1));
  let n=base,k=1;
  while(room.members.some(function(m){return m.name===n;}))n=base+' '+(++k);
  return n;
}

function handle(conn,m){
  if(!m||typeof m!=='object')return;
  switch(m.t){
    case 'ping':conn.send({t:'pong'});return;
    case 'create':{
      if(rooms.size>=MAX_ROOMS)return err(conn,'เซิร์ฟเวอร์เต็มชั่วคราว ลองใหม่อีกครั้งภายหลัง');
      leaveRoom(conn);
      const room={code:makeCode(),members:[],rounds:2,startCoins:50,inspectDelay:10,phase:'lobby',S:null,chat:[],chatId:0,last:Date.now(),botBusy:new Set()};
      const member={name:cleanName(m.name)||'ผู้เล่น 1',token:newToken(),conn:null};
      room.members.push(member);rooms.set(room.code,room);
      attach(conn,room,member);broadcast(room);return;
    }
    case 'join':{
      const room=rooms.get(String(m.code||'').toUpperCase().trim());
      if(!room)return err(conn,'ไม่พบห้องรหัสนี้ ตรวจรหัสอีกครั้ง');
      const name=cleanName(m.name);
      if(room.phase==='lobby'){
        if(room.members.length>=MAX_PLAYERS)return err(conn,'ห้องเต็มแล้ว (สูงสุด '+MAX_PLAYERS+' คน)');
        leaveRoom(conn);
        const member={name:uniqueName(room,name),token:newToken(),conn:null};
        room.members.push(member);
        attach(conn,room,member);broadcast(room);return;
      }
      const mem=room.members.find(function(x){return x.name===name;});
      if(!mem)return err(conn,'เกมเริ่มไปแล้ว เข้าได้เฉพาะคนที่หลุดออกไป โดยใช้ชื่อเดิม');
      if(mem.conn)return err(conn,'ชื่อนี้กำลังเล่นอยู่');
      attach(conn,room,mem);broadcast(room);return;
    }
    case 'rejoin':{
      const room=rooms.get(String(m.code||'').toUpperCase());
      const mem=room&&room.members.find(function(x){return x.token===m.token;});
      if(!mem){conn.send({t:'error',msg:'ห้องนี้ไม่มีแล้ว หรือหมดเวลา',fatal:true});return;}
      attach(conn,room,mem);broadcast(room);return;
    }
    case 'leave':
      leaveRoom(conn);conn.send({t:'left'});return;
  }
  const room=conn.room,member=conn.member;
  if(!room||!member)return;
  const seat=seatOf(room,member),isHost=effHost(room)===seat;
  switch(m.t){
    case 'settings':
      if(!isHost||room.phase!=='lobby')return;
      if(m.rounds!==undefined)room.rounds=Math.max(1,Math.min(50,parseInt(m.rounds,10)||1));
      if(m.coins!==undefined)room.startCoins=Math.max(0,Math.min(999,parseInt(m.coins,10)||0));
      if(m.delay!==undefined)room.inspectDelay=Math.max(0,Math.min(60,parseInt(m.delay,10)||0));
      broadcast(room);return;
    case 'kick':{
      if(!isHost||room.phase!=='lobby')return;
      const ti=parseInt(m.seat,10);
      if(!(ti>=0&&ti<room.members.length)||ti===seat)return;
      const target=room.members[ti];
      if(target.conn){const tc=target.conn;tc.send({t:'kicked'});detachOnly(tc);}
      removeMember(room,target);return;
    }
    case 'addBot':{
      if(!isHost||room.phase!=='lobby')return;
      if(room.members.length>=MAX_PLAYERS)return err(conn,'ห้องเต็มแล้ว (สูงสุด '+MAX_PLAYERS+' คน)');
      room.members.push({name:botName(room),token:null,conn:null,bot:true});
      broadcast(room);return;
    }
    case 'endgame':
      if(!isHost||room.phase!=='game')return;
      room.phase='lobby';room.S=null;room.botBusy=new Set();broadcast(room);return;
    case 'start':
      if(!isHost||room.phase!=='lobby')return;
      if(room.members.length<2)return err(conn,'ต้องมีผู้เล่นอย่างน้อย 2 คน');
      room.S=E.newGame(room.members.map(function(x){return x.name;}),room.rounds,undefined,room.startCoins);
      room.phase='game';broadcastAndBots(room);return;
    case 'chat':{
      const text=String(m.text==null?'':m.text).replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,200);
      if(!text)return;
      const now=Date.now();
      if(member.lastChat&&now-member.lastChat<300)return;
      member.lastChat=now;
      const msg={id:++room.chatId,seat:seat,name:member.name,text:text};
      room.chat.push(msg);if(room.chat.length>80)room.chat.shift();
      room.last=now;
      room.members.forEach(function(x){if(x.conn)x.conn.send({t:'chat',m:msg});});
      return;
    }
    case 'act':
      if(room.phase!=='game')return;
      game(room,seat,isHost,m);return;
  }
}
function toIds(a){
  return Array.isArray(a)?a.map(Number).filter(Number.isInteger).slice(0,20):[];
}
function game(room,me,isHost,m){
  const S=room.S,a=m.a;
  let changed=false;
  if(S.phase==='prep'){
    if(me===S.sheriff)return;
    if(a==='discard')changed=E.discardCards(S,me,toIds(m.ids),m.pile===0||m.pile==='0'?0:(m.pile===1||m.pile==='1'?1:-1));
    else if(a==='draw'){
      const src=m.src==='deck'?'deck':(m.src===0||m.src==='0'?0:(m.src===1||m.src==='1'?1:-1));
      changed=E.drawCard(S,me,src);
    }
    else if(a==='toLoad')changed=E.toLoad(S,me);
    else if(a==='seal')changed=E.loadBag(S,me,toIds(m.ids),String(m.declared));
  }else if(S.phase==='inspect'){
    if(a==='bounty')changed=E.setBounty(S,me,m.amount,toIds(m.hand),m.stall);
    else if(me===S.merchants[S.inspIdx]&&a==='offer')changed=E.setOffer(S,m.amount,toIds(m.hand),m.stall);
    else if(me===S.sheriff){
      const wait=(room.inspectDelay||0)*1000;
      const tooSoon=wait>0&&(Date.now()-(S.inspStartAt||0))<wait;
      if(!tooSoon){
        if(a==='accept')changed=!!E.resolve(S,'bribe');
        else if(a==='pass')changed=!!E.resolve(S,'pass');
        else if(a==='inspect')changed=!!E.resolve(S,'inspect');
      }
    }
  }else if(S.phase==='result'){
    if(me===S.sheriff&&a==='next')changed=E.nextAfterResult(S);
  }else if(S.phase==='roundEnd'){
    if(me===S.sheriff&&a==='nextRound')changed=E.startNextRound(S);
  }else if(S.phase==='final'){
    if(isHost&&a==='again'){room.phase='lobby';room.S=null;room.botBusy=new Set();changed=true;}
  }
  if(changed)broadcastAndBots(room);
}
setInterval(function(){
  const cutoff=Date.now()-3*3600*1000;
  rooms.forEach(function(r,code){
    if(r.last<cutoff&&!r.members.some(function(m){return m.conn;}))rooms.delete(code);
  });
},10*60*1000);

server.listen(PORT,'0.0.0.0',function(){
  console.log('ด่านตลาดเก่า ออนไลน์ พร้อมแล้วที่ http://localhost:'+PORT);
});
