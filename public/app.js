const $ = (s) => document.querySelector(s);
const app = $('#app');
let session = JSON.parse(localStorage.getItem('loop') || 'null');
let feedScope = 'all';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ago = (d) => {
  const s = (Date.now() - new Date(d.replace(' ', 'T') + 'Z')) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
};
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 2200); }

async function api(url, method = 'GET', body) {
  const res = await fetch('/api' + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(session ? { Authorization: 'Bearer ' + session.token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && session) { logout(); }
  if (!res.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

function logout() { session = null; localStorage.removeItem('loop'); route(); }
function renderNav() {
  $('#nav').innerHTML = session
    ? `<a href="#/u/${session.username}">@${esc(session.username)}</a><button id="out">Log out</button>`
    : `<a href="#/login">Log in</a>`;
  if (session) $('#out').onclick = () => { logout(); location.hash = '#/login'; };
}

// ---------- post rendering ----------
function postHTML(p) {
  const mine = session && session.username.toLowerCase() === p.username.toLowerCase();
  return `<article class="card post" data-id="${p.id}">
    <div class="meta"><a href="#/u/${esc(p.username)}">@${esc(p.username)}</a><time>${ago(p.created_at)}</time></div>
    <p>${esc(p.content)}</p>
    <div class="actions">
      <button class="like ${p.liked ? 'liked' : ''}" aria-pressed="${!!p.liked}">${p.liked ? '♥' : '♡'} <span>${p.like_count}</span></button>
      <button class="cmt">💬 <span>${p.comment_count}</span></button>
      ${mine ? '<button class="del">Delete</button>' : ''}
    </div>
    <div class="comments" hidden></div>
  </article>`;
}

function bindPosts(root) {
  root.querySelectorAll('.post').forEach((el) => {
    const id = el.dataset.id;
    el.querySelector('.like').onclick = async (e) => {
      if (!session) return (location.hash = '#/login');
      const b = e.currentTarget;
      try {
        const r = await api(`/posts/${id}/like`, 'POST');
        b.classList.toggle('liked', r.liked);
        b.setAttribute('aria-pressed', r.liked);
        b.innerHTML = `${r.liked ? '♥' : '♡'} <span>${r.like_count}</span>`;
      } catch (err) { toast(err.message); }
    };
    const box = el.querySelector('.comments');
    el.querySelector('.cmt').onclick = () => { box.hidden = !box.hidden; if (!box.hidden) loadComments(id, box, el); };
    const del = el.querySelector('.del');
    if (del) del.onclick = async () => {
      if (!confirm('Delete this post?')) return;
      try { await api('/posts/' + id, 'DELETE'); el.remove(); toast('Post deleted'); } catch (err) { toast(err.message); }
    };
  });
}

async function loadComments(id, box, article) {
  const list = await api(`/posts/${id}/comments`);
  box.innerHTML = list.map((c) => `<div class="comment"><b><a href="#/u/${esc(c.username)}">@${esc(c.username)}</a></b>${esc(c.content)}</div>`).join('')
    || '<p class="muted">No comments yet.</p>';
  if (session) {
    box.insertAdjacentHTML('beforeend', `<form><input type="text" maxlength="200" placeholder="Add a comment" aria-label="Add a comment"><button class="btn">Reply</button></form>`);
    box.querySelector('form').onsubmit = async (e) => {
      e.preventDefault();
      const input = e.target.querySelector('input');
      try {
        await api(`/posts/${id}/comments`, 'POST', { content: input.value });
        await loadComments(id, box, article);
        const n = article.querySelector('.cmt span'); n.textContent = +n.textContent + 1;
      } catch (err) { toast(err.message); }
    };
  } else box.insertAdjacentHTML('beforeend', '<p class="muted"><a href="#/login"><u>Log in</u></a> to comment.</p>');
}

// ---------- views ----------
async function feedView() {
  const composer = session ? `<form class="card" id="compose">
      <textarea maxlength="280" rows="3" placeholder="What's happening?" aria-label="New post"></textarea>
      <div class="row"><span class="muted" id="count">0/280</span><button class="btn">Post</button></div></form>` : '';
  app.innerHTML = `${composer}
    <div class="tabs"><button data-s="all">Everyone</button>${session ? '<button data-s="following">Following</button>' : ''}</div>
    <div id="list"></div>`;
  app.querySelectorAll('.tabs button').forEach((b) => {
    b.classList.toggle('on', b.dataset.s === feedScope);
    b.onclick = () => { feedScope = b.dataset.s; feedView(); };
  });
  if (session) {
    const ta = $('#compose textarea');
    ta.oninput = () => ($('#count').textContent = ta.value.length + '/280');
    $('#compose').onsubmit = async (e) => {
      e.preventDefault();
      try { await api('/posts', 'POST', { content: ta.value }); toast('Posted'); feedView(); } catch (err) { toast(err.message); }
    };
  }
  const posts = await api('/feed?scope=' + feedScope);
  $('#list').innerHTML = posts.map(postHTML).join('')
    || `<p class="empty">${feedScope === 'following' ? 'Nothing here yet. Search for people and follow them.' : 'No posts yet. Write the first one.'}</p>`;
  bindPosts($('#list'));
}

async function profileView(name) {
  let u;
  try { u = await api('/users/' + encodeURIComponent(name)); }
  catch (e) { app.innerHTML = `<p class="empty">${esc(e.message)}</p>`; return; }
  const mine = session && session.username.toLowerCase() === u.username.toLowerCase();
  app.innerHTML = `<section class="card">
    <h1>@${esc(u.username)}</h1>
    <p id="bio">${u.bio ? esc(u.bio) : '<span class="muted">No bio yet.</span>'}</p>
    <div class="stats"><span><b id="fers">${u.followers}</b> followers</span><span><b>${u.following}</b> following</span><span><b>${u.posts.length}</b> posts</span></div>
    ${mine ? '<button class="btn ghost" id="edit">Edit bio</button>'
      : `<button class="btn ${u.is_following ? 'ghost' : ''}" id="follow">${u.is_following ? 'Unfollow' : 'Follow'}</button>`}
  </section><div id="list">${u.posts.map(postHTML).join('') || '<p class="empty">No posts yet.</p>'}</div>`;
  bindPosts($('#list'));
  if (mine) $('#edit').onclick = async () => {
    const bio = prompt('Your bio (160 characters max)', u.bio);
    if (bio === null) return;
    try { await api('/me', 'PUT', { bio }); profileView(name); } catch (e) { toast(e.message); }
  };
  else $('#follow').onclick = async () => {
    if (!session) return (location.hash = '#/login');
    try { await api(`/users/${u.username}/follow`, 'POST'); profileView(name); } catch (e) { toast(e.message); }
  };
}

function authView() {
  app.innerHTML = `<form class="card auth" id="auth">
    <h2>Log in or sign up</h2>
    <input type="text" id="u" placeholder="Username" autocomplete="username" required>
    <input type="password" id="p" placeholder="Password (6+ characters)" autocomplete="current-password" required>
    <div class="err" id="err"></div>
    <div class="row"><button class="btn" data-m="login">Log in</button><button type="button" class="btn ghost" data-m="register">Create account</button></div></form>`;
  const go = async (mode) => {
    try {
      const r = await api('/' + mode, 'POST', { username: $('#u').value, password: $('#p').value });
      session = { token: r.token, username: r.username };
      localStorage.setItem('loop', JSON.stringify(session));
      location.hash = '#/';
    } catch (e) { $('#err').textContent = e.message; }
  };
  $('#auth').onsubmit = (e) => { e.preventDefault(); go('login'); };
  app.querySelector('[data-m=register]').onclick = () => go('register');
}

// ---------- search ----------
let timer;
$('#search').oninput = (e) => {
  clearTimeout(timer);
  const q = e.target.value.trim(), box = $('#results');
  if (!q) return (box.hidden = true);
  timer = setTimeout(async () => {
    const list = await api('/users?q=' + encodeURIComponent(q));
    box.innerHTML = list.map((u) => `<a href="#/u/${esc(u.username)}">@${esc(u.username)}<br><small>${esc(u.bio || '')}</small></a>`).join('')
      || '<a>No one found</a>';
    box.hidden = false;
  }, 200);
};
$('#results').onclick = () => { $('#results').hidden = true; $('#search').value = ''; };

// ---------- router ----------
function route() {
  renderNav();
  const h = location.hash.slice(1) || '/';
  if (h.startsWith('/u/')) profileView(decodeURIComponent(h.slice(3)));
  else if (h === '/login') authView();
  else feedView();
}
window.addEventListener('hashchange', route);
route();
