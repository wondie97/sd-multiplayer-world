const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

// 광장(플라자) 기본 상태
const plaza = {
  mapId: "village",
  players: {} // socketId -> {id,userId,name,x,y,facing,state}
};

// 방 목록
const rooms = {}; // roomId -> { id,name,players:{socketId:true},wordGame:{...} }

function makeUserId() {
  return "U" + Math.random().toString(36).slice(2, 7).toUpperCase();
}

function serializePlaza() {
  return {
    mapId: plaza.mapId,
    players: Object.values(plaza.players)
  };
}

function serializeRooms() {
  return Object.values(rooms).map(r => ({
    id: r.id,
    name: r.name,
    playerCount: Object.keys(r.players).length,
    isActive: r.wordGame.isActive
  }));
}

function serializeRoom(room) {
  const wg = room.wordGame;
  return {
    id: room.id,
    name: room.name,
    players: Object.keys(room.players),
    wordGame: {
      isActive: wg.isActive,
      currentTurnId: wg.turnOrder[wg.currentTurnIndex] || null,
      lastWord: wg.lastWord,
      usedCount: wg.usedWords.length,
      scores: wg.scores,
      round: wg.round,
      maxRounds: wg.maxRounds,
      turnDeadline: wg.turnDeadline
    }
  };
}

// 임시 한국어 단어 검증 (2글자 이상, 한글만)
function isValidKoreanWord(word) {
  return /^[가-힣]{2,}$/.test(word);
}

io.on("connection", (socket) => {
  console.log("connected:", socket.id);
  socket.data.user = null;
  socket.data.roomId = null;

  // 로그인
  socket.on("login", (nameRaw) => {
    if (socket.data.user) return;
    let name = (nameRaw || "").toString().trim();
    if (!name) name = "손님";
    const userId = makeUserId();

    socket.data.user = { socketId: socket.id, userId, name };

    plaza.players[socket.id] = {
      id: socket.id,
      userId,
      name,
      x: 600,
      y: 600,
      facing: "down",
      state: "idle"
    };
    socket.join("plaza");

    socket.emit("loginSuccess", {
      selfId: socket.id,
      userId,
      name,
      plaza: serializePlaza(),
      rooms: serializeRooms()
    });

    socket.to("plaza").emit("plazaJoin", plaza.players[socket.id]);
  });

  // 광장 이동
  socket.on("plazaMove", ({ x, y, facing, state }) => {
    const p = plaza.players[socket.id];
    if (!p) return;
    if (typeof x === "number") p.x = x;
    if (typeof y === "number") p.y = y;
    if (typeof facing === "string") p.facing = facing;
    if (state) p.state = state;
    io.to("plaza").emit("plazaMove", p);
  });

  // 광장 채팅
  socket.on("plazaChat", (text) => {
    const user = socket.data.user;
    if (!user) return;
    const msg = (text || "").toString().trim();
    if (!msg) return;
    io.to("plaza").emit("plazaChat", {
      id: socket.id,
      userId: user.userId,
      name: user.name,
      text: msg,
      time: Date.now()
    });
  });

  // 방 만들기
  socket.on("createRoom", ({ name }) => {
    const user = socket.data.user;
    if (!user) return;
    const roomId = "room_" + Math.random().toString(36).slice(2, 8);
    const room = {
      id: roomId,
      name: (name && name.trim()) ? name.trim() : "무제 방",
      players: {},
      wordGame: {
        isActive: false,
        turnOrder: [],
        currentTurnIndex: 0,
        lastWord: null,
        usedWords: [],
        scores: {},
        round: 0,
        maxRounds: 3,
        turnDeadline: null
      }
    };
    rooms[roomId] = room;
    joinRoom(socket, roomId);
    io.emit("roomList", serializeRooms());
  });

  // 방 입장 / 나가기
  socket.on("joinRoom", (roomId) => {
    const user = socket.data.user;
    if (!user) return;
    joinRoom(socket, roomId);
    io.emit("roomList", serializeRooms());
  });

  socket.on("leaveRoom", () => {
    leaveCurrentRoom(socket);
    io.emit("roomList", serializeRooms());
  });

  // 방 채팅
  socket.on("roomChat", ({ roomId, text }) => {
    const user = socket.data.user;
    if (!user) return;
    const room = rooms[roomId];
    if (!room) return;
    if (!room.players[socket.id]) return;
    const msg = (text || "").toString().trim();
    if (!msg) return;

    io.to(roomId).emit("roomChat", {
      roomId,
      id: socket.id,
      userId: user.userId,
      name: user.name,
      text: msg,
      time: Date.now()
    });
  });

  // 끝말잇기 시작
  socket.on("startWordGame", ({ roomId }) => {
    const room = rooms[roomId];
    const user = socket.data.user;
    if (!room || !user) return;
    if (!room.players[socket.id]) return;

    const game = room.wordGame;
    const ids = Object.keys(room.players);
    if (game.isActive) {
      socket.emit("wordGameSystem", { roomId, msg: "이미 진행 중입니다." });
      return;
    }
    if (ids.length < 2) {
      socket.emit("wordGameSystem", { roomId, msg: "2명 이상 필요합니다." });
      return;
    }

    game.isActive = true;
    game.turnOrder = ids;
    game.currentTurnIndex = 0;
    game.lastWord = null;
    game.usedWords = [];
    game.scores = {};
    ids.forEach(id => game.scores[id] = 0);
    game.round = 1;
    game.maxRounds = 3;
    game.turnDeadline = Date.now() + 15000;

    io.to(roomId).emit("wordGameStarted", { roomId, state: serializeRoom(room) });
    io.to(roomId).emit("wordGameSystem", { roomId, msg: "끝말잇기 시작!" });
  });

  // 단어 제출
  socket.on("submitWord", ({ roomId, word }) => {
    const room = rooms[roomId];
    const user = socket.data.user;
    if (!room || !user) return;
    if (!room.players[socket.id]) return;
    const game = room.wordGame;
    if (!game.isActive) {
      socket.emit("wordGameSystem", { roomId, msg: "아직 시작되지 않음." });
      return;
    }

    const now = Date.now();
    if (game.turnDeadline && now > game.turnDeadline) {
      io.to(roomId).emit("wordGameSystem", { roomId, msg: "시간 초과! 라운드 종료." });
      endRound(roomId, "시간 초과");
      return;
    }

    const currentId = game.turnOrder[game.currentTurnIndex];
    if (socket.id !== currentId) {
      socket.emit("wordGameSystem", { roomId, msg: "당신 차례가 아닙니다." });
      return;
    }

    word = (word || "").toString().trim();
    if (!word) {
      socket.emit("wordGameSystem", { roomId, msg: "공백 단어는 안됩니다." });
      return;
    }

    if (!isValidKoreanWord(word)) {
      io.to(roomId).emit("wordGameSystem", {
        roomId,
        msg: `${user.name} 님의 단어(${word})는 사전에 없는 것으로 처리됩니다.`
      });
    }

    if (game.usedWords.includes(word)) {
      io.to(roomId).emit("wordGameSystem", {
        roomId,
        msg: `${user.name} 님이 이미 나온 단어(${word})를 사용해 라운드 종료!`
      });
      endRound(roomId, "중복 단어");
      return;
    }

    if (game.lastWord) {
      const lastChar = game.lastWord[game.lastWord.length - 1];
      const firstChar = word[0];
      if (lastChar !== firstChar) {
        io.to(roomId).emit("wordGameSystem", {
          roomId,
          msg: `${user.name} 님이 규칙 위반(${word})으로 라운드 종료!`
        });
        endRound(roomId, "규칙 위반");
        return;
      }
    }

    // 정상 단어
    game.lastWord = word;
    game.usedWords.push(word);
    const gained = word.length * 10;
    game.scores[socket.id] = (game.scores[socket.id] || 0) + gained;

    io.to(roomId).emit("wordSubmitted", {
      roomId,
      id: socket.id,
      userId: user.userId,
      name: user.name,
      word,
      gained,
      totalScore: game.scores[socket.id]
    });

    // 턴/라운드 진행
    game.currentTurnIndex = (game.currentTurnIndex + 1) % game.turnOrder.length;
    if (game.currentTurnIndex === 0) {
      game.round += 1;
      if (game.round > game.maxRounds) {
        endRound(roomId, "라운드 종료");
        return;
      }
    }
    game.turnDeadline = Date.now() + 15000;
    io.to(roomId).emit("wordGameTurn", { roomId, state: serializeRoom(room) });
  });

  socket.on("disconnect", () => {
    delete plaza.players[socket.id];
    socket.leave("plaza");
    leaveCurrentRoom(socket);
    io.emit("roomList", serializeRooms());
    io.to("plaza").emit("plazaLeave", { id: socket.id });
  });
});

function endRound(roomId, reason) {
  const room = rooms[roomId];
  if (!room) return;
  const game = room.wordGame;
  game.isActive = false;

  let bestId = null;
  let bestScore = -1;
  for (const pid in game.scores) {
    if (game.scores[pid] > bestScore) {
      bestScore = game.scores[pid];
      bestId = pid;
    }
  }

  io.to(roomId).emit("wordGameEnded", {
    roomId,
    reason,
    winnerId: bestId,
    scores: game.scores
  });
}

function joinRoom(socket, roomId) {
  const room = rooms[roomId];
  if (!room) return;

  if (socket.data.roomId && socket.data.roomId !== roomId) {
    leaveCurrentRoom(socket);
  }

  socket.join(roomId);
  socket.data.roomId = roomId;
  room.players[socket.id] = true;

  io.to(roomId).emit("roomState", serializeRoom(room));
  socket.emit("roomJoined", { roomId });
}

function leaveCurrentRoom(socket) {
  const roomId = socket.data.roomId;
  if (!roomId) return;
  const room = rooms[roomId];
  if (!room) {
    socket.data.roomId = null;
    return;
  }
  delete room.players[socket.id];
  socket.leave(roomId);
  socket.data.roomId = null;

  if (Object.keys(room.players).length === 0) {
    delete rooms[roomId];
  } else {
    io.to(roomId).emit("roomState", serializeRoom(room));
  }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log("Server running on http://localhost:" + PORT);
});