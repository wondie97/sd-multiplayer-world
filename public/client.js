// 클라이언트 상태
const socket = io();

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const WIDTH = canvas.width;
const HEIGHT = canvas.height;

const loginScreen = document.getElementById("login-screen");
const loginNameInput = document.getElementById("login-name");
const loginBtn = document.getElementById("login-btn");

const playerInfoEl = document.getElementById("player-info");
const roomsListEl = document.getElementById("rooms-list");
const roomNameInput = document.getElementById("room-name-input");
const createRoomBtn = document.getElementById("create-room-btn");
const roomTitleEl = document.getElementById("room-title");
const lastWordEl = document.getElementById("last-word");
const currentTurnEl = document.getElementById("current-turn");
const startWordBtn = document.getElementById("start-word-btn");
const leaveRoomBtn = document.getElementById("leave-room-btn");
const roomLogEl = document.getElementById("room-log");
const roomInput = document.getElementById("room-input");
const plazaChatEl = document.getElementById("plaza-chat");
const plazaInput = document.getElementById("plaza-input");

let selfId = null;
let selfUserId = null;
let selfName = null;

let plaza = {
  mapId: "village",
  players: {} // socketId -> player
};
let rooms = [];
let currentRoomId = null;
let currentRoomState = null;

let keys = {
  ArrowUp: false,
  ArrowDown: false,
  ArrowLeft: false,
  ArrowRight: false,
};

// 맵 이미지들
const mapImages = {
  village: { img: new Image(), loaded: false, width: 1200, height: 1200 },
  beach:   { img: new Image(), loaded: false, width: 1200, height: 1200 },
  forest:  { img: new Image(), loaded: false, width: 1200, height: 1200 },
};

// 간단한 스프라이트(있으면 사용, 없으면 원으로 표시)
let spritesLoaded = false;
const spriteImages = {
  body_idle: new Image()
};
const SPRITE = {
  frameWidth: 1200,
  frameHeight: 1200,
  idleFrames: 4,
  frameDuration: 0.18,
  scale: 0.22
};
let animTime = 0;
let lastTimestamp = 0;

function addPlazaChat(msg) {
  const p = document.createElement("p");
  p.textContent = msg;
  plazaChatEl.appendChild(p);
  plazaChatEl.scrollTop = plazaChatEl.scrollHeight;
}
function addRoomLog(msg) {
  const p = document.createElement("p");
  p.textContent = msg;
  roomLogEl.appendChild(p);
  roomLogEl.scrollTop = roomLogEl.scrollHeight;
}

// 이미지 로딩
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

async function loadAssets() {
  try {
    // 맵 로드
    mapImages.village.img = await loadImage("/assets/maps/village.png");
    mapImages.village.loaded = true;
    mapImages.village.width = mapImages.village.img.width;
    mapImages.village.height = mapImages.village.img.height;

    mapImages.beach.img = await loadImage("/assets/maps/beach.png");
    mapImages.beach.loaded = true;
    mapImages.beach.width = mapImages.beach.img.width;
    mapImages.beach.height = mapImages.beach.img.height;

    mapImages.forest.img = await loadImage("/assets/maps/forest.png");
    mapImages.forest.loaded = true;
    mapImages.forest.width = mapImages.forest.img.width;
    mapImages.forest.height = mapImages.forest.img.height;
  } catch (e) {
    console.warn("맵 로딩 실패:", e);
  }

  // 스프라이트(있으면)
  try {
    spriteImages.body_idle = await loadImage("/assets/sprites/body_idle.png");
    spritesLoaded = true;
  } catch (e) {
    console.log("스프라이트가 없어도 원으로 그립니다.");
  }
}

// ==== 로그인 흐름 ====
loginBtn.addEventListener("click", () => {
  const name = loginNameInput.value.trim() || "손님";
  socket.emit("login", name);
});

loginNameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    loginBtn.click();
  }
});

socket.on("loginSuccess", (data) => {
  selfId = data.selfId;
  selfUserId = data.userId;
  selfName = data.name;

  loginScreen.style.display = "none";

  plaza.mapId = data.plaza.mapId;
  plaza.players = {};
  (data.plaza.players || []).forEach((p) => {
    plaza.players[p.id] = p;
  });

  rooms = data.rooms || [];
  renderRoomsList();

  playerInfoEl.textContent = `닉네임: ${selfName} / 내 ID: ${selfUserId}`;

  addPlazaChat("🌈 광장에 입장했습니다.");
});

// ==== 광장 관련 소켓 ====
socket.on("plazaJoin", (player) => {
  plaza.players[player.id] = player;
  addPlazaChat(`✨ ${player.name} 님이 광장에 입장했습니다.`);
});

socket.on("plazaLeave", ({ id }) => {
  const p = plaza.players[id];
  if (p) {
    addPlazaChat(`👋 ${p.name} 님이 나갔습니다.`);
    delete plaza.players[id];
  }
});

socket.on("plazaMove", (player) => {
  plaza.players[player.id] = player;
});

socket.on("plazaChat", ({ id, userId, name, text, time }) => {
  const t = new Date(time).toLocaleTimeString("ko-KR", { hour12: false });
  addPlazaChat(`[${t}] ${name}: ${text}`);
});

// ==== 방/끝말잇기 관련 소켓 ====
socket.on("roomList", (list) => {
  rooms = list || [];
  renderRoomsList();
});

socket.on("roomJoined", ({ roomId }) => {
  currentRoomId = roomId;
  leaveRoomBtn.style.display = "inline-flex";
  addRoomLog(`방(${roomId})에 입장했습니다.`);
});

socket.on("roomState", (room) => {
  currentRoomState = room;
  roomTitleEl.textContent = `${room.name} (${room.id})`;
  lastWordEl.textContent = room.wordGame.lastWord || "-";
  const cid = room.wordGame.currentTurnId;
  currentTurnEl.textContent = cid ? cid.slice(0, 6) : "-";
});

socket.on("roomChat", ({ roomId, id, userId, name, text, time }) => {
  if (roomId !== currentRoomId) return;
  const t = new Date(time).toLocaleTimeString("ko-KR", { hour12: false });
  addRoomLog(`[${t}] ${name}: ${text}`);
});

socket.on("wordGameSystem", ({ roomId, msg }) => {
  if (roomId !== currentRoomId) return;
  addRoomLog(msg);
});

socket.on("wordGameStarted", ({ roomId, currentTurnId }) => {
  if (roomId !== currentRoomId) return;
  addRoomLog("끝말잇기가 시작되었습니다.");
  lastWordEl.textContent = "-";
  currentTurnEl.textContent = currentTurnId ? currentTurnId.slice(0,6) : "-";
});

socket.on("wordSubmitted", ({ roomId, name, word }) => {
  if (roomId !== currentRoomId) return;
  lastWordEl.textContent = word;
  addRoomLog(`${name}: ${word}`);
});

socket.on("wordGameTurn", ({ roomId, currentTurnId }) => {
  if (roomId !== currentRoomId) return;
  currentTurnEl.textContent = currentTurnId ? currentTurnId.slice(0,6) : "-";
});

socket.on("wordGameEnded", ({ roomId, reason }) => {
  if (roomId !== currentRoomId) return;
  addRoomLog(`끝말잇기 종료 (${reason})`);
});

// ==== UI 이벤트 ====
function renderRoomsList() {
  roomsListEl.innerHTML = "";
  if (!rooms.length) {
    const p = document.createElement("p");
    p.textContent = "현재 열린 방이 없습니다.";
    p.style.fontSize = "12px";
    p.style.color = "#94a3b8";
    roomsListEl.appendChild(p);
    return;
  }
  rooms.forEach((r) => {
    const btn = document.createElement("button");
    const stateLabel = r.isActive ? "게임중" : "대기중";
    btn.innerHTML = `${r.name} <span>${r.playerCount}명 · ${stateLabel}</span>`;
    btn.onclick = () => {
      socket.emit("joinRoom", r.id);
    };
    roomsListEl.appendChild(btn);
  });
}

createRoomBtn.addEventListener("click", () => {
  const name = roomNameInput.value.trim();
  socket.emit("createRoom", { name });
});

leaveRoomBtn.addEventListener("click", () => {
  socket.emit("leaveRoom");
  currentRoomId = null;
  currentRoomState = null;
  roomTitleEl.textContent = "입장한 방 없음";
  lastWordEl.textContent = "-";
  currentTurnEl.textContent = "-";
  roomLogEl.innerHTML = "";
  leaveRoomBtn.style.display = "none";
});

startWordBtn.addEventListener("click", () => {
  if (!currentRoomId) {
    addRoomLog("방에 입장한 후 시작할 수 있습니다.");
    return;
  }
  socket.emit("startWordGame", { roomId: currentRoomId });
});

roomInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    const text = roomInput.value.trim();
    if (!text || !currentRoomId) return;
    // 방 채팅과 단어 제출을 같이 처리
    socket.emit("roomChat", { roomId: currentRoomId, text });
    socket.emit("submitWord", { roomId: currentRoomId, word: text });
    roomInput.value = "";
  }
});

plazaInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    const text = plazaInput.value.trim();
    if (!text) return;
    socket.emit("plazaChat", text);
    plazaInput.value = "";
  }
});

window.addEventListener("keydown", (e) => {
  if (e.key in keys) keys[e.key] = true;
});

window.addEventListener("keyup", (e) => {
  if (e.key in keys) keys[e.key] = false;
});

// ==== 게임 루프: 광장 캐릭터 이동 & 그리기 ====
function update(delta) {
  if (!selfId) return; // 아직 로그인 전
  const self = plaza.players[selfId];
  if (!self) return;

  let speed = 220;
  let vx = 0;
  let vy = 0;

  if (keys.ArrowUp) {
    vy = -speed;
    self.facing = "up";
  }
  if (keys.ArrowDown) {
    vy = speed;
    self.facing = "down";
  }
  if (keys.ArrowLeft) {
    vx = -speed;
    self.facing = "left";
  }
  if (keys.ArrowRight) {
    vx = speed;
    self.facing = "right";
  }

  const dx = vx * delta;
  const dy = vy * delta;

  // 맵 크기 기준으로 이동
  const mapInfo = mapImages[plaza.mapId] || mapImages["village"];
  const mapW = mapInfo.width || WIDTH;
  const mapH = mapInfo.height || HEIGHT;

  self.x += dx;
  self.y += dy;
  if (self.x < 0) self.x = 0;
  if (self.y < 0) self.y = 0;
  if (self.x > mapW) self.x = mapW;
  if (self.y > mapH) self.y = mapH;

  self.state = (Math.abs(vx) > 0 || Math.abs(vy) > 0) ? "walk" : "idle";

  socket.emit("plazaMove", {
    x: self.x,
    y: self.y,
    facing: self.facing,
    state: self.state
  });
}

function drawBackground() {
  ctx.fillStyle = "#e0f2fe";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  const mapInfo = mapImages[plaza.mapId] || mapImages["village"];
  if (!mapInfo.loaded) return { scale: 1, offsetX: 0, offsetY: 0 };

  const img = mapInfo.img;
  const mapW = mapInfo.width;
  const mapH = mapInfo.height;

  const scale = Math.min(WIDTH / mapW, HEIGHT / mapH);
  const drawW = mapW * scale;
  const drawH = mapH * scale;
  const offsetX = (WIDTH - drawW) / 2;
  const offsetY = (HEIGHT - drawH) / 2;

  ctx.drawImage(img, 0, 0, mapW, mapH, offsetX, offsetY, drawW, drawH);

  return { scale, offsetX, offsetY };
}

function drawPlayer(player, transform) {
  const { scale, offsetX, offsetY } = transform;
  const worldX = player.x || 0;
  const worldY = player.y || 0;

  const px = offsetX + worldX * scale;
  const py = offsetY + worldY * scale;

  if (spritesLoaded) {
    const fw = SPRITE.frameWidth;
    const fh = SPRITE.frameHeight;
    const s = SPRITE.scale * scale * 3.0;

    const destW = fw * s;
    const destH = fh * s;

    const totalFrames = SPRITE.idleFrames;
    const totalTimePerCycle = SPRITE.frameDuration * totalFrames;
    const t = animTime % totalTimePerCycle;
    const frameIndex = Math.floor(t / SPRITE.frameDuration);
    const sx = frameIndex * fw;
    const sy = 0;

    const drawX = px - destW / 2;
    const drawY = py - destH + 20 * s;

    ctx.drawImage(spriteImages.body_idle, sx, sy, fw, fh, drawX, drawY, destW, destH);

    ctx.fillStyle = "#0f172a";
    ctx.font = "11px sans-serif";
    ctx.fillText(player.name, drawX, drawY - 4);
  } else {
    // 귀여운 동그라미 아바타
    ctx.beginPath();
    ctx.arc(px, py - 8, 18, 0, Math.PI * 2);
    ctx.fillStyle = (player.id === selfId) ? "#38bdf8" : "#fb7185";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "white";
    ctx.stroke();

    ctx.fillStyle = "#0f172a";
    ctx.font = "11px sans-serif";
    const text = player.name || "유저";
    const metrics = ctx.measureText(text);
    ctx.fillText(text, px - metrics.width / 2, py - 28);
  }
}

function render() {
  ctx.clearRect(0, 0, WIDTH, HEIGHT);

  const transform = drawBackground();

  // 플레이어들 그리기
  Object.values(plaza.players).forEach((p) => {
    drawPlayer(p, transform);
  });
}

function loop(timestamp) {
  if (!lastTimestamp) lastTimestamp = timestamp;
  const delta = (timestamp - lastTimestamp) / 1000;
  lastTimestamp = timestamp;
  animTime += delta;

  update(delta);
  render();

  requestAnimationFrame(loop);
}

loadAssets().then(() => {
  requestAnimationFrame(loop);
});
