// db.js
const Database = require("better-sqlite3");
const bcrypt = require("bcrypt");

const db = new Database("plaza_world.db");

// 최초 테이블 생성
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  nickname TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_stats (
  user_id INTEGER PRIMARY KEY,
  games_played INTEGER DEFAULT 0,
  wins INTEGER DEFAULT 0,
  points INTEGER DEFAULT 0,
  FOREIGN KEY(user_id) REFERENCES users(id)
);
`);

module.exports = {
  createUser(username, password, nickname) {
    const hash = bcrypt.hashSync(password, 10);
    const stmt = db.prepare(`
      INSERT INTO users (username, password_hash, nickname)
      VALUES (?, ?, ?)
    `);
    const info = stmt.run(username, hash, nickname);
    db.prepare(`INSERT INTO user_stats (user_id) VALUES (?)`).run(info.lastInsertRowid);
    return info.lastInsertRowid;
  },

  getUserByUsername(username) {
    return db.prepare(`SELECT * FROM users WHERE username = ?`).get(username);
  },

  checkPassword(user, password) {
    return bcrypt.compareSync(password, user.password_hash);
  },

  addGameResult(winnerUserId, participantsUserIds) {
    const incPlayed = db.prepare(`
      UPDATE user_stats SET games_played = games_played + 1
      WHERE user_id = ?
    `);
    const incWin = db.prepare(`
      UPDATE user_stats SET wins = wins + 1, points = points + 50
      WHERE user_id = ?
    `);
    const incLose = db.prepare(`
      UPDATE user_stats SET points = points + 10
      WHERE user_id = ?
    `);

    for (const uid of participantsUserIds) {
      incPlayed.run(uid);
      if (uid === winnerUserId) incWin.run(uid);
      else incLose.run(uid);
    }
  },

  getStats(userId) {
    return db.prepare(`SELECT * FROM user_stats WHERE user_id = ?`).get(userId);
  }
};
