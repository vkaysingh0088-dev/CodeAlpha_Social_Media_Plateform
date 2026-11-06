const express = require('express');
const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const SECRET = process.env.JWT_SECRET || 'change-me-in-production';
const db = new DatabaseSync(process.env.DB_FILE || path.join(__dirname, 'social.db'));
db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- helpers ----------
const auth = (required = true) => (req, res, next) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  try { req.user = jwt.verify(token, SECRET); }
  catch { if (required) return res.status(401).json({ error: 'Please log in.' }); }
  next();
};
const sign = (u) => jwt.sign({ id: u.id, username: u.username }, SECRET, { expiresIn: '7d' });
const clean = (s, max) => String(s || '').trim().slice(0, max);

const POST_SELECT = `
  SELECT p.id, p.content, p.created_at, u.username,
    (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS like_count,
    (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS comment_count,
    EXISTS(SELECT 1 FROM likes l WHERE l.post_id = p.id AND l.user_id = @me) AS liked
  FROM posts p JOIN users u ON u.id = p.user_id`;
const me = (req) => (req.user ? req.user.id : 0);

// ---------- auth ----------
app.post('/api/register', (req, res) => {
  const username = clean(req.body.username, 20);
  const password = String(req.body.password || '');
  if (!/^[A-Za-z0-9_]{3,20}$/.test(username))
    return res.status(400).json({ error: 'Username must be 3-20 letters, numbers or underscores.' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username))
    return res.status(409).json({ error: 'That username is taken.' });
  const info = db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)')
    .run(username, bcrypt.hashSync(password, 10));
  const user = { id: info.lastInsertRowid, username };
  res.json({ token: sign(user), username });
});

app.post('/api/login', (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE username = ?').get(clean(req.body.username, 20));
  if (!u || !bcrypt.compareSync(String(req.body.password || ''), u.password_hash))
    return res.status(401).json({ error: 'Wrong username or password.' });
  res.json({ token: sign(u), username: u.username });
});

// ---------- profiles ----------
app.put('/api/me', auth(), (req, res) => {
  db.prepare('UPDATE users SET bio = ? WHERE id = ?').run(clean(req.body.bio, 160), req.user.id);
  res.json({ ok: true });
});

app.get('/api/users', auth(false), (req, res) => {
  const q = `%${clean(req.query.q, 20)}%`;
  res.json(db.prepare('SELECT username, bio FROM users WHERE username LIKE ? ORDER BY username LIMIT 20').all(q));
});

app.get('/api/users/:username', auth(false), (req, res) => {
  const u = db.prepare('SELECT id, username, bio, created_at FROM users WHERE username = ?').get(req.params.username);
  if (!u) return res.status(404).json({ error: 'User not found.' });
  const count = (sql) => db.prepare(sql).get(u.id).n;
  res.json({
    username: u.username, bio: u.bio, created_at: u.created_at,
    followers: count('SELECT COUNT(*) n FROM followers WHERE followee_id = ?'),
    following: count('SELECT COUNT(*) n FROM followers WHERE follower_id = ?'),
    is_following: !!db.prepare('SELECT 1 FROM followers WHERE follower_id = ? AND followee_id = ?').get(me(req), u.id),
    posts: db.prepare(`${POST_SELECT} WHERE p.user_id = @uid ORDER BY p.id DESC`).all({ me: me(req), uid: u.id }),
  });
});

// ---------- follow / unfollow (toggle) ----------
app.post('/api/users/:username/follow', auth(), (req, res) => {
  const t = db.prepare('SELECT id FROM users WHERE username = ?').get(req.params.username);
  if (!t) return res.status(404).json({ error: 'User not found.' });
  if (t.id === req.user.id) return res.status(400).json({ error: "You can't follow yourself." });
  const has = db.prepare('SELECT 1 FROM followers WHERE follower_id = ? AND followee_id = ?').get(req.user.id, t.id);
  if (has) db.prepare('DELETE FROM followers WHERE follower_id = ? AND followee_id = ?').run(req.user.id, t.id);
  else db.prepare('INSERT INTO followers (follower_id, followee_id) VALUES (?, ?)').run(req.user.id, t.id);
  res.json({ following: !has });
});

// ---------- posts ----------
app.get('/api/feed', auth(false), (req, res) => {
  const scope = req.query.scope === 'following' && req.user
    ? 'WHERE p.user_id = @me OR p.user_id IN (SELECT followee_id FROM followers WHERE follower_id = @me)' : '';
  res.json(db.prepare(`${POST_SELECT} ${scope} ORDER BY p.id DESC LIMIT 100`).all({ me: me(req) }));
});

app.post('/api/posts', auth(), (req, res) => {
  const content = clean(req.body.content, 280);
  if (!content) return res.status(400).json({ error: 'Write something first.' });
  db.prepare('INSERT INTO posts (user_id, content) VALUES (?, ?)').run(req.user.id, content);
  res.json({ ok: true });
});

app.delete('/api/posts/:id', auth(), (req, res) => {
  const r = db.prepare('DELETE FROM posts WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  if (!r.changes) return res.status(404).json({ error: 'Post not found.' });
  res.json({ ok: true });
});

// ---------- likes (toggle) ----------
app.post('/api/posts/:id/like', auth(), (req, res) => {
  if (!db.prepare('SELECT 1 FROM posts WHERE id = ?').get(req.params.id))
    return res.status(404).json({ error: 'Post not found.' });
  const has = db.prepare('SELECT 1 FROM likes WHERE user_id = ? AND post_id = ?').get(req.user.id, req.params.id);
  if (has) db.prepare('DELETE FROM likes WHERE user_id = ? AND post_id = ?').run(req.user.id, req.params.id);
  else db.prepare('INSERT INTO likes (user_id, post_id) VALUES (?, ?)').run(req.user.id, req.params.id);
  const n = db.prepare('SELECT COUNT(*) n FROM likes WHERE post_id = ?').get(req.params.id).n;
  res.json({ liked: !has, like_count: n });
});

// ---------- comments ----------
app.get('/api/posts/:id/comments', (req, res) => {
  res.json(db.prepare(`SELECT c.id, c.content, c.created_at, u.username FROM comments c
    JOIN users u ON u.id = c.user_id WHERE c.post_id = ? ORDER BY c.id`).all(req.params.id));
});

app.post('/api/posts/:id/comments', auth(), (req, res) => {
  const content = clean(req.body.content, 200);
  if (!content) return res.status(400).json({ error: 'Write a comment first.' });
  if (!db.prepare('SELECT 1 FROM posts WHERE id = ?').get(req.params.id))
    return res.status(404).json({ error: 'Post not found.' });
  db.prepare('INSERT INTO comments (post_id, user_id, content) VALUES (?, ?, ?)').run(req.params.id, req.user.id, content);
  res.json({ ok: true });
});

if (require.main === module) app.listen(PORT, () => console.log(`MiniSocial running at http://localhost:${PORT}`));
module.exports = app;
