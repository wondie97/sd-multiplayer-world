const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

// 광장(플라자) 정보: 모든 로그인 유저가 들어오는 기본 맵
const plaza = {
  mapId: "village", // 기본 맵은 마을 광장
  players: {}       // socketId -> player
};

// 방 정보 (끝말잇기, 미니게임 등)
const rooms = {}; // roomId -> { id, name, players: {socketId: true}, wordGame: {...} }

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
  const list = [];
  for (const id in rooms) {
    const r = rooms[id];
    list.push({
      id: r.id,
      name: r.name,
      playerCount: Object.keys(r.players).length,
      isActive: r.wordGame.isActive
    });
  }
  return list;
}

function serializeRoom(room) {
  return {
    id: room.id,
    name: room.name,
    players: Object.keys(room.players),
    wordGame: {
      isActive: room.wordGame.isActive,
      currentTurnId: room.wordGame.turnOrder[room.wordGame.currentTurnIndex] || null,
      lastWord: room.wordGame.lastWord,
      usedCount: room.wordGame.usedWords.length
    }
  };
}

io.on("connection", (socket) => {
  console.log("connected:", socket.id);
  socket.data.user = null;  // { socketId, userId, name }
  socket.data.roomId = null;

  // 로그인
  socket.on("login", (nameRaw) => {
    if (socket.data.user) return; // 이미 로그인
    let name = (nameRaw || "").toString().trim();
    if (!name) name = "손님";
    const userId = makeUserId();

    socket.data.user = {
      socketId: socket.id,
      userId,
      name
    };

    // 광장 플레이어 등록
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

    // 로그인 성공 정보 전송
    socket.emit("loginSuccess", {
      selfId: socket.id,
      userId,
      name,
      plaza: serializePlaza(),
      rooms: serializeRooms()
    });

    // 다른 사람에게 새 플레이어 알림
    socket.to("plaza").emit("plazaJoin", plaza.players[socket.id]);

    console.log("login:", name, userId);
  });

  // 광장 이동
  socket.on("plazaMove", ({ x, y, facing, state }) => {
    const user = socket.data.user;
    if (!user) return;
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
      players: {},  // socketId -> true
      wordGame: {
        isActive: false,
        turnOrder: [],
        currentTurnIndex: 0,
        lastWord: null,
        usedWords: []
      }
    };
    rooms[roomId] = room;

    // 방 입장
    joinRoom(socket, roomId);
    io.emit("roomList", serializeRooms());
  });

  // 방 입장
  socket.on("joinRoom", (roomId) => {
    const user = socket.data.user;
    if (!user) return;
    joinRoom(socket, roomId);
    io.emit("roomList", serializeRooms());
  });

  // 방 나가기
  socket.on("leaveRoom", () => {
    leaveCurrentRoom(socket);
    io.emit("roomList", serializeRooms());
  });

  // 방 채팅 (지금은 끝말잇기 로그용 정도로 사용)
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
    const user = socket.data.user;
    if (!user) return;
    const room = rooms[roomId];
    if (!room) return;
    if (!room.players[socket.id]) return;

    const game = room.wordGame;
    const playerIds = Object.keys(room.players);
    if (game.isActive) {
      socket.emit("wordGameSystem", { roomId, msg: "이미 게임이 진행 중입니다." });
      return;
    }
    if (playerIds.length < 2) {
      socket.emit("wordGameSystem", { roomId, msg: "2명 이상일 때 시작할 수 있습니다." });
      return;
    }

    game.isActive = true;
    game.turnOrder = playerIds;
    game.currentTurnIndex = 0;
    game.lastWord = null;
    game.usedWords = [];

    io.to(roomId).emit("wordGameStarted", {
      roomId,
      turnOrder: game.turnOrder,
      currentTurnId: game.turnOrder[0]
    });
    io.to(roomId).emit("wordGameSystem", {
      roomId,
      msg: "끝말잇기 시작! 첫 번째 플레이어부터 단어를 입력하세요."
    });
  });

  // 방에서 단어 제출
  socket.on("submitWord", ({ roomId, word }) => {
    const user = socket.data.user;
    if (!user) return;
    const room = rooms[roomId];
    if (!room) return;
    if (!room.players[socket.id]) return;
    const game = room.wordGame;

    if (!game.isActive) {
      socket.emit("wordGameSystem", { roomId, msg: "아직 끝말잇기가 시작되지 않았습니다." });
      return;
    }

    const currentId = game.turnOrder[game.currentTurnIndex];
    if (socket.id !== currentId) {
      socket.emit("wordGameSystem", { roomId, msg: "당신의 차례가 아닙니다." });
      return;
    }

    word = (word || "").toString().trim();
    if (!word) {
      socket.emit("wordGameSystem", { roomId, msg: "공백 단어는 사용할 수 없습니다." });
      return;
    }

    if (game.usedWords.includes(word)) {
      io.to(roomId).emit("wordGameSystem", {
        roomId,
        msg: `${user.name} 님이 이미 나온 단어(${word})를 사용해서 탈락!`
      });
      game.isActive = false;
      io.to(roomId).emit("wordGameEnded", { roomId, reason: "중복 단어 사용" });
      return;
    }

    if (game.lastWord) {
      const lastChar = game.lastWord[game.lastWord.length - 1];
      const firstChar = word[0];
      if (lastChar !== firstChar) {
        io.to(roomId).emit("wordGameSystem", {
          roomId,
          msg: `${user.name} 님이 규칙 위반(${word})으로 탈락!`
        });
        game.isActive = false;
        io.to(roomId).emit("wordGameEnded", { roomId, reason: "끝말잇기 규칙 위반" });
        return;
      }
    }

    game.lastWord = word;
    game.usedWords.push(word);

    io.to(roomId).emit("wordSubmitted", {
      roomId,
      id: socket.id,
      userId: user.userId,
      name: user.name,
      word
    });

    game.currentTurnIndex = (game.currentTurnIndex + 1) % game.turnOrder.length;
    const nextId = game.turnOrder[game.currentTurnIndex];
    io.to(roomId).emit("wordGameTurn", {
      roomId,
      currentTurnId: nextId
    });
  });

  socket.on("disconnect", () => {
    console.log("disconnected:", socket.id);
    // 광장에서 제거
    delete plaza.players[socket.id];
    socket.leave("plaza");

    // 방에서 제거
    leaveCurrentRoom(socket);
    io.emit("roomList", serializeRooms());

    // 광장에 나간 것 알리기
    io.to("plaza").emit("plazaLeave", { id: socket.id });
  });
});

function joinRoom(socket, roomId) {
  const user = socket.data.user;
  if (!user) return;
  const room = rooms[roomId];
  if (!room) return;

  // 기존 방 나가기
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
  console.log("Server listening on http://localhost:" + PORT);
});
