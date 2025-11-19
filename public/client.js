const socket = io();

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const WIDTH = canvas.width;
const HEIGHT = canvas.height;

// ---- 상태 ----
let selfId = null;
let selfUserId = null;
let selfName = null;

let plaza = { mapId: "village", players: {} };
let rooms = [];
let currentRoomId = null;
let currentRoomState = null;

let keys = {
  ArrowUp: false,
  ArrowDown: false,
  ArrowLeft: false,
  ArrowRight: false,
};

// 광장 채팅·방 채팅 DOM
const loginScreen = document.getElementById("login-screen");
const loginNameInput = document.getElementById("login-name");
const loginBtn = document.getElementById("login-btn");
const playerInfoEl = document.getElementById("player-info");

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

// 우측 상단 탭
const navButtons = document.querySelectorAll("#top-nav button");
const views = {
  plaza: document.getElementById("view-plaza"),
  rooms: document.getElementById("view-rooms"),
  inventory: document.getElementById("view-inventory"),
  shop: document.getElementById("view-shop"),
};

// 맵 이미지 (광장)
const mapImages = {
  village: { img: new Image(), loaded: false, width: 1200, height: 1200 },
  beach: { img: new Image(), loaded: false, width: 1200, height: 1200 },
  forest: { img: new Image(), loaded: false, width: 1200, height: 1200 },
};

// 방 말풍선 (끄투 캐릭터 위)
const roomBubbles = {}; // socketId -> { text, expiresAt }

// 광장 캐릭터 간단 애니메이션용
let animTime = 0;
let lastTimestamp = 0;

// ---------------- 공통 UI 함수 ----------------
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

function switchView(name) {
  Object.keys(views).forEach((k) =>
    views[k].classList.toggle("active", k === name)
  );
  navButtons.forEach((btn) =>
    btn.classList.toggle("active", btn.dataset.view === name)
  );
}

navButtons.forEach((btn) =>
  btn.addEventListener("click", () => switchView(btn.dataset.view))
);

function isWordGameActive() {
  return (
    currentRoomState &&
    currentRoomState.wordGame &&
    currentRoomState.wordGame.isActive
  );
}

// ---------------- 이미지 로딩 ----------------
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
    mapImages.village.img = await loadImage("/assets/maps/village.png");
    mapImages.village.loaded = true;
    mapImages.village.width = mapImages.village.img.width;
    mapImages.village.height = mapImages.village.img.height;
  } catch (e) {}

  try {
    mapImages.beach.img = await loadImage("/assets/maps/beach.png");
    mapImages.beach.loaded = true;
    mapImages.beach.width = mapImages.beach.img.width;
    mapImages.beach.height = mapImages.beach.img.height;
  } catch (e) {}

  try {
    mapImages.forest.img = await loadImage("/assets/maps/forest.png");
    mapImages.forest.loaded = true;
    mapImages.forest.width = mapImages.forest.img.width;
    mapImages.forest.height = mapImages.forest.img.height;
  } catch (e) {}
}

// ---------------- 로그인 ----------------
loginBtn.addEventListener("click", () => {
  const name = loginNameInput.value.trim() || "손님";
  socket.emit("login", name);
});
loginNameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") loginBtn.click();
});

socket.on("loginSuccess", (data) => {
  selfId = data.selfId;
  selfUserId = data.userId;
  selfName = data.name;

  loginScreen.style.display = "none";

  plaza.mapId = data.plaza.mapId;
  plaza.players = {};
  (data.plaza.players || []).forEach((p) => (plaza.players[p.id] = p));
  rooms = data.rooms || [];
  renderRoomsList();

  playerInfoEl.textContent = `닉네임: ${selfName} / ID: ${selfUserId}`;
  addPlazaChat("🌈 광장에 입장했습니다.");
});

// ---------------- 광장 소켓 ----------------
socket.on("plazaJoin", (p) => {
  plaza.players[p.id] = p;
  addPlazaChat(`✨ ${p.name} 님이 입장했습니다.`);
});

socket.on("plazaLeave", ({ id }) => {
  const p = plaza.players[id];
  if (p) {
    addPlazaChat(`👋 ${p.name} 님이 나갔습니다.`);
    delete plaza.players[id];
  }
});

socket.on("plazaMove", (p) => {
  plaza.players[p.id] = p;
});

socket.on("plazaChat", ({ id, name, text, time }) => {
  const t = new Date(time).toLocaleTimeString("ko-KR", { hour12: false });
  addPlazaChat(`[${t}] ${name}: ${text}`);

  const pl = plaza.players[id];
  if (pl) {
    pl.chatBubble = { text, expiresAt: Date.now() + 4000 };
  }
});

// ---------------- 방 / 끝말잇기 소켓 ----------------
socket.on("roomList", (list) => {
  rooms = list || [];
  renderRoomsList();
});

socket.on("roomJoined", ({ roomId }) => {
  currentRoomId = roomId;
  leaveRoomBtn.style.display = "inline-flex";
  addRoomLog(`방(${roomId})에 입장했습니다.`);
  switchView("rooms");
});

socket.on("roomState", (room) => {
  currentRoomState = room;
  roomTitleEl.textContent = `${room.name} (${room.id})`;

  const wg = room.wordGame;
  if (wg) {
    roundInfoEl.textContent = `${wg.round} / ${wg.maxRounds}`;
    lastWordEl.textContent = wg.lastWord || "-";
    currentTurnEl.textContent = wg.currentTurnId
      ? wg.currentTurnId.slice(0, 6)
      : "-";
  } else {
    roundInfoEl.textContent = "-";
    lastWordEl.textContent = "-";
    currentTurnEl.textContent = "-";
  }
});

socket.on("roomChat", ({ roomId, id, name, text, time }) => {
  if (roomId !== currentRoomId) return;
  const t = new Date(time).toLocaleTimeString("ko-KR", { hour12: false });
  addRoomLog(`[${t}] ${name}: ${text}`);

  // 방 안 캐릭터 말풍선
  roomBubbles[id] = { text, expiresAt: Date.now() + 3500 };
});

socket.on("wordGameSystem", ({ roomId, msg }) => {
  if (roomId === currentRoomId) addRoomLog(msg);
});

socket.on("wordGameStarted", ({ roomId, state }) => {
  if (roomId !== currentRoomId) return;
  currentRoomState = state;
  addRoomLog("⚡ 끝말잇기가 시작되었습니다.");
});

socket.on("wordSubmitted", ({ roomId, id, name, word, gained, totalScore }) => {
  if (roomId !== currentRoomId) return;
  lastWordEl.textContent = word;
  addRoomLog(`${name}: ${word} (+${gained}점, 총 ${totalScore}점)`);

  // 제시어도 말풍선처럼 띄워줌
  roomBubbles[id] = { text: word, expiresAt: Date.now() + 3500 };
});

socket.on("wordGameTurn", ({ roomId, state }) => {
  if (roomId !== currentRoomId) return;
  currentRoomState = state;
});

socket.on("wordGameEnded", ({ roomId, reason, winnerId, scores }) => {
  if (roomId !== currentRoomId) return;
  let msg = `게임 종료 (${reason}). `;
  if (winnerId && scores) {
    msg += `우승: ${winnerId.slice(0, 6)} (${scores[winnerId]}점)`;
  }
  addRoomLog(msg);
});

// ---------------- 방 UI 동작 ----------------
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
    btn.onclick = () => socket.emit("joinRoom", r.id);
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
  roundInfoEl.textContent = "-";
  timeLeftEl.textContent = "-";
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

// 방 텍스트 입력: 방 채팅 + 단어 제출을 같이 처리
roomInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    const text = roomInput.value.trim();
    if (!text || !currentRoomId) return;

    socket.emit("roomChat", { roomId: currentRoomId, text });
    socket.emit("submitWord", { roomId: currentRoomId, word: text });

    roomInput.value = "";
  }
});

// 광장 채팅
plazaInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    const text = plazaInput.value.trim();
    if (!text) return;
    socket.emit("plazaChat", text);
    plazaInput.value = "";
  }
});

// ---------------- 키 입력 ----------------
window.addEventListener("keydown", (e) => {
  if (e.key in keys) keys[e.key] = true;
});
window.addEventListener("keyup", (e) => {
  if (e.key in keys) keys[e.key] = false;
});

// ---------------- 캔버스 그리기 ----------------
CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
  if (w < 2 * r) r = w / 2;
  if (h < 2 * r) r = h / 2;
  this.beginPath();
  this.moveTo(x + r, y);
  this.arcTo(x + w, y, x + w, y + h, r);
  this.arcTo(x + w, y + h, x, y + h, r);
  this.arcTo(x, y + h, x, y, r);
  this.arcTo(x, y, x + w, y, r);
  this.closePath();
  return this;
};

function drawPlazaBackground() {
  ctx.fillStyle = "#e0f2fe";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  const mapInfo = mapImages[plaza.mapId] || mapImages.village;
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

function drawPlazaPlayer(p, tf) {
  const { scale, offsetX, offsetY } = tf;
  const px = offsetX + (p.x || 0) * scale;
  const py = offsetY + (p.y || 0) * scale;

  // 동그란 캐릭터
  ctx.beginPath();
  ctx.arc(px, py - 6, 18, 0, Math.PI * 2);
  ctx.fillStyle = p.id === selfId ? "#22c55e" : "#fb923c";
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#fff";
  ctx.stroke();

  ctx.fillStyle = "#0f172a";
  ctx.font = "11px sans-serif";
  const text = p.name || "유저";
  const m = ctx.measureText(text);
  ctx.fillText(text, px - m.width / 2, py - 28);

  // 광장 말풍선
  const bubble = p.chatBubble;
  if (bubble && bubble.expiresAt > Date.now()) {
    const msg = bubble.text;
    ctx.font = "11px sans-serif";
    const metrics = ctx.measureText(msg);
    const bw = metrics.width + 12;
    const bh = 24;
    const bx = px - bw / 2;
    const by = py - 48;

    ctx.fillStyle = "rgba(255,255,255,0.96)";
    ctx.strokeStyle = "#c4b5fd";
    ctx.lineWidth = 1.5;
    ctx.roundRect(bx, by, bw, bh, 8);
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(px - 4, by + bh);
    ctx.lineTo(px + 4, by + bh);
    ctx.lineTo(px, by + bh + 8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#0f172a";
    ctx.fillText(msg, px - metrics.width / 2, by + bh / 2 + 3);
  } else if (bubble && bubble.expiresAt <= Date.now()) {
    delete p.chatBubble;
  }
}

function drawGameBackground() {
  // 연한 초록 체크 무늬
  const cellSize = 80;
  for (let y = 0; y < HEIGHT + cellSize; y += cellSize) {
    for (let x = 0; x < WIDTH + cellSize; x += cellSize) {
      const even = ((x + y) / cellSize) % 2 === 0;
      ctx.fillStyle = even ? "#e9fcd4" : "#d7f2b2";
      ctx.fillRect(x, y, cellSize, cellSize);
    }
  }

  // 상단 검은 바
  ctx.fillStyle = "#111827";
  ctx.fillRect(0, 0, WIDTH, 40);
  ctx.fillStyle = "#e5e7eb";
  ctx.font = "13px sans-serif";
  ctx.fillText("한국어 끝말잇기", 16, 24);
}

// 끄투 스타일 오버레이
function renderGameOverlay() {
  const room = currentRoomState;
  if (!room || !room.wordGame || !room.wordGame.isActive) return;
  const wg = room.wordGame;

  // 가운데 제시어 전광판
  const panelW = WIDTH * 0.55;
  const panelH = 90;
  const panelX = (WIDTH - panelW) / 2;
  const panelY = 80;
  ctx.fillStyle = "#8b5a2b";
  ctx.roundRect(panelX, panelY, panelW, panelH, 24);
  ctx.fill();

  const inner = 6;
  ctx.fillStyle = "#f5deb3";
  ctx.roundRect(
    panelX + inner,
    panelY + inner,
    panelW - inner * 2,
    panelH - inner * 2,
    18
  );
  ctx.fill();

  const word = wg.lastWord || "시작 대기";
  ctx.fillStyle = "#111827";
  ctx.font = "40px sans-serif";
  const m = ctx.measureText(word);
  ctx.fillText(word, panelX + panelW / 2 - m.width / 2, panelY + panelH / 2 + 14);

  // HUD: 라운드 / 시간 / 현재 차례
  const now = Date.now();
  let secLeft = "-";
  if (wg.turnDeadline) {
    const msLeft = wg.turnDeadline - now;
    const s = Math.max(0, Math.ceil(msLeft / 1000));
    secLeft = s.toString();
  }
  timeLeftEl.textContent = secLeft === "-" ? "-" : secLeft + "초";
  roundInfoEl.textContent = `${wg.round} / ${wg.maxRounds}`;
  lastWordEl.textContent = wg.lastWord || "-";
  const turnId = wg.currentTurnId;
  const turnLabel = turnId ? turnId.slice(0, 6) : "-";
  currentTurnEl.textContent = turnLabel;

  ctx.fillStyle = "#e5e7eb";
  ctx.font = "14px sans-serif";
  ctx.fillText(`라운드 ${wg.round} / ${wg.maxRounds}`, 160, 26);
  ctx.fillText(
    `남은 시간 ${secLeft === "-" ? "-" : secLeft + "초"}`,
    350,
    26
  );
  ctx.fillText(`현재 차례 ${turnLabel}`, 580, 26);

  // 참가자 석: 캐릭터 + 점수판
  const playerIds = room.players || [];
  if (!playerIds.length) return;

  const baseY = HEIGHT - 140;
  const pedestalW = 160;
  const avatarR = 30;
  const gap = 30;
  const totalWidth = playerIds.length * pedestalW + (playerIds.length - 1) * gap;
  let startX = (WIDTH - totalWidth) / 2;

  playerIds.forEach((pid) => {
    const score = (wg.scores && wg.scores[pid]) || 0;
    const isSelf = pid === selfId;
    const isTurn = pid === wg.currentTurnId;

    const centerX = startX + pedestalW / 2;
    const pedestalY = baseY + avatarR;

    // 발판 (타원형)
    ctx.fillStyle = "#e5e7eb";
    ctx.beginPath();
    ctx.ellipse(centerX, pedestalY + 20, pedestalW * 0.46, 18, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#f9fafb";
    ctx.beginPath();
    ctx.ellipse(centerX, pedestalY + 12, pedestalW * 0.46, 16, 0, 0, Math.PI * 2);
    ctx.fill();

    // 캐릭터 (노란 찐빵 스타일)
    ctx.beginPath();
    ctx.arc(centerX, pedestalY - 5, avatarR, 0, Math.PI * 2);
    ctx.fillStyle = isSelf ? "#facc15" : "#fde68a";
    ctx.fill();
    ctx.lineWidth = isTurn ? 4 : 3;
    ctx.strokeStyle = isTurn ? "#4ade80" : "#f59e0b";
    ctx.stroke();

    // 눈, 입
    ctx.fillStyle = "#111827";
    ctx.beginPath();
    ctx.arc(centerX - 10, pedestalY - 8, 3, 0, Math.PI * 2);
    ctx.arc(centerX + 10, pedestalY - 8, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(centerX, pedestalY + 2, 8, 0, Math.PI);
    ctx.stroke();

    // 점수판 박스
    const boardY = pedestalY + 38;
    ctx.fillStyle = "#ffffff";
    ctx.roundRect(startX, boardY, pedestalW, 64, 14);
    ctx.fill();
    ctx.strokeStyle = "#d1d5db";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = "#4b5563";
    ctx.font = "12px sans-serif";
    ctx.fillText(pid.slice(0, 6), startX + 10, boardY + 20);

    ctx.fillStyle = "#111827";
    ctx.font = "22px monospace";
    const sText = score.toString().padStart(3, "0");
    const sm = ctx.measureText(sText);
    ctx.fillText(sText, centerX - sm.width / 2, boardY + 48);

    // 방 캐릭터 말풍선
    const bubble = roomBubbles[pid];
    if (bubble && bubble.expiresAt > now) {
      const msg = bubble.text;
      ctx.font = "12px sans-serif";
      const bm = ctx.measureText(msg);
      const bw = bm.width + 14;
      const bh = 26;
      const bx = centerX - bw / 2;
      const by = pedestalY - avatarR - 40;

      ctx.fillStyle = "rgba(255,255,255,0.96)";
      ctx.strokeStyle = "#a5b4fc";
      ctx.lineWidth = 1.5;
      ctx.roundRect(bx, by, bw, bh, 10);
      ctx.fill();
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(centerX - 5, by + bh);
      ctx.lineTo(centerX + 5, by + bh);
      ctx.lineTo(centerX, by + bh + 8);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = "#111827";
      ctx.fillText(msg, centerX - bm.width / 2, by + bh / 2 + 4);
    } else if (bubble && bubble.expiresAt <= now) {
      delete roomBubbles[pid];
    }

    startX += pedestalW + gap;
  });
}

// ---------------- 업데이트 & 루프 ----------------
function update(delta) {
  if (!selfId) return;
  if (isWordGameActive()) return; // 게임 중엔 광장 이동 멈춤

  const self = plaza.players[selfId];
  if (!self) return;

  const speed = 230;
  let vx = 0,
    vy = 0;
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

  const mapInfo = mapImages[plaza.mapId] || mapImages.village;
  const mapW = mapInfo.width || WIDTH;
  const mapH = mapInfo.height || HEIGHT;

  self.x = Math.min(Math.max(self.x + dx, 0), mapW);
  self.y = Math.min(Math.max(self.y + dy, 0), mapH);
  self.state = Math.abs(vx) + Math.abs(vy) > 0 ? "walk" : "idle";

  socket.emit("plazaMove", {
    x: self.x,
    y: self.y,
    facing: self.facing,
    state: self.state,
  });
}

function render() {
  ctx.clearRect(0, 0, WIDTH, HEIGHT);

  if (isWordGameActive()) {
    drawGameBackground();
    renderGameOverlay();
  } else {
    const tf = drawPlazaBackground();
    Object.values(plaza.players).forEach((p) => drawPlazaPlayer(p, tf));
  }
}

function loop(ts) {
  if (!lastTimestamp) lastTimestamp = ts;
  const delta = (ts - lastTimestamp) / 1000;
  lastTimestamp = ts;
  animTime += delta;

  update(delta);
  render();
  requestAnimationFrame(loop);
}

// 시작
loadAssets().then(() => requestAnimationFrame(loop));
