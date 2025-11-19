const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

// 방 정보: roomId -> { id, name, mapId, players, wordGame }
const rooms = {};

function randomName() {
  const animals = ["토끼", "고양이", "강아지", "판다", "곰", "다람쥐"];
  const n = Math.floor(Math.random() * animals.length);
  const num = Math.floor(Math.random() * 90) + 10;
  return animals[n] + num;
}

function serializeRoom(room) {
  return {
    id: room.id,
    name: room.name,
    mapId: room.mapId,
    players: Object.values(room.players || {}),
    wordGame: {
      isActive: room.wordGame.isActive,
      currentTurnId: room.wordGame.turnOrder[room.wordGame.currentTurnIndex] || null,
      lastWord: room.wordGame.lastWord,
      usedCount: room.wordGame.usedWords.length,
    },
  };
}

function serializeRooms() {
  const list = [];
  for (const id in rooms) {
    const r = rooms[id];
    list.push({
      id: r.id,
      name: r.name,
      mapId: r.mapId,
      playerCount: Object.keys(r.players).length,
      isActive: r.wordGame.isActive,
    });
  }
  return list;
}

io.on("connection", (socket) => {
  console.log("user connected:", socket.id);

  const lobbyPlayer = {
    id: socket.id,
    name: randomName(),
  };

  socket.data.lobbyPlayer = lobbyPlayer;
  socket.data.roomId = null;

  // 로비 초기 정보 전송
  socket.emit("lobbyInit", {
    selfId: socket.id,
    name: lobbyPlayer.name,
    rooms: serializeRooms(),
  });

  // 로비 방 목록 업데이트용
  io.emit("roomList", serializeRooms());

  socket.on("createRoom", ({ name, mapId }) => {
    if (!mapId) mapId = "village";
    const roomId = "room_" + Math.random().toString(36).slice(2, 8);
    const room = {
      id: roomId,
      name: name && name.trim() ? name.trim() : "무제 방",
      mapId,
      players: {},
      wordGame: {
        isActive: false,
        turnOrder: [],
        currentTurnIndex: 0,
        lastWord: null,
        usedWords: [],
      },
    };
    rooms[roomId] = room;

    // 방에 참가
    joinRoom(socket, roomId);

    console.log("room created:", roomId, "map:", mapId);
  });

  socket.on("joinRoom", (roomId) => {
    joinRoom(socket, roomId);
  });

  socket.on("leaveRoom", () => {
    leaveCurrentRoom(socket);
  });

  socket.on("moveInRoom", ({ roomId, x, y, facing, state }) => {
    const room = rooms[roomId];
    if (!room) return;
    const p = room.players[socket.id];
    if (!p) return;

    if (typeof x === "number") p.x = x;
    if (typeof y === "number") p.y = y;
    if (typeof facing === "string") p.facing = facing;
    if (state) p.state = state;

    io.to(roomId).emit("playerMovedInRoom", { roomId, player: p });
  });

  socket.on("chatRoom", ({ roomId, text }) => {
    const room = rooms[roomId];
    if (!room) return;
    const p = room.players[socket.id];
    if (!p) return;

    const message = (text || "").toString().trim();
    if (!message) return;

    io.to(roomId).emit("chatRoom", {
      roomId,
      id: socket.id,
      name: p.name,
      text: message,
      time: Date.now(),
    });
  });

  socket.on("startWordGame", ({ roomId }) => {
    const room = rooms[roomId];
    if (!room) return;
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
      currentTurnId: game.turnOrder[0],
    });
    io.to(roomId).emit("wordGameSystem", {
      roomId,
      msg: "끝말잇기 시작! 첫 번째 플레이어부터 단어를 입력하세요.",
    });
  });

  socket.on("submitWord", ({ roomId, word }) => {
    const room = rooms[roomId];
    if (!room) return;
    const game = room.wordGame;
    const p = room.players[socket.id];
    if (!p) return;

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
        msg: `${p.name} 님이 이미 나온 단어(${word})를 사용해서 탈락!`,
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
          msg: `${p.name} 님이 규칙 위반(${word})으로 탈락!`,
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
      name: p.name,
      word,
    });

    game.currentTurnIndex =
      (game.currentTurnIndex + 1) % game.turnOrder.length;
    const nextId = game.turnOrder[game.currentTurnIndex];
    io.to(roomId).emit("wordGameTurn", { roomId, currentTurnId: nextId });
  });

  socket.on("disconnect", () => {
    console.log("user disconnected:", socket.id);
    leaveCurrentRoom(socket, { silent: true });
    io.emit("roomList", serializeRooms());
  });
});

function joinRoom(socket, roomId) {
  const room = rooms[roomId];
  if (!room) return;

  const lobbyPlayer = socket.data.lobbyPlayer;
  // 이미 다른 방에 있으면 먼저 나가기
  if (socket.data.roomId && socket.data.roomId !== roomId) {
    leaveCurrentRoom(socket);
  }

  socket.join(roomId);
  socket.data.roomId = roomId;

  room.players[socket.id] = {
    id: socket.id,
    name: lobbyPlayer.name,
    x: 600,
    y: 600,
    facing: "down",
    state: "idle",
    score: 0,
  };

  io.to(roomId).emit("roomState", serializeRoom(room));
  io.emit("roomList", serializeRooms());

  socket.emit("roomJoined", { roomId });
}

function leaveCurrentRoom(socket, opts = {}) {
  const roomId = socket.data.roomId;
  if (!roomId) return;
  const room = rooms[roomId];
  if (!room) return;

  delete room.players[socket.id];
  socket.leave(roomId);
  socket.data.roomId = null;

  if (Object.keys(room.players).length === 0) {
    delete rooms[roomId];
  } else {
    io.to(roomId).emit("roomState", serializeRoom(room));
  }
  if (!opts.silent) {
    io.emit("roomList", serializeRooms());
  }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log("Server listening on http://localhost:" + PORT);
});