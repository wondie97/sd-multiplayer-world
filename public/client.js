const socket = io();

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const WIDTH = canvas.width;
const HEIGHT = canvas.height;

const playerNameEl = document.getElementById("player-name");
const roomsListEl = document.getElementById("rooms-list");
const roomNameInput = document.getElementById("room-name-input");
const roomMapSelect = document.getElementById("room-map-select");
const createRoomBtn = document.getElementById("create-room-btn");
const roomTitleEl = document.getElementById("room-title");
const roomPlayersEl = document.getElementById("room-players");
const leaveRoomBtn = document.getElementById("leave-room-btn");
const startWordBtn = document.getElementById("start-word-btn");
const lastWordEl = document.getElementById("last-word");
const currentTurnEl = document.getElementById("current-turn");
const chatMessagesEl = document.getElementById("chat-messages");
const chatInput = document.getElementById("chat-input");
const wordInput = document.getElementById("word-input");
const logEl = document.getElementById("log");

let selfId = null;
let selfName = null;

let lobbyRooms = [];
let uiState = "lobby";  // "lobby" | "room"
let currentRoomId = null;
let currentRoom = null;

let keys = {
  ArrowUp: false,
  ArrowDown: false,
  ArrowLeft: false,
  ArrowRight: false,
};

// 맵 이미지
const mapImages = {
  village: { img: new Image(), loaded: false, width: 1200, height: 1200 },
  beach:   { img: new Image(), loaded: false, width: 1200, height: 1200 },
  forest:  { img: new Image(), loaded: false, width: 1200, height: 1200 },
};

// 캐릭터 스프라이트
let spritesLoaded = false;
const SPRITE = {
  frameWidth: 1200,
  frameHeight: 1200,
  idleFrames: 4,
  walkFrames: 6,
  scale: 0.22,
  frameDuration: 0.12,
};
let animTime = 0;
let lastTime = 0;

const spriteImages = {
  body_idle: new Image(),
  body_walk: new Image(),
  hair_idle: new Image(),
  hair_walk: new Image(),
  outfit_idle: new Image(),
  outfit_walk: new Image(),
};

function addLog(msg) {
  if (!logEl) return;
  const p = document.createElement("p");
  p.textContent = msg;
  logEl.appendChild(p);
  logEl.scrollTop = logEl.scrollHeight;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

async function loadSpritesAndMaps() {
  // 스프라이트
  spriteImages.body_idle = await loadImage("/assets/sprites/body_idle.png");
  spriteImages.body_walk = await loadImage("/assets/sprites/body_walk.png");
  spriteImages.hair_idle = await loadImage("/assets/sprites/hair_idle.png");
  spriteImages.hair_walk = await loadImage("/assets/sprites/hair_walk.png");
  spriteImages.outfit_idle = await loadImage("/assets/sprites/outfit_idle.png");
  spriteImages.outfit_walk = await loadImage("/assets/sprites/outfit_walk.png");
  spritesLoaded = true;

  // 맵
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
}

// ==== socket.io: 로비/방 ====
socket.on("lobbyInit", (data) => {
  selfId = data.selfId;
  selfName = data.name;
  lobbyRooms = data.rooms || [];
  renderRoomsList();

  if (playerNameEl) {
    playerNameEl.textContent = `내 이름: ${selfName} (ID: ${selfId.slice(0,6)})`;
  }
});

socket.on("roomList", (rooms) => {
  lobbyRooms = rooms || [];
  renderRoomsList();
});

socket.on("roomJoined", ({ roomId }) => {
  uiState = "room";
  currentRoomId = roomId;
  addLog(`방(${roomId})에 입장했습니다.`);
  leaveRoomBtn.style.display = "inline-flex";
});

socket.on("roomState", (room) => {
  // room: { id, name, mapId, players[], wordGame }
  currentRoom = room;
  if (room.id === currentRoomId) {
    uiState = "room";
  }

  roomTitleEl.textContent = `${room.name} (${room.mapId})`;
  roomPlayersEl.textContent = `플레이어: ${room.players.length}명`;

  lastWordEl.textContent = room.wordGame.lastWord || "-";
  const ct = room.wordGame.currentTurnId;
  currentTurnEl.textContent = ct ? (findPlayerName(ct) || ct.slice(0,6)) : "-";
});

socket.on("playerMovedInRoom", ({ roomId, player }) => {
  if (!currentRoom || roomId !== currentRoom.id) return;
  const idx = currentRoom.players.findIndex((p) => p.id === player.id);
  if (idx >= 0) {
    currentRoom.players[idx] = player;
  } else {
    currentRoom.players.push(player);
  }
});

socket.on("chatRoom", ({ roomId, id, name, text, time }) => {
  if (!currentRoom || roomId !== currentRoom.id) return;
  const p = document.createElement("p");
  const t = new Date(time).toLocaleTimeString("ko-KR", { hour12: false });
  p.textContent = `[${t}] ${name}: ${text}`;
  chatMessagesEl.appendChild(p);
  chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
});

socket.on("wordGameSystem", ({ roomId, msg }) => {
  if (!currentRoom || roomId !== currentRoom.id) return;
  addLog(msg);
});

socket.on("wordGameStarted", ({ roomId, turnOrder, currentTurnId }) => {
  if (!currentRoom || roomId !== currentRoom.id) return;
  addLog("끝말잇기가 시작되었습니다.");
  lastWordEl.textContent = "-";
  currentTurnEl.textContent = findPlayerName(currentTurnId) || currentTurnId.slice(0,6);
});

socket.on("wordSubmitted", ({ roomId, id, name, word }) => {
  if (!currentRoom || roomId !== currentRoom.id) return;
  lastWordEl.textContent = word;
  addLog(`${name}: ${word}`);
});

socket.on("wordGameTurn", ({ roomId, currentTurnId }) => {
  if (!currentRoom || roomId !== currentRoom.id) return;
  currentTurnEl.textContent = findPlayerName(currentTurnId) || currentTurnId.slice(0,6);
});

socket.on("wordGameEnded", ({ roomId, reason }) => {
  if (!currentRoom || roomId !== currentRoom.id) return;
  addLog(`끝말잇기 종료 (${reason})`);
});

// ==== 로비 UI ====
function renderRoomsList() {
  if (!roomsListEl) return;
  roomsListEl.innerHTML = "";
  if (!lobbyRooms.length) {
    const p = document.createElement("p");
    p.textContent = "현재 열린 방이 없습니다.";
    p.style.fontSize = "12px";
    p.style.color = "#a3a8c7";
    roomsListEl.appendChild(p);
    return;
  }
  lobbyRooms.forEach((r) => {
    const btn = document.createElement("button");
    const stateLabel = r.isActive ? "게임중" : "대기중";
    btn.innerHTML = `
      [${r.mapId}] ${r.name}
      <span>${r.playerCount}명 · ${stateLabel}</span>
    `;
    btn.onclick = () => {
      socket.emit("joinRoom", r.id);
    };
    roomsListEl.appendChild(btn);
  });
}

// ==== 입력 ====
createRoomBtn.addEventListener("click", () => {
  const name = roomNameInput.value.trim();
  const mapId = roomMapSelect.value;
  socket.emit("createRoom", { name, mapId });
});

leaveRoomBtn.addEventListener("click", () => {
  socket.emit("leaveRoom");
  uiState = "lobby";
  currentRoomId = null;
  currentRoom = null;
  roomTitleEl.textContent = "방에 입장하지 않았습니다";
  roomPlayersEl.textContent = "";
  lastWordEl.textContent = "-";
  currentTurnEl.textContent = "-";
  leaveRoomBtn.style.display = "none";
});

window.addEventListener("keydown", (e) => {
  if (e.key in keys) keys[e.key] = true;
});

window.addEventListener("keyup", (e) => {
  if (e.key in keys) keys[e.key] = false;
});

chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    const text = chatInput.value.trim();
    if (text && currentRoomId) {
      socket.emit("chatRoom", { roomId: currentRoomId, text });
      chatInput.value = "";
    }
  }
});

wordInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    const word = wordInput.value.trim();
    if (word && currentRoomId) {
      socket.emit("submitWord", { roomId: currentRoomId, word });
      wordInput.value = "";
    }
  }
});

startWordBtn.addEventListener("click", () => {
  if (!currentRoomId) {
    addLog("방에 들어간 후에 시작하세요.");
    return;
  }
  socket.emit("startWordGame", { roomId: currentRoomId });
});

// ==== 게임 로직 ====
function findPlayerName(id) {
  if (!currentRoom) return null;
  const p = currentRoom.players.find((pl) => pl.id === id);
  return p ? p.name : null;
}

function update(delta) {
  if (uiState !== "room" || !currentRoom) return;

  const self = currentRoom.players.find((p) => p.id === selfId);
  if (!self) return;

  let speed = 200;
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

  const mapInfo = mapImages[currentRoom.mapId] || mapImages["village"];
  const mapW = mapInfo.width;
  const mapH = mapInfo.height;

  self.x += dx;
  self.y += dy;

  if (self.x < 0) self.x = 0;
  if (self.y < 0) self.y = 0;
  if (self.x > mapW) self.x = mapW;
  if (self.y > mapH) self.y = mapH;

  if (Math.abs(vx) > 0 || Math.abs(vy) > 0) {
    self.state = "walk";
  } else {
    self.state = "idle";
  }

  socket.emit("moveInRoom", {
    roomId: currentRoomId,
    x: self.x,
    y: self.y,
    facing: self.facing,
    state: self.state,
  });
}

function drawBackground() {
  ctx.fillStyle = "#1c2433";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  if (!currentRoom) return;

  const mapInfo = mapImages[currentRoom.mapId] || mapImages["village"];
  if (!mapInfo.loaded) return;

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

function drawCharacterSprite(p, transform) {
  if (!spritesLoaded) return;

  const { scale, offsetX, offsetY } = transform;

  const fw = SPRITE.frameWidth;
  const fh = SPRITE.frameHeight;
  const s = SPRITE.scale * scale * 3.0; // 맵 스케일에 비례하도록 조정

  const destW = fw * s;
  const destH = fh * s;

  const worldX = p.x;
  const worldY = p.y;

  const drawX = offsetX + worldX * scale - destW / 2;
  const drawY = offsetY + worldY * scale - destH + 20 * s;

  const animState = p.state === "walk" ? "walk" : "idle";

  const frameCount =
    animState === "walk" ? SPRITE.walkFrames : SPRITE.idleFrames;
  const sheetBody =
    animState === "walk" ? spriteImages.body_walk : spriteImages.body_idle;
  const sheetHair =
    animState === "walk" ? spriteImages.hair_walk : spriteImages.hair_idle;
  const sheetOutfit =
    animState === "walk" ? spriteImages.outfit_walk : spriteImages.outfit_idle;

  const totalTimePerCycle = SPRITE.frameDuration * frameCount;
  const t = animTime % totalTimePerCycle;
  const frameIndex = Math.floor(t / SPRITE.frameDuration);
  const sx = frameIndex * fw;
  const sy = 0;

  const flipX = p.facing === "left";
  ctx.save();
  if (flipX) {
    ctx.translate(drawX + destW / 2, 0);
    ctx.scale(-1, 1);
    ctx.translate(-drawX - destW / 2, 0);
  }

  if (sheetBody && sheetBody.complete) {
    ctx.drawImage(sheetBody, sx, sy, fw, fh, drawX, drawY, destW, destH);
  }
  if (sheetOutfit && sheetOutfit.complete) {
    ctx.drawImage(sheetOutfit, sx, sy, fw, fh, drawX, drawY, destW, destH);
  }
  if (sheetHair && sheetHair.complete) {
    ctx.drawImage(sheetHair, sx, sy, fw, fh, drawX, drawY, destW, destH);
  }

  ctx.restore();

  ctx.fillStyle = "#ffffff";
  ctx.font = "11px sans-serif";
  ctx.fillText(p.name, drawX, drawY - 4);
}

function render() {
  ctx.clearRect(0, 0, WIDTH, HEIGHT);

  if (uiState !== "room" || !currentRoom) {
    ctx.fillStyle = "#151826";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.fillStyle = "#9aa1d1";
    ctx.font = "16px sans-serif";
    ctx.fillText("로비 상태입니다. 오른쪽에서 방에 입장하세요.", 40, HEIGHT / 2);
    return;
  }

  const transform = drawBackground();
  if (!transform) return;

  if (!currentRoom.players) return;
  currentRoom.players.forEach((p) => {
    drawCharacterSprite(p, transform);
  });
}

function gameLoop(timestamp) {
  if (!lastTime) lastTime = timestamp;
  const delta = (timestamp - lastTime) / 1000;
  lastTime = timestamp;

  animTime += delta;
  update(delta);
  render();

  requestAnimationFrame(gameLoop);
}

loadSpritesAndMaps().then(() => {
  requestAnimationFrame(gameLoop);
});