/* Hushgem relay.
   Outside claude.ai there is no built-in room service, so this gives the page the same tiny interface it already uses
   (claude.use('room') -> join(name) -> presence / peers / onPeers / onConnection / leave) on top of free public MQTT brokers.
   Each player publishes their presence (name, sealed bids, reveals) as one retained message on
       hushgem/v1/<table>/<peerId>
   and listens to everyone else's on the same table. Nothing here is a server of ours, and nothing is stored beyond the retained
   message, which the player's own disconnect (or the broker's last-will) clears.
   Needs window.mqtt (mqtt.js browser bundle) loaded first. Does nothing when window.claude already exists (inside claude.ai). */
(function(){
'use strict';
if(window.claude||!window.mqtt||typeof window.mqtt.connect!=='function'||typeof WebSocket==='undefined')return;

const TUNE=Object.assign({hb:15000,stale:50000,fresh:40000,connect:10000,sweep:5000},window.HUSHGEM_TUNING||{});
const RELAYS=Array.isArray(window.HUSHGEM_RELAYS)&&window.HUSHGEM_RELAYS.length
  ?window.HUSHGEM_RELAYS.slice(0,3)
  :['wss://broker.emqx.io:8084/mqtt','wss://broker.hivemq.com:8884/mqtt'];
const PREFIX='hushgem/v1/';
const MAX_PAYLOAD=200000,MAX_PEERS=64;
const NAME_RE=/^[a-z0-9][a-z0-9_.-]{0,47}$/,ID_RE=/^p[A-Za-z0-9]{6,24}$/;
const ALPHA='abcdefghijklmnopqrstuvwxyz0123456789';
const open=new Set();
let hidden=false;

function rid(n){
  const a=new Uint8Array(n);
  if(window.crypto&&crypto.getRandomValues)crypto.getRandomValues(a);else for(let i=0;i<n;i++)a[i]=Math.floor(Math.random()*256);
  let s='';for(let i=0;i<n;i++)s+=ALPHA[a[i]%ALPHA.length];
  return s;
}
const fail=(code,message)=>({code,message});
const safe=f=>{try{f();}catch(e){}};

function openChannel(name){
  const myId='p'+rid(11),base=PREFIX+name+'/',topic=base+myId;
  const mine={};let mineAt=Date.now(),seq=0,closed=false,wasUp=false;
  const others=new Map(),peerHandlers=new Set(),connHandlers=new Set(),clients=[];
  let snapshot=Object.freeze([]),sendTimer=null,notifyTimer=null,connTimer=null,hb=null,sweep=null;

  const payload=()=>JSON.stringify({s:seq,t:Date.now(),p:mine});
  const isUp=()=>clients.some(r=>r.up);

  function rebuild(){
    const list=[Object.freeze({peer:myId,by:null,isMe:true,sameTab:true,kind:'viewer',guest:false,presence:Object.freeze(Object.assign({},mine)),updatedAt:mineAt})];
    [...others.keys()].sort().forEach(id=>{
      const o=others.get(id);
      if(o.presence)list.push(Object.freeze({peer:id,by:null,isMe:false,sameTab:false,kind:'viewer',guest:false,presence:o.presence,updatedAt:o.updatedAt}));
    });
    snapshot=Object.freeze(list);
  }
  function notify(){
    if(notifyTimer||closed)return;
    notifyTimer=setTimeout(()=>{
      notifyTimer=null;if(closed)return;
      const change={peers:snapshot,joined:[],left:[],updated:[]};
      peerHandlers.forEach(h=>safe(()=>h(change)));
    },0);
  }
  function publishNow(){
    sendTimer=null;
    if(closed)return;
    const msg=payload();
    clients.forEach(r=>{if(r.up)safe(()=>r.c.publish(topic,msg,{qos:0,retain:true}));});
  }
  const schedule=()=>{if(!sendTimer&&!closed)sendTimer=setTimeout(publishNow,60);};
  function connChanged(){
    if(connTimer||closed)return;
    connTimer=setTimeout(()=>{
      connTimer=null;if(closed)return;
      const up=isUp();
      if(up===wasUp)return;
      wasUp=up;
      connHandlers.forEach(h=>safe(()=>h(up)));
    },0);
  }

  function onMessage(t,buf,packet){
    if(closed||typeof t!=='string'||t.indexOf(base)!==0)return;
    const id=t.slice(base.length);
    if(!ID_RE.test(id)||id===myId)return;
    if(!buf||buf.length===0){
      if(others.delete(id)){rebuild();notify();}
      return;
    }
    if(buf.length>MAX_PAYLOAD)return;
    let m;
    try{m=JSON.parse(buf.toString());}catch(e){return;}
    if(!m||typeof m!=='object'||!m.p||typeof m.p!=='object'||Array.isArray(m.p))return;
    const now=Date.now(),s=Number.isInteger(m.s)?m.s:0,tt=Number.isFinite(m.t)?m.t:0;
    let o=others.get(id);
    // A retained message is the broker replaying the last thing a peer said. If it is old, that peer is probably gone.
    if(!o&&packet&&packet.retain&&Math.abs(now-tt)>TUNE.fresh)return;
    if(!o){
      if(others.size>=MAX_PEERS)return;
      o={s:-1,presence:null,seenAt:now,updatedAt:now};others.set(id,o);
    }
    o.seenAt=now;
    if(s>o.s||!o.presence){o.s=s;o.presence=Object.freeze(m.p);o.updatedAt=now;rebuild();notify();}
  }

  const channel={
    name,
    emit:()=>Promise.resolve(),
    on:()=>()=>{},
    presence(patch){
      if(closed)return Promise.reject(fail('invalid_argument','left this table'));
      if(!patch||typeof patch!=='object'||Array.isArray(patch))return Promise.reject(fail('invalid_argument','presence needs an object'));
      let copy;
      try{copy=JSON.parse(JSON.stringify(patch));}catch(e){return Promise.reject(fail('invalid_argument','presence must be JSON'));}
      for(const k of Object.keys(copy)){if(copy[k]===null)delete mine[k];else mine[k]=copy[k];}
      seq++;mineAt=Date.now();
      rebuild();schedule();notify();
      return Promise.resolve();
    },
    peers:()=>snapshot,
    onPeers(h){
      peerHandlers.add(h);
      setTimeout(()=>{if(!closed&&peerHandlers.has(h))safe(()=>h({peers:snapshot,joined:snapshot,left:[],updated:[]}));},0);
      return()=>peerHandlers.delete(h);
    },
    connected:isUp,
    onConnection(h){
      connHandlers.add(h);
      setTimeout(()=>{if(!closed&&connHandlers.has(h))safe(()=>h(isUp()));},0);
      return()=>connHandlers.delete(h);
    },
    leave(){
      if(closed)return Promise.resolve();
      closed=true;open.delete(channel);
      clearTimeout(sendTimer);clearTimeout(notifyTimer);clearTimeout(connTimer);clearInterval(hb);clearInterval(sweep);
      peerHandlers.clear();connHandlers.clear();
      return new Promise(done=>{
        let left=clients.length;
        if(!left)return done();
        const one=()=>{if(--left<=0)done();};
        clients.forEach(r=>{
          let d=false;
          const finish=()=>{if(d)return;d=true;safe(()=>r.c.end(true));one();};
          if(r.up){safe(()=>r.c.publish(topic,'',{qos:0,retain:true},finish));setTimeout(finish,400);}
          else finish();
        });
      });
    },
  };

  rebuild();
  open.add(channel);
  const ready=new Promise((resolve,reject)=>{
    const to=setTimeout(()=>{
      if(isUp())return;
      channel.leave();
      reject(fail('upstream_error','could not reach a relay'));
    },TUNE.connect);
    RELAYS.forEach(url=>{
      let c;
      try{
        c=window.mqtt.connect(url,{clientId:'mg-'+myId+'-'+rid(4),clean:true,keepalive:30,reconnectPeriod:3000,connectTimeout:8000,
          protocolVersion:4,resubscribe:true,will:{topic,payload:'',qos:0,retain:true}});
      }catch(e){return;}
      const rec={c,up:false,subbed:false};clients.push(rec);
      c.on('connect',()=>{
        rec.up=true;
        if(!rec.subbed){rec.subbed=true;c.subscribe(base+'+',{qos:0},()=>{});}
        safe(()=>c.publish(topic,payload(),{qos:0,retain:true}));
        clearTimeout(to);resolve(channel);connChanged();
      });
      c.on('close',()=>{rec.up=false;connChanged();});
      c.on('error',()=>{});
      c.on('message',onMessage);
    });
    if(!clients.length){clearTimeout(to);channel.leave();reject(fail('upstream_error','no relay configured'));}
  });
  hb=setInterval(()=>{if(!closed&&isUp())publishNow();},TUNE.hb);
  sweep=setInterval(()=>{
    const now=Date.now();let gone=false;
    others.forEach((o,id)=>{if(now-o.seenAt>TUNE.stale){others.delete(id);gone=true;}});
    if(gone){rebuild();notify();}
  },TUNE.sweep);
  return ready;
}

const room={
  join(name){
    if(typeof name!=='string'||!NAME_RE.test(name))return Promise.reject(fail('invalid_argument','bad table name'));
    for(const ch of open){if(ch.name===name)return Promise.resolve(ch);}
    return openChannel(name);
  },
};

// Closing the tab: say goodbye so the table sees you leave at once instead of waiting for the timeout.
window.addEventListener('pagehide',()=>{hidden=[...open].length>0;[...open].forEach(ch=>safe(()=>ch.leave()));});
window.addEventListener('pageshow',e=>{if(e.persisted&&hidden)location.reload();});

window.claude=Object.freeze({use:name=>Promise.resolve(name==='room'?room:null)});
window.__mgHosted=true;
})();
