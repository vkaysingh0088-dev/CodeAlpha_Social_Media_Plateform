# Loop – Mini Social Media App

Features: user profiles (bio), posts, comments, likes, follow/unfollow, following feed, user search.

**Stack:** HTML/CSS/JavaScript frontend · Express.js backend · SQLite database (Node built-in node:sqlite, Node 22.5+)

## Run
```bash
npm install
npm start          # http://localhost:3000
```
Optional env vars: `PORT`, `JWT_SECRET`, `DB_FILE`.

## Database (schema.sql)
`users`, `posts`, `comments`, `likes` (user↔post), `followers` (follower↔followee).

## API
| Method | Route | Auth | Purpose |
|---|---|---|---|
| POST | /api/register, /api/login | – | Create account / log in (returns JWT) |
| GET | /api/users?q= | – | Search users |
| GET | /api/users/:name | optional | Profile, counts, posts |
| PUT | /api/me | yes | Update bio |
| POST | /api/users/:name/follow | yes | Follow / unfollow |
| GET | /api/feed?scope=all\|following | optional | Posts |
| POST | /api/posts | yes | Create post |
| DELETE | /api/posts/:id | yes | Delete own post |
| POST | /api/posts/:id/like | yes | Like / unlike |
| GET/POST | /api/posts/:id/comments | POST needs auth | Comments |
