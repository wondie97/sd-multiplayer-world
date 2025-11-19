
const socket = io();

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const WIDTH = canvas.width;
const HEIGHT = canvas.height;

const statusText = document.getElementById("status-text");
const playerInfoEl = document.getElementById("player-info");
const logEl = document.getElementById("log");
const lastWordEl = document.getElementById("last-word");
const currentTurnEl = document.getElementById("current-turn");
const wordInput = document.getElementById("word-input");
const btnStartWord = document.getElementById("btn-start-word");

let selfId = null;
let players = {};
let keys = {
  ArrowUp: false,
  ArrowDown: false,
  ArrowLeft: false,
  ArrowRight: false,
};

let world = {
  waterArea: { x: 50, y: 280, w: 200, h: 100 },
};

let wordGameState = {
  isActive: false,
  currentTurnId: null,
};

let spritesLoaded = false;

const SPRITE = {
  frameWidth: 1200,   // 시트 프레임 크기 (만든 PNG 기준)
  frameHeight: 1200,
  idleFrames: 4,
  walkFrames: 6,
  scale: 0.2,
  frameDuration: 0.12
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

async function loadSprites() {
  spriteImages.body_idle = await loadImage("/assets/sprites/body_idle.png");
  spriteImages.body_walk = await loadImage("/assets/sprites/body_walk.png");
  spriteImages.hair_idle = await loadImage("/assets/sprites/hair_idle.png");
  spriteImages.hair_walk = await loadImage("/assets/sprites/hair_walk.png");
  spriteImages.outfit_idle = await loadImage("/assets/sprites/outfit_idle.png");
  spriteImages.outfit_walk = await loadImage("/assets/sprites/outfit_walk.png");
  spritesLoaded = true;
  console.log("Sprites loaded");
}

socket.on("init", (data) => {
  selfId = data.selfId;
  players = data.players || {};
  for (const id in players) {
    players[id].animState = "idle";
    players[id].lastX = players[id].x;
    players[id].lastY = players[id].y;
  }
  const selfPlayer = players[selfId];
  if (playerInfoEl && selfPlayer) {
    playerInfoEl.textContent = `내 이름: ${selfPlayer.name} / ID: ${selfId}`;
  }
  addLog("서버에 연결되었습니다.");
  if (statusText) statusText.textContent = "맵에 입장했습니다.";

  if (data.wordGame?.isActive) {
    wordGameState.isActive = true;
    wordGameState.currentTurnId =
      data.wordGame.turnOrder[data.wordGame.currentTurnIndex];
    lastWordEl.textContent = data.wordGame.lastWord || "없음";
  }
});

socket.on("playerJoined", (player) => {
  players[player.id] = {
    ...player,
    animState: "idle",
    lastX: player.x,
    lastY: player.y,
  };
  addLog(`플레이어 입장: ${player.name} (${player.id})`);
});

socket.on("playerMoved", (player) => {
  const prev = players[player.id];
  players[player.id] = {
    ...player,
    lastX: prev ? prev.x : player.x,
    lastY: prev ? prev.y : player.y,
    animState: "idle",
  };
  const dx = Math.abs(player.x - players[player.id].lastX);
  const dy = Math.abs(player.y - players[player.id].lastY);
  if (dx > 0.1 || dy > 0.1) {
    players[player.id].animState = "walk";
  } else {
    players[player.id].animState = "idle";
  }
});

socket.on("playerLeft", (id) => {
  const name = players[id]?.name || id;
  addLog(`플레이어 퇴장: ${name}`);
  delete players[id];
});

socket.on("playerFishing", ({ id }) => {
  if (!players[id]) return;
  players[id].state = "fishing";
  if (id === selfId && statusText) {
    statusText.textContent = "낚시 중... (잠시만)";
  }
});

socket.on("fishingResult", ({ id, success }) => {
  if (!players[id]) return;
  players[id].state = "idle";
  const name = players[id].name || id;
  const msg = success
    ? `${name} 님이 물고기를 잡았습니다! 🎣`
    : `${name} 님이 놓쳤습니다...`;
  addLog(msg);
  if (id === selfId && statusText) {
    statusText.textContent = success ? "낚시 성공!" : "낚시 실패...";
  }
});

socket.on("wordGameStarted", ({ turnOrder, currentTurnId }) => {
  wordGameState.isActive = true;
  wordGameState.currentTurnId = currentTurnId;
  if (lastWordEl) lastWordEl.textContent = "없음";
  if (currentTurnEl)
    currentTurnEl.textContent =
      players[currentTurnId]?.name || currentTurnId || "알 수 없음";
});

socket.on("wordGameSystem", (msg) => {
  addLog(`[끝말잇기] ${msg}`);
});

socket.on("wordSubmitted", ({ id, name, word }) => {
  if (lastWordEl) lastWordEl.textContent = word;
  addLog(`[끝말잇기] ${name}: ${word}`);
});

socket.on("wordGameTurn", ({ currentTurnId }) => {
  wordGameState.currentTurnId = currentTurnId;
  if (currentTurnEl)
    currentTurnEl.textContent =
      players[currentTurnId]?.name || currentTurnId || "알 수 없음";
});

socket.on("wordGameEnded", ({ reason }) => {
  addLog(`[끝말잇기] 게임 종료 (${reason})`);
  wordGameState.isActive = false;
  wordGameState.currentTurnId = null;
  if (currentTurnEl) currentTurnEl.textContent = "없음";
});

window.addEventListener("keydown", (e) => {
  if (e.key in keys) keys[e.key] = true;
  if (e.key === "f" || e.key === "F") tryFishing();
});

window.addEventListener("keyup", (e) => {
  if (e.key in keys) keys[e.key] = false;
});

if (wordInput) {
  wordInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const word = wordInput.value.trim();
      if (word) {
        socket.emit("submitWord", word);
        wordInput.value = "";
      }
    }
  });
}

if (btnStartWord) {
  btnStartWord.addEventListener("click", () => {
    socket.emit("startWordGame");
  });
}

function tryFishing() {
  const p = players[selfId];
  if (!p) return;
  const wa = world.waterArea;
  if (
    p.x + p.w > wa.x &&
    p.x < wa.x + wa.w &&
    p.y + p.h > wa.y &&
    p.y < wa.y + wa.h
  ) {
    socket.emit("startFishing");
  } else {
    if (statusText) statusText.textContent = "물가 근처에서만 낚시할 수 있어요.";
  }
}

function update(delta) {
  const p = players[selfId];
  if (!p) return;

  let speed = 150;
  let vx = 0;
  let vy = 0;

  if (keys.ArrowUp) {
    vy = -speed;
    p.facing = "up";
  }
  if (keys.ArrowDown) {
    vy = speed;
    p.facing = "down";
  }
  if (keys.ArrowLeft) {
    vx = -speed;
    p.facing = "left";
  }
  if (keys.ArrowRight) {
    vx = speed;
    p.facing = "right";
  }

  const dx = vx * delta;
  const dy = vy * delta;
  p.x += dx;
  p.y += dy;

  if (p.x < 0) p.x = 0;
  if (p.y < 0) p.y = 0;
  if (p.x + p.w > WIDTH) p.x = WIDTH - p.w;
  if (p.y + p.h > HEIGHT) p.y = HEIGHT - p.h;

  if (Math.abs(vx) > 0 || Math.abs(vy) > 0) {
    p.animState = "walk";
  } else {
    p.animState = "idle";
  }

  socket.emit("move", {
    x: p.x,
    y: p.y,
    facing: p.facing,
    state: p.state,
  });
}

function drawBackground() {
  ctx.fillStyle = "#1c2433";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  const wa = world.waterArea;
  ctx.fillStyle = "#193a70";
  ctx.fillRect(wa.x, wa.y, wa.w, wa.h);

  ctx.fillStyle = "#4fb3ff";
  ctx.font = "12px sans-serif";
  ctx.fillText("낚시 가능 구역 🎣", wa.x + 10, wa.y + 20);

  ctx.strokeStyle = "rgba(255,255,255,0.04)";
  ctx.lineWidth = 1;
  const grid = 40;
  for (let x = 0; x < WIDTH; x += grid) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, HEIGHT);
    ctx.stroke();
  }
  for (let y = 0; y < HEIGHT; y += grid) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(WIDTH, y);
    ctx.stroke();
  }
}

function drawCharacterSprite(p) {
  const { animState = "idle", facing = "down" } = p;

  const fw = SPRITE.frameWidth;
  const fh = SPRITE.frameHeight;
  const scale = SPRITE.scale;

  const destW = fw * scale;
  const destH = fh * scale;

  const drawX = p.x - destW / 2;
  const drawY = p.y - destH + 20;

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

  const flipX = facing === "left";
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
  ctx.fillText(p.name || p.id, drawX, drawY - 4);

  if (p.state === "fishing") {
    ctx.fillStyle = "#ffd93b";
    ctx.font = "10px sans-serif";
    ctx.fillText("낚시 중...", drawX, drawY + destH + 10);
  }
}

function render() {
  ctx.clearRect(0, 0, WIDTH, HEIGHT);
  drawBackground();

  if (!spritesLoaded) {
    ctx.fillStyle = "#fff";
    ctx.font = "16px sans-serif";
    ctx.fillText("스프라이트 로딩 중...", 20, 40);
    return;
  }

  for (const id in players) {
    drawCharacterSprite(players[id]);
  }
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

loadSprites().then(() => {
  requestAnimationFrame(gameLoop);
});
