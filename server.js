const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

const players = {}; // socket.id -> player 상태 저장

let wordGame = {
  isActive: false,
  turnOrder: [],
  currentTurnIndex: 0,
  lastWord: null,
  usedWords: [],
};

function randomColor() {
  const colors = ["#ff6b6b", "#6bc5ff", "#ffd93b", "#8aff6b", "#b36bff"];
  return colors[Math.floor(Math.random() * colors.length)];
}

io.on("connection", (socket) => {
  console.log("user connected:", socket.id);

  players[socket.id] = {
    id: socket.id,
    name: "유저" + socket.id.substring(0, 4),
    x: 400,
    y: 225,
    w: 40,
    h: 40,
    color: randomColor(),
    facing: "down",
    state: "idle",
  };

  socket.emit("init", {
    selfId: socket.id,
    players,
    wordGame,
  });

  socket.broadcast.emit("playerJoined", players[socket.id]);

  socket.on("move", (data) => {
    const p = players[socket.id];
    if (!p) return;
    p.x = data.x;
    p.y = data.y;
    p.facing = data.facing;
    p.state = data.state || p.state;
    io.emit("playerMoved", p);
  });

  socket.on("startFishing", () => {
    const p = players[socket.id];
    if (!p) return;
    p.state = "fishing";
    io.emit("playerFishing", { id: socket.id });

    setTimeout(() => {
      const success = Math.random() < 0.6;
      p.state = "idle";
      io.emit("fishingResult", { id: socket.id, success });
    }, 1000);
  });

  socket.on("startWordGame", () => {
    if (wordGame.isActive) return;
    const ids = Object.keys(players);
    if (ids.length < 2) {
      socket.emit("wordGameSystem", "2명 이상 접속해야 끝말잇기를 시작할 수 있어요.");
      return;
    }
    wordGame.isActive = true;
    wordGame.turnOrder = ids;
    wordGame.currentTurnIndex = 0;
    wordGame.lastWord = null;
    wordGame.usedWords = [];

    io.emit("wordGameStarted", {
      turnOrder: wordGame.turnOrder,
      currentTurnId: wordGame.turnOrder[wordGame.currentTurnIndex],
    });
    io.emit("wordGameSystem", "끝말잇기 시작! 첫 번째 플레이어부터 단어를 입력하세요.");
  });

  socket.on("submitWord", (word) => {
    if (!wordGame.isActive) {
      socket.emit("wordGameSystem", "아직 끝말잇기가 시작되지 않았어요.");
      return;
    }
    const currentId = wordGame.turnOrder[wordGame.currentTurnIndex];
    if (socket.id !== currentId) {
      socket.emit("wordGameSystem", "당신의 차례가 아니에요!");
      return;
    }

    word = (word || "").trim();
    if (!word) {
      socket.emit("wordGameSystem", "공백 단어는 안 됩니다.");
      return;
    }

    if (wordGame.usedWords.includes(word)) {
      io.emit(
        "wordGameSystem",
        `${players[socket.id]?.name || "알 수 없는 유저"} 님이 이미 나온 단어(${word})를 사용해서 탈락!`
      );
      wordGame.isActive = false;
      io.emit("wordGameEnded", { reason: "중복 단어 사용" });
      return;
    }

    if (wordGame.lastWord) {
      const lastChar = wordGame.lastWord[wordGame.lastWord.length - 1];
      const firstChar = word[0];
      if (lastChar !== firstChar) {
        io.emit(
          "wordGameSystem",
          `${players[socket.id]?.name || "알 수 없는 유저"} 님이 규칙 위반(${word}) 해서 탈락!`
        );
        wordGame.isActive = false;
        io.emit("wordGameEnded", { reason: "끝말잇기 규칙 위반" });
        return;
      }
    }

    wordGame.lastWord = word;
    wordGame.usedWords.push(word);

    io.emit("wordSubmitted", {
      id: socket.id,
      name: players[socket.id]?.name || "알 수 없는 유저",
      word,
    });

    wordGame.currentTurnIndex =
      (wordGame.currentTurnIndex + 1) % wordGame.turnOrder.length;
    const nextId = wordGame.turnOrder[wordGame.currentTurnIndex];
    io.emit("wordGameTurn", { currentTurnId: nextId });
  });

  socket.on("disconnect", () => {
    console.log("user disconnected:", socket.id);
    delete players[socket.id];
    io.emit("playerLeft", socket.id);

    if (wordGame.isActive) {
      const idx = wordGame.turnOrder.indexOf(socket.id);
      if (idx !== -1) {
        wordGame.turnOrder.splice(idx, 1);
        if (wordGame.turnOrder.length < 2) {
          wordGame.isActive = false;
          io.emit("wordGameSystem", "플레이어 수가 부족해서 끝말잇기를 종료합니다.");
          io.emit("wordGameEnded", { reason: "인원 부족" });
        } else {
          if (wordGame.currentTurnIndex >= wordGame.turnOrder.length) {
            wordGame.currentTurnIndex = 0;
          }
          io.emit("wordGameTurn", {
            currentTurnId: wordGame.turnOrder[wordGame.currentTurnIndex],
          });
        }
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});