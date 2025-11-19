
const socket = io();

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const WIDTH = canvas.width;
const HEIGHT = canvas.height;

const loginScreen = document.getElementById("login-screen");
const loginNameInput = document.getElementById("login-name");
const loginBtn = document.getElementById("login-btn");

const playerInfoEl = document.getElementById("player-info");
const navButtons = document.querySelectorAll("#top-nav button");
const views = {
  plaza: document.getElementById("view-plaza"),
  rooms: document.getElementById("view-rooms"),
  inventory: document.getElementById("view-inventory"),
  shop: document.getElementById("view-shop"),
};

const plazaChatEl = document.getElementById("plaza-chat");
const plazaInput = document.getElementById("plaza-input");

const roomsListEl = document.getElementById("rooms-list");
const roomNameInput = document.getElementById("room-name-input");
const createRoomBtn = document.getElementById("create-room-btn");
const roomTitleEl = document.getElementById("room-title");
const roundInfoEl = document.getElementById("round-info");
const timeLeftEl = document.getElementById("time-left");
const lastWordEl = document.getElementById("last-word");
const currentTurnEl = document.getElementById("current-turn");
const startWordBtn = document.getElementById("start-word-btn");
const leaveRoomBtn = document.getElementById("leave-room-btn");
const roomLogEl = document.getElementById("room-log");
const roomInput = document.getElementById("room-input");

let selfId = null;
let selfUserId = null;
let selfName = null;

let plaza = { mapId: "village", players: {} };
let rooms = [];
let currentRoomId = null;
let currentRoomState = null;

let keys = { ArrowUp:false,ArrowDown:false,ArrowLeft:false,ArrowRight:false };

// 맵 이미지
const mapImages = {
  village: { img:new Image(), loaded:false, width:1200, height:1200 },
  beach:   { img:new Image(), loaded:false, width:1200, height:1200 },
  forest:  { img:new Image(), loaded:false, width:1200, height:1200 },
};

let spritesLoaded = false;
const spriteImages = { body_idle:new Image() };
const SPRITE = { frameWidth:1200, frameHeight:1200, idleFrames:4, frameDuration:0.18, scale:0.22 };
let animTime = 0;
let lastTimestamp = 0;

function addPlazaChat(msg){
  const p=document.createElement("p");p.textContent=msg;
  plazaChatEl.appendChild(p);plazaChatEl.scrollTop=plazaChatEl.scrollHeight;
}
function addRoomLog(msg){
  const p=document.createElement("p");p.textContent=msg;
  roomLogEl.appendChild(p);roomLogEl.scrollTop=roomLogEl.scrollHeight;
}

function switchView(name){
  Object.keys(views).forEach(k=>views[k].classList.toggle("active",k===name));
  navButtons.forEach(btn=>btn.classList.toggle("active",btn.dataset.view===name));
}
navButtons.forEach(btn=>btn.addEventListener("click",()=>switchView(btn.dataset.view)));

// 이미지 로드
function loadImage(src){
  return new Promise((resolve,reject)=>{
    const img=new Image();
    img.onload=()=>resolve(img);
    img.onerror=reject;
    img.src=src;
  });
}
async function loadAssets(){
  try{
    mapImages.village.img=await loadImage("/assets/maps/village.png");
    mapImages.village.loaded=true;
    mapImages.village.width=mapImages.village.img.width;
    mapImages.village.height=mapImages.village.img.height;
    mapImages.beach.img=await loadImage("/assets/maps/beach.png");
    mapImages.beach.loaded=true;
    mapImages.beach.width=mapImages.beach.img.width;
    mapImages.beach.height=mapImages.beach.img.height;
    mapImages.forest.img=await loadImage("/assets/maps/forest.png");
    mapImages.forest.loaded=true;
    mapImages.forest.width=mapImages.forest.img.width;
    mapImages.forest.height=mapImages.forest.img.height;
  }catch(e){console.warn("map load fail",e);}
  try{
    spriteImages.body_idle=await loadImage("/assets/sprites/body_idle.png");
    spritesLoaded=true;
  }catch(e){console.log("no sprite, use circle avatar");}
}

// 로그인
loginBtn.addEventListener("click",()=>{
  const name=loginNameInput.value.trim()||"손님";
  socket.emit("login",name);
});
loginNameInput.addEventListener("keydown",e=>{if(e.key==="Enter")loginBtn.click();});

socket.on("loginSuccess",(data)=>{
  selfId=data.selfId;selfUserId=data.userId;selfName=data.name;
  loginScreen.style.display="none";
  plaza.mapId=data.plaza.mapId;
  plaza.players={};
  (data.plaza.players||[]).forEach(p=>plaza.players[p.id]=p);
  rooms=data.rooms||[];
  renderRoomsList();
  playerInfoEl.textContent=`닉네임: ${selfName} / 내 ID: ${selfUserId}`;
  addPlazaChat("🌈 광장에 입장했습니다.");
});

// 광장 소켓
socket.on("plazaJoin",(p)=>{
  plaza.players[p.id]=p;
  addPlazaChat(`✨ ${p.name} 님이 입장했습니다.`);
});
socket.on("plazaLeave",({id})=>{
  const p=plaza.players[id];
  if(p){addPlazaChat(`👋 ${p.name} 님이 나갔습니다.`);delete plaza.players[id];}
});
socket.on("plazaMove",(p)=>{plaza.players[p.id]=p;});
socket.on("plazaChat",({id,userId,name,text,time})=>{
  const t=new Date(time).toLocaleTimeString("ko-KR",{hour12:false});
  addPlazaChat(`[${t}] ${name}: ${text}`);
  const pl=plaza.players[id];
  if(pl){
    pl.chatBubble={text,expiresAt:Date.now()+4000};
  }
});

// 방/게임 소켓
socket.on("roomList",(list)=>{rooms=list||[];renderRoomsList();});
socket.on("roomJoined",({roomId})=>{
  currentRoomId=roomId;leaveRoomBtn.style.display="inline-flex";
  addRoomLog(`방(${roomId})에 입장했습니다.`);
  switchView("rooms");
});
socket.on("roomState",(room)=>{
  currentRoomState=room;
  roomTitleEl.textContent=`${room.name} (${room.id})`;
  if(room.wordGame){
    roundInfoEl.textContent=`${room.wordGame.round} / ${room.wordGame.maxRounds}`;
    lastWordEl.textContent=room.wordGame.lastWord||"-";
    currentTurnEl.textContent=room.wordGame.currentTurnId?room.wordGame.currentTurnId.slice(0,6):"-";
  }else{
    roundInfoEl.textContent="-";lastWordEl.textContent="-";currentTurnEl.textContent="-";
  }
});
socket.on("roomChat",({roomId,name,text,time})=>{
  if(roomId!==currentRoomId)return;
  const t=new Date(time).toLocaleTimeString("ko-KR",{hour12:false});
  addRoomLog(`[${t}] ${name}: ${text}`);
});
socket.on("wordGameSystem",({roomId,msg})=>{if(roomId===currentRoomId)addRoomLog(msg);});
socket.on("wordGameStarted",({roomId,state})=>{
  if(roomId!==currentRoomId)return;
  currentRoomState=state;addRoomLog("⚡ 끝말잇기가 시작되었습니다.");
});
socket.on("wordSubmitted",({roomId,name,word,gained,totalScore})=>{
  if(roomId!==currentRoomId)return;
  lastWordEl.textContent=word;
  addRoomLog(`${name}: ${word} (+${gained}점, 총 ${totalScore}점)`);
});
socket.on("wordGameTurn",({roomId,state})=>{
  if(roomId!==currentRoomId)return;
  currentRoomState=state;
});
socket.on("wordGameEnded",({roomId,reason,winnerId,scores})=>{
  if(roomId!==currentRoomId)return;
  let msg=`게임 종료 (${reason}). `;
  if(winnerId&&scores){
    msg+=`우승: ${winnerId.slice(0,6)} (${scores[winnerId]}점)`;
  }
  addRoomLog(msg);
});

// 방 UI
function renderRoomsList(){
  roomsListEl.innerHTML="";
  if(!rooms.length){
    const p=document.createElement("p");
    p.textContent="현재 열린 방이 없습니다.";
    p.style.fontSize="12px";p.style.color="#94a3b8";
    roomsListEl.appendChild(p);return;
  }
  rooms.forEach(r=>{
    const btn=document.createElement("button");
    const stateLabel=r.isActive?"게임중":"대기중";
    btn.innerHTML=`${r.name} <span>${r.playerCount}명 · ${stateLabel}</span>`;
    btn.onclick=()=>socket.emit("joinRoom",r.id);
    roomsListEl.appendChild(btn);
  });
}

createRoomBtn.addEventListener("click",()=>{
  const name=roomNameInput.value.trim();
  socket.emit("createRoom",{name});
});
leaveRoomBtn.addEventListener("click",()=>{
  socket.emit("leaveRoom");
  currentRoomId=null;currentRoomState=null;
  roomTitleEl.textContent="입장한 방 없음";
  roundInfoEl.textContent="-";timeLeftEl.textContent="-";
  lastWordEl.textContent="-";currentTurnEl.textContent="-";
  roomLogEl.innerHTML="";leaveRoomBtn.style.display="none";
});
startWordBtn.addEventListener("click",()=>{
  if(!currentRoomId){addRoomLog("방에 입장한 후 시작할 수 있습니다.");return;}
  socket.emit("startWordGame",{roomId:currentRoomId});
});
roomInput.addEventListener("keydown",e=>{
  if(e.key==="Enter"&&!e.shiftKey){
    e.preventDefault();
    const text=roomInput.value.trim();
    if(!text||!currentRoomId)return;
    socket.emit("roomChat",{roomId:currentRoomId,text});
    socket.emit("submitWord",{roomId:currentRoomId,word:text});
    roomInput.value="";
  }
});

plazaInput.addEventListener("keydown",e=>{
  if(e.key==="Enter"&&!e.shiftKey){
    e.preventDefault();
    const text=plazaInput.value.trim();
    if(!text)return;
    socket.emit("plazaChat",text);
    plazaInput.value="";
  }
});

window.addEventListener("keydown",e=>{if(e.key in keys)keys[e.key]=true;});
window.addEventListener("keyup",e=>{if(e.key in keys)keys[e.key]=false;});

// 게임 루프
function update(delta){
  if(!selfId)return;
  const self=plaza.players[selfId];
  if(!self)return;
  let speed=230;let vx=0,vy=0;
  if(keys.ArrowUp){vy=-speed;self.facing="up";}
  if(keys.ArrowDown){vy=speed;self.facing="down";}
  if(keys.ArrowLeft){vx=-speed;self.facing="left";}
  if(keys.ArrowRight){vx=speed;self.facing="right";}
  const dx=vx*delta,dy=vy*delta;
  const mapInfo=mapImages[plaza.mapId]||mapImages.village;
  const mapW=mapInfo.width||WIDTH,mapH=mapInfo.height||HEIGHT;
  self.x=Math.min(Math.max(self.x+dx,0),mapW);
  self.y=Math.min(Math.max(self.y+dy,0),mapH);
  self.state=(Math.abs(vx)>0||Math.abs(vy)>0)?"walk":"idle";
  socket.emit("plazaMove",{x:self.x,y:self.y,facing:self.facing,state:self.state});
}

function drawBackground(){
  ctx.fillStyle="#e0f2fe";ctx.fillRect(0,0,WIDTH,HEIGHT);
  const mapInfo=mapImages[plaza.mapId]||mapImages.village;
  if(!mapInfo.loaded)return{scale:1,offsetX:0,offsetY:0};
  const img=mapInfo.img;
  const mapW=mapInfo.width,mapH=mapInfo.height;
  const scale=Math.min(WIDTH/mapW,HEIGHT/mapH);
  const drawW=mapW*scale,drawH=mapH*scale;
  const offsetX=(WIDTH-drawW)/2,offsetY=(HEIGHT-drawH)/2;
  ctx.drawImage(img,0,0,mapW,mapH,offsetX,offsetY,drawW,drawH);
  return{scale,offsetX,offsetY};
}

CanvasRenderingContext2D.prototype.roundRect=function(x,y,w,h,r){
  if(w<2*r)r=w/2;if(h<2*r)r=h/2;
  this.beginPath();
  this.moveTo(x+r,y);this.arcTo(x+w,y,x+w,y+h,r);
  this.arcTo(x+w,y+h,x,y+h,r);this.arcTo(x,y+h,x,y,r);
  this.arcTo(x,y,x+w,y,r);this.closePath();return this;
};

function drawPlayer(player,tf){
  const {scale,offsetX,offsetY}=tf;
  const px=offsetX+(player.x||0)*scale;
  const py=offsetY+(player.y||0)*scale;

  if(spritesLoaded){
    const fw=SPRITE.frameWidth,fh=SPRITE.frameHeight;
    const s=SPRITE.scale*scale*3;
    const destW=fw*s,destH=fh*s;
    const totalFrames=SPRITE.idleFrames;
    const totalTime=SPRITE.frameDuration*totalFrames;
    const t=animTime%totalTime;
    const frameIndex=Math.floor(t/SPRITE.frameDuration);
    const sx=frameIndex*fw,sy=0;
    const drawX=px-destW/2,drawY=py-destH+20*s;
    ctx.drawImage(spriteImages.body_idle,sx,sy,fw,fh,drawX,drawY,destW,destH);
    ctx.fillStyle="#0f172a";ctx.font="11px sans-serif";
    ctx.fillText(player.name,drawX,drawY-4);
  }else{
    ctx.beginPath();ctx.arc(px,py-6,18,0,Math.PI*2);
    ctx.fillStyle=(player.id===selfId)?"#22c55e":"#fb923c";
    ctx.fill();ctx.lineWidth=2;ctx.strokeStyle="#fff";ctx.stroke();
    ctx.fillStyle="#0f172a";ctx.font="11px sans-serif";
    const text=player.name||"유저";const m=ctx.measureText(text);
    ctx.fillText(text,px-m.width/2,py-28);
  }

  const bubble=player.chatBubble;
  if(bubble&&bubble.expiresAt>Date.now()){
    const msg=bubble.text;
    ctx.font="11px sans-serif";
    const metrics=ctx.measureText(msg);
    const bw=metrics.width+12,bh=24;
    const bx=px-bw/2,by=py-48;
    ctx.fillStyle="rgba(255,255,255,0.96)";
    ctx.strokeStyle="#c4b5fd";ctx.lineWidth=1.5;
    ctx.roundRect(bx,by,bw,bh,8);ctx.fill();ctx.stroke();
    ctx.beginPath();ctx.moveTo(px-4,by+bh);ctx.lineTo(px+4,by+bh);ctx.lineTo(px,by+bh+8);
    ctx.closePath();ctx.fill();ctx.stroke();
    ctx.fillStyle="#0f172a";
    ctx.fillText(msg,px-metrics.width/2,by+bh/2+3);
  }else if(bubble&&bubble.expiresAt<=Date.now()){
    delete player.chatBubble;
  }
}

function renderGameOverlay(){
  if(!currentRoomState||!currentRoomState.wordGame)return;
  const wg=currentRoomState.wordGame;
  if(!wg.isActive)return;

  const panelW=WIDTH*0.5,panelH=70;
  const panelX=(WIDTH-panelW)/2,panelY=40;
  ctx.fillStyle="#facc15";
  ctx.roundRect(panelX,panelY,panelW,panelH,18);ctx.fill();
  ctx.strokeStyle="#f97316";ctx.lineWidth=3;ctx.stroke();
  ctx.fillStyle="#78350f";ctx.font="28px sans-serif";
  const word=wg.lastWord||"시작 대기";
  const m=ctx.measureText(word);
  ctx.fillText(word,panelX+panelW/2-m.width/2,panelY+panelH/2+9);

  const players=currentRoomState.players||[];
  if(!players.length)return;
  const baseY=HEIGHT-120,boardW=120,boardH=70,gap=20;
  const totalWidth=players.length*boardW+(players.length-1)*gap;
  let startX=(WIDTH-totalWidth)/2;
  players.forEach(pid=>{
    const score=(wg.scores&&wg.scores[pid])||0;
    const isSelf=pid===selfId;
    ctx.fillStyle=isSelf?"#bfdbfe":"#fee2e2";
    ctx.roundRect(startX,baseY,boardW,boardH,12);ctx.fill();
    ctx.strokeStyle="#9ca3af";ctx.lineWidth=1.5;ctx.stroke();
    ctx.fillStyle="#111827";ctx.font="12px sans-serif";
    ctx.fillText(pid.slice(0,6),startX+10,baseY+18);
    ctx.fillStyle="#1f2937";ctx.font="18px monospace";
    const sText=score.toString().padStart(3,"0");
    const mm=ctx.measureText(sText);
    ctx.fillText(sText,startX+boardW/2-mm.width/2,baseY+45);
    startX+=boardW+gap;
  });

  if(wg.turnDeadline){
    const msLeft=wg.turnDeadline-Date.now();
    const secLeft=Math.max(0,Math.ceil(msLeft/1000));
    timeLeftEl.textContent=secLeft+"초";
  }else{timeLeftEl.textContent="-";}
  roundInfoEl.textContent=`${wg.round} / ${wg.maxRounds}`;
  currentTurnEl.textContent=wg.currentTurnId?wg.currentTurnId.slice(0,6):"-";
}

function render(){
  ctx.clearRect(0,0,WIDTH,HEIGHT);
  const tf=drawBackground();
  Object.values(plaza.players).forEach(p=>drawPlayer(p,tf));
  renderGameOverlay();
}

function loop(ts){
  if(!lastTimestamp)lastTimestamp=ts;
  const delta=(ts-lastTimestamp)/1000;lastTimestamp=ts;
  animTime+=delta;
  update(delta);render();
  requestAnimationFrame(loop);
}

loadAssets().then(()=>requestAnimationFrame(loop));
