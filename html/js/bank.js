// whip_bank — the counter screen. UI only: every request goes to client/main.lua (NUI callbacks), which asks the
// server; nothing here decides what is allowed. Every word comes from the locale table the client sends on open.
(() => {
  'use strict';

  const RES = typeof GetParentResourceName === 'function' ? GetParentResourceName() : null;
  const $ = (id) => document.getElementById(id);

  // ---------------------------------------------------------------- state
  const S = {
    open: false, lang: 'en', loc: {}, quick: [100, 500, 1000, 5000], pad: false,
    accounts: [], cash: 0, branch: '',
    sel: null, op: 'deposit', page: null,
    history: {}, access: {}, nearby: null,
    form: { amount: '', note: '', toMode: 'mine', toId: null, number: '' },
    nw: { label: '', type: 'savings' }, roleNew: 'view',
    busy: false,
  };

  // ---------------------------------------------------------------- helpers
  const t = (key, ...args) => {
    let s = S.loc[key] != null ? S.loc[key] : key;
    let i = 0;
    return s.replace(/%[sd]/g, () => (i < args.length ? String(args[i++]) : ''));
  };
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n) => {
    try { return '$' + new Intl.NumberFormat(S.lang).format(Math.round(Math.abs(n || 0))); }
    catch (e) { return '$' + String(Math.round(Math.abs(n || 0))).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  };
  const when = (secs) => {
    if (!secs) return '';
    try { return new Intl.DateTimeFormat(S.lang, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(secs * 1000)); }
    catch (e) { return new Date(secs * 1000).toLocaleString(); }
  };
  const whole = (v) => { const n = parseInt(String(v).replace(/[^\d]/g, ''), 10); return Number.isFinite(n) && n > 0 ? n : 0; };
  // An empty Lua table arrives as {} rather than []: every list from the client goes through this.
  const arr = (v) => (Array.isArray(v) ? v : []);
  const acct = () => S.accounts.find((a) => a.id === S.sel) || null;
  const initials = (name) => String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

  async function post(name, data) {
    if (!RES) return Mock.post(name, data || {});
    try {
      const r = await fetch(`https://${RES}/${name}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data || {}) });
      return await r.json();
    } catch (e) { return { ok: false, error: t('bank_down') }; }
  }

  function toast(text, kind) {
    const el = document.createElement('div');
    el.className = 'toast ' + (kind || '');
    el.textContent = text;
    $('toasts').appendChild(el);
    setTimeout(() => el.remove(), 3200);
  }

  // ---------------------------------------------------------------- icons
  const P = {
    personal: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/>',
    savings:  '<path d="M5 10h14v10H5zM8 10V7a4 4 0 0 1 8 0v3"/>',
    shared:   '<circle cx="8" cy="9" r="3"/><circle cx="16" cy="9" r="3"/><path d="M2 20c1-3 3-5 6-5s5 2 6 5M14 15.5c.6-.3 1.3-.5 2-.5 3 0 5 2 6 5"/>',
    business: '<path d="M3 21h18M5 21V8l7-4 7 4v13M9 21v-6h6v6"/>',
    plus:     '<path d="M12 5v14M5 12h14"/>',
    x:        '<path d="M6 6l12 12M18 6L6 18"/>',
  };
  const icon = (k) => `<svg viewBox="0 0 24 24">${P[k] || P.personal}</svg>`;

  // ---------------------------------------------------------------- what the player may do
  const OPS = ['deposit', 'withdraw', 'transfer', 'access'];
  function allowed(a, op) {
    if (!a) return false;
    if (op === 'access') return !!a.can.share;
    return !!a.can[op];
  }
  function firstOp(a) { return OPS.find((op) => allowed(a, op)) || 'deposit'; }

  // ---------------------------------------------------------------- render: the column
  function renderColumn() {
    $('branch').textContent = S.branch;
    $('cash').textContent = fmt(S.cash);
    const rows = S.accounts.map((a) => {
      const sub = [a.number, a.job || t('type_' + a.type), a.role !== 'owner' ? t('role_' + a.role) : (a.default ? t('ui_default') : '')]
        .filter(Boolean).join(' · ');
      return `<button class="row${!S.page && a.id === S.sel ? ' on' : ''}" data-acct="${a.id}">
        <span class="disc">${icon(a.type)}</span>
        <span class="meta"><span class="t">${esc(a.label)}</span><span class="sub">${esc(sub)}</span></span>
        <span class="v">${fmt(a.balance)}</span></button>`;
    });
    rows.push(`<button class="row${S.page === 'new' ? ' on' : ''}" data-page="new"><span class="disc">${icon('plus')}</span>
      <span class="meta"><span class="t">${esc(t('ui_open_account'))}</span><span class="sub">${esc(t('ui_open_sub'))}</span></span></button>`);
    $('accounts').innerHTML = rows.join('');
    $('col-keys').innerHTML = `<span><span class="key">↑↓</span>${esc(t('ui_key_account'))}</span><span><span class="key">ESC</span>${esc(t('ui_key_close'))}</span>`;
  }

  // ---------------------------------------------------------------- render: the account
  function renderMain() {
    const main = $('main');
    if (S.page === 'new') { main.innerHTML = newPage(); return; }
    const a = acct();
    if (!a) {
      main.innerHTML = `<div></div><div class="empty">${esc(t('ui_no_accounts'))}</div><div class="bar"></div>`;
      return;
    }
    const chips = [t('type_' + a.type)];
    if (a.job) chips.push(a.job);
    chips.push(t('role_' + a.role));
    main.innerHTML = `
      <div class="top">
        <div>
          <div class="who"><span class="lbl">${esc(a.label)} · ${esc(a.number)}</span>
            ${a.frozen ? `<span class="chip frozen">${esc(t('ui_frozen'))}</span>` : ''}</div>
          <div class="money bal">${fmt(a.balance)}</div>
          <div class="who" style="margin-top:10px">${chips.map((c) => `<span class="chip">${esc(c)}</span>`).join('')}</div>
        </div>
        <div class="ops">${OPS.map((op) => `<button class="op${S.op === op ? ' on' : ''}" data-op="${op}" ${allowed(a, op) ? '' : 'disabled'}>${esc(t('ui_tab_' + op))}</button>`).join('')}</div>
      </div>
      <div class="body">
        <div class="tx-list">${historyHtml(a)}</div>
        <div class="form" id="form">${formHtml(a)}</div>
      </div>
      <div class="bar keys"><span><span class="key">TAB</span>${esc(t('ui_key_tab'))}</span><span><span class="key">ENTER</span>${esc(t('ui_key_confirm'))}</span></div>`;
    updateForm();
  }

  function historyHtml(a) {
    const h = S.history[a.id];
    const head = `<span class="lbl" style="margin-bottom:6px">${esc(t('ui_recent'))}</span>`;
    if (!h || h === 'loading') return head + `<div class="empty">${esc(t('ui_loading'))}</div>`;
    if (h.error) return head + `<div class="empty">${esc(h.error)}</div>`;
    if (!h.length) return head + `<div class="empty">${esc(t('ui_no_activity'))}</div>`;
    return head + h.map((x) => {
      const title = x.text || (x.party ? t(x.dir === 'out' ? 'tx_to' : 'tx_from', x.party) : t('tx_' + x.kind));
      const sub = [x.text ? t('tx_' + x.kind) : null, x.text && x.party ? t(x.dir === 'out' ? 'tx_to' : 'tx_from', x.party) : null, when(x.time)]
        .filter(Boolean).join(' · ');
      return `<div class="tx"><span class="w">${esc(title)}</span>
        <span class="m ${x.dir === 'in' ? 'up' : ''}">${x.dir === 'in' ? '+' : '−'}${fmt(x.amount)}</span>
        <span class="d">${esc(sub)}</span><span class="b">${x.balance != null ? fmt(x.balance) : ''}</span></div>`;
    }).join('');
  }

  // ---------------------------------------------------------------- the operation panel
  function formHtml(a) {
    if (S.op === 'access') return accessHtml(a);
    if (a.frozen) return `<span class="lbl">${esc(t('ui_frozen'))}</span><p class="note">${esc(t('ui_frozen_note'))}</p>`;
    if (!allowed(a, S.op)) return `<p class="note">${esc(t('ui_cant'))}</p>`;
    const f = S.form;
    const title = { deposit: 'ui_deposit_into', withdraw: 'ui_withdraw_from', transfer: 'ui_transfer_from' }[S.op];
    const quick = S.quick.map((q) => `<button data-quick="${q}">${fmt(q)}</button>`).join('') + `<button data-quick="all">${esc(t('ui_all'))}</button>`;
    let to = '';
    if (S.op === 'transfer') {
      const others = S.accounts.filter((x) => x.id !== a.id);
      to = `<div class="field"><span class="lbl">${esc(t('ui_to'))}</span>
        <div class="seg"><button data-to="mine" class="${f.toMode === 'mine' ? 'on' : ''}">${esc(t('ui_to_mine'))}</button>
        <button data-to="number" class="${f.toMode === 'number' ? 'on' : ''}">${esc(t('ui_to_number'))}</button></div></div>` +
        (f.toMode === 'mine'
          ? `<div class="picks">${others.map((x) => `<button class="pick${f.toId === x.id ? ' on' : ''}" data-toid="${x.id}"><span>${esc(x.label)}</span><small>${esc(x.number)}</small></button>`).join('')}</div>`
          : `<input class="in" id="f-number" maxlength="16" placeholder="${esc(t('ui_number_ph'))}" value="${esc(f.number)}">`);
    }
    return `<span class="lbl">${esc(t(title, a.label))}</span>
      <label class="amt"><span>$</span><input id="f-amount" inputmode="numeric" autocomplete="off" placeholder="0" value="${esc(f.amount)}"></label>
      <div class="quick">${quick}</div>
      ${to}
      <div class="field"><span class="lbl">${esc(t('ui_note'))}</span><input class="in" id="f-note" maxlength="100" placeholder="${esc(t('ui_optional'))}" value="${esc(f.note)}"></div>
      <div class="grow"></div>
      <button class="btn" id="go"></button>
      <span class="hint" id="hint"></span>`;
  }

  /** The parts of the panel that follow the typed amount, without re-drawing the inputs. */
  function updateForm() {
    const a = acct();
    const go = $('go'), hint = $('hint');
    if (!a || !go) return;
    const n = whole(S.form.amount);
    const label = { deposit: 'ui_do_deposit', withdraw: 'ui_do_withdraw', transfer: 'ui_do_transfer' }[S.op];
    go.textContent = S.busy ? t('ui_working') : (n ? t(label, fmt(n)) : t('ui_tab_' + S.op));
    let warn = '', note = '';
    if (S.op === 'deposit') {
      if (n > S.cash) warn = t('ui_not_enough_cash', fmt(S.cash)); else if (n) note = t('ui_left_on_hand', fmt(S.cash - n));
    } else {
      if (n > a.balance) warn = t('ui_not_enough_bal', fmt(a.balance)); else if (n) note = t('ui_left_in_account', fmt(a.balance - n));
    }
    const target = S.op !== 'transfer' || (S.form.toMode === 'mine' ? !!S.form.toId : S.form.number.trim().length >= 6);
    go.disabled = S.busy || !n || !!warn || !target;
    hint.textContent = warn || note;
    hint.className = 'hint' + (warn ? ' warn' : '');
  }

  function accessHtml(a) {
    const ac = S.access[a.id];
    if (!ac || ac === 'loading') return `<span class="lbl">${esc(t('ui_people'))}</span><p class="note">${esc(t('ui_loading'))}</p>`;
    if (ac.error) return `<p class="note">${esc(ac.error)}</p>`;
    const roleSel = (attrs, current) => `<select class="in" ${attrs}>${ac.roles.map((r) => `<option value="${r}"${r === current ? ' selected' : ''}>${esc(t('role_' + r))}</option>`).join('')}</select>`;
    const people = ac.people.map((p) => `<div class="person"><span class="avatar">${esc(initials(p.name))}</span>
        <span class="meta"><span class="t">${esc(p.me ? t('ui_you', p.name) : p.name)}</span>${p.editable ? '' : `<span class="sub">${esc(t('role_' + p.role))}</span>`}</span>
        ${p.editable ? roleSel(`data-role-of="${p.charId}"`, p.role) + `<button class="x" title="${esc(t('ui_remove'))}" data-revoke="${p.charId}">${icon('x')}</button>` : ''}</div>`).join('');
    const pending = (ac.pending || []).map((p) => `<div class="person"><span class="avatar">${esc(initials(p.name))}</span>
        <span class="meta"><span class="t">${esc(p.name)}</span><span class="sub">${esc(t('role_' + p.role))} · ${esc(t('ui_working'))}</span></span></div>`).join('');
    let near;
    if (S.nearby === null) near = `<p class="note">${esc(t('ui_loading'))}</p>`;
    else if (!S.nearby.length) near = `<p class="note">${esc(t('ui_nobody_near'))}</p>`;
    else near = S.nearby.map((p) => `<div class="person"><span class="avatar">${esc(initials(p.name))}</span>
        <span class="meta"><span class="t">${esc(p.name)}</span><span class="sub">${p.dist} m</span></span>
        <button class="btn sm" data-invite="${p.src}">${esc(t('ui_ask'))}</button></div>`).join('');
    const close = a.can.close ? `<div class="grow"></div><button class="btn danger" data-act="askClose">${esc(t('ui_close_account'))}</button>` : '';
    return `<span class="lbl">${esc(t('ui_people'))}</span><div>${people}${pending}</div>
      ${ac.roles.length ? `<span class="lbl" style="margin-top:6px">${esc(t('ui_add_person'))}</span>
      <p class="note" style="font-size:13px">${esc(t('ui_add_hint'))}</p>
      <div class="field"><span class="lbl">${esc(t('ui_access_as'))}</span>${roleSel('id="role-new" style="width:100%;height:40px"', S.roleNew)}</div>
      <div>${near}</div>
      <button class="btn ghost sm" data-act="lookAgain">${esc(t('ui_look_again'))}</button>` : ''}
      ${close}`;
  }

  function newPage() {
    const n = S.nw;
    return `<div class="page">
        <span class="lbl">${esc(S.branch)}</span><h3>${esc(t('ui_new_title'))}</h3>
        <div class="field"><span class="lbl">${esc(t('ui_new_name'))}</span><input class="in" id="nw-label" maxlength="50" placeholder="${esc(t('ui_new_name_ph'))}" value="${esc(n.label)}"></div>
        <div class="field"><span class="lbl">${esc(t('ui_new_type'))}</span>
          <div class="seg"><button data-nwtype="savings" class="${n.type === 'savings' ? 'on' : ''}">${esc(t('type_savings'))}</button>
          <button data-nwtype="shared" class="${n.type === 'shared' ? 'on' : ''}">${esc(t('type_shared'))}</button></div></div>
        <div style="display:flex;gap:8px"><button class="btn ghost" data-act="back">${esc(t('ui_back'))}</button>
          <button class="btn" data-act="create" id="nw-go" ${n.label.trim() && !S.busy ? '' : 'disabled'}>${esc(S.busy ? t('ui_working') : t('ui_open'))}</button></div>
      </div><div></div><div class="bar keys"><span><span class="key">ESC</span>${esc(t('ui_back'))}</span></div>`;
  }

  function render() { renderColumn(); renderMain(); }

  // ---------------------------------------------------------------- sheet (confirmations)
  let sheetGo = null;
  function sheet(title, rows, goLabel, onGo, danger) {
    sheetGo = onGo;
    $('sheet').innerHTML = `<div class="sheet"><h4>${esc(title)}</h4>
      ${rows.length ? `<dl>${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` : ''}
      <div class="btns"><button class="btn ghost" data-sheet="no">${esc(t('ui_cancel'))}</button>
      <button class="btn${danger ? ' danger' : ''}" data-sheet="yes">${esc(goLabel)}</button></div></div>`;
    $('sheet').hidden = false;
    $('sheet').querySelector('[data-sheet="yes"]').focus();
  }
  function closeSheet() { $('sheet').hidden = true; sheetGo = null; }

  // ---------------------------------------------------------------- loading
  async function loadState() {
    const r = await post('state');
    if (!r.ok) { toast(r.error, 'bad'); return; }
    applyState(r.data);
    render();
  }
  function applyState(st) {
    S.accounts = arr(st.accounts);
    S.cash = st.cash || 0;
    S.branch = st.branch || '';
    if (!S.accounts.find((a) => a.id === S.sel)) {
      const def = S.accounts.find((a) => a.default) || S.accounts[0];
      S.sel = def ? def.id : null;
      if (def) S.op = firstOp(def);
    }
  }
  async function loadHistory(id) {
    if (!id) return;
    if (!S.history[id]) S.history[id] = 'loading';
    const r = await post('history', { id });
    S.history[id] = r.ok ? arr(r.data) : { error: r.error };
    if (S.sel === id && !S.page) {
      const list = document.querySelector('.tx-list');
      const a = acct();
      if (list && a) list.innerHTML = historyHtml(a);
    }
  }
  async function loadAccess(id) {
    S.access[id] = S.access[id] && S.access[id] !== 'loading' ? S.access[id] : 'loading';
    const [r, n] = await Promise.all([post('access', { id }), post('nearby')]);
    S.access[id] = r.ok ? { people: arr(r.data.people), pending: arr(r.data.pending), roles: arr(r.data.roles) } : { error: r.error };
    S.nearby = n.ok ? arr(n.data) : [];
    if (S.sel === id && S.op === 'access' && !S.page) renderMain();
  }
  async function refreshAll() {
    await loadState();
    const a = acct();
    if (a) {
      loadHistory(a.id);
      if (S.op === 'access') loadAccess(a.id);
    }
  }

  // ---------------------------------------------------------------- choosing
  function choose(id) {
    const a = S.accounts.find((x) => x.id === id);
    if (!a) return;
    S.page = null;
    S.sel = id;
    if (!allowed(a, S.op)) S.op = firstOp(a);
    S.form = { amount: '', note: '', toMode: 'mine', toId: null, number: '' };
    render();
    loadHistory(id);
    if (S.op === 'access') loadAccess(id);
  }
  function step(dir) {
    if (!S.accounts.length) return;
    const i = S.accounts.findIndex((a) => a.id === S.sel);
    const next = S.accounts[(i + dir + S.accounts.length) % S.accounts.length];
    choose(next.id);
  }
  function setOp(op) {
    const a = acct();
    if (!a || !allowed(a, op)) return;
    S.op = op;
    S.form.amount = '';
    renderMain();
    if (op === 'access') { S.nearby = null; loadAccess(a.id); }
    else { const amt = $('f-amount'); if (amt) amt.focus(); }
  }
  function cycleOp(dir) {
    const a = acct();
    if (!a) return;
    const ok = OPS.filter((op) => allowed(a, op));
    if (!ok.length) return;
    const i = ok.indexOf(S.op);
    setOp(ok[(i + dir + ok.length) % ok.length]);
  }

  // ---------------------------------------------------------------- doing
  async function run(name, data, done) {
    if (S.busy) return false;
    S.busy = true; updateForm();
    const r = await post(name, data);
    S.busy = false;
    if (!r.ok) { toast(r.error, 'bad'); updateForm(); return false; }
    if (done) toast(done, 'good');
    return r;
  }

  async function submit() {
    const a = acct();
    if (!a || S.page || S.op === 'access') return;
    const go = $('go');
    if (!go || go.disabled) return;
    const amount = whole(S.form.amount);
    const note = S.form.note.trim();
    if (S.op === 'transfer') {
      const to = S.form.toMode === 'mine' ? S.accounts.find((x) => x.id === S.form.toId) : null;
      const toText = to ? `${to.label} · ${to.number}` : S.form.number.trim().toUpperCase();
      const rows = [[t('ui_to'), toText]];
      if (note) rows.push([t('ui_note'), note]);
      sheet(t('ui_do_transfer', fmt(amount)) + '?', [[t('ui_from'), `${a.label} · ${a.number}`], ...rows], t('ui_confirm'), async () => {
        closeSheet();
        const r = await run('transfer', { from: a.id, to: to ? to.id : 0, number: to ? '' : S.form.number.trim(), amount, note }, t('ui_done_transfer', fmt(amount)));
        if (r) { S.form.amount = ''; S.form.note = ''; S.form.number = ''; await refreshAll(); }
      });
      return;
    }
    const r = await run(S.op, { id: a.id, amount, note }, t(S.op === 'deposit' ? 'ui_done_deposit' : 'ui_done_withdraw', fmt(amount)));
    if (r) { S.form.amount = ''; S.form.note = ''; await refreshAll(); }
  }

  async function create() {
    const label = S.nw.label.trim();
    if (!label || S.busy) return;
    S.busy = true; renderMain();
    const r = await post('open', { label, type: S.nw.type });
    S.busy = false;
    if (!r.ok) { toast(r.error, 'bad'); renderMain(); return; }
    toast(t('ui_done_open', r.data.number), 'good');
    S.nw = { label: '', type: 'savings' };
    S.page = null;
    S.sel = r.data.id;
    await refreshAll();
  }

  function askClose() {
    const a = acct();
    if (!a) return;
    if (a.balance > 0) { toast(t('ui_close_empty'), 'bad'); return; }
    sheet(t('ui_close_q', a.label), [[a.number, t('ui_close_note')]], t('ui_close_account'), async () => {
      closeSheet();
      const r = await run('closeAccount', { id: a.id }, t('ui_done_close'));
      if (r) { S.sel = null; S.op = 'deposit'; await refreshAll(); }
    }, true);
  }

  // ---------------------------------------------------------------- events
  document.addEventListener('click', async (e) => {
    const el = e.target.closest('button');
    if (!el || el.disabled) return;
    const d = el.dataset;
    if (d.acct) return choose(+d.acct);
    if (d.page === 'new') { S.page = 'new'; render(); const i = $('nw-label'); if (i) i.focus(); return; }
    if (d.op) return setOp(d.op);
    if (d.quick) {
      const a = acct();
      S.form.amount = d.quick === 'all' ? String(S.op === 'deposit' ? S.cash : (a ? a.balance : 0)) : d.quick;
      const i = $('f-amount'); if (i) i.value = S.form.amount;
      return updateForm();
    }
    if (d.to) { S.form.toMode = d.to; S.form.toId = null; return renderMain(); }
    if (d.toid) { S.form.toId = +d.toid; return renderMain(); }
    if (d.nwtype) { S.nw.type = d.nwtype; return renderMain(); }
    if (d.sheet === 'no') return closeSheet();
    if (d.sheet === 'yes') return sheetGo && sheetGo();
    if (d.invite) {
      const a = acct();
      const r = await run('invite', { id: a.id, target: +d.invite, role: S.roleNew });
      if (r) { toast(t('invite_sent', r.data.name), 'good'); loadAccess(a.id); }
      return;
    }
    if (d.revoke) {
      const a = acct();
      const r = await run('revoke', { id: a.id, charId: +d.revoke }, t('ui_done_revoke'));
      if (r) loadAccess(a.id);
      return;
    }
    switch (d.act) {
      case 'back': S.page = null; return render();
      case 'create': return create();
      case 'askClose': return askClose();
      case 'lookAgain': { const a = acct(); S.nearby = null; renderMain(); return a && loadAccess(a.id); }
    }
    if (el.id === 'go') return submit();
  });

  document.addEventListener('change', async (e) => {
    const el = e.target;
    if (el.id === 'role-new') { S.roleNew = el.value; return; }
    if (el.dataset.roleOf) {
      const a = acct();
      const r = await run('setRole', { id: a.id, charId: +el.dataset.roleOf, role: el.value }, t('ui_done_role'));
      loadAccess(a.id);
      return r;
    }
  });

  document.addEventListener('input', (e) => {
    const el = e.target;
    if (el.id === 'f-amount') {
      const n = whole(el.value);
      S.form.amount = n ? String(n) : '';
      el.value = S.form.amount;
      updateForm();
    } else if (el.id === 'f-note') S.form.note = el.value;
    else if (el.id === 'f-number') { S.form.number = el.value; updateForm(); }
    else if (el.id === 'nw-label') {
      S.nw.label = el.value;
      const go = $('nw-go'); if (go) go.disabled = !el.value.trim() || S.busy;
    }
  });

  // A field with the keyboard: the client leaves the pad alone and gives the game no input.
  document.addEventListener('focusin', (e) => { if (e.target.matches('input')) post('typing', { on: true }); });
  document.addEventListener('focusout', (e) => { if (e.target.matches('input')) post('typing', { on: false }); });

  document.addEventListener('keydown', (e) => {
    if (!S.open) return;
    const typing = e.target.matches && e.target.matches('input, select');
    if (e.key === 'Escape') {
      e.preventDefault();
      if (!$('sheet').hidden) return closeSheet();
      if (S.page) { S.page = null; return render(); }
      return post('close');
    }
    if (e.key === 'Enter') {
      if (!$('sheet').hidden) { e.preventDefault(); return sheetGo && sheetGo(); }
      if (S.page === 'new') { e.preventDefault(); return create(); }
      if (e.target.tagName !== 'BUTTON') { e.preventDefault(); return submit(); }
      return;
    }
    if (e.key === 'Tab' && !S.page && $('sheet').hidden) { e.preventDefault(); return cycleOp(e.shiftKey ? -1 : 1); }
    if (typing) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); step(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); step(-1); }
  });

  // ---------------------------------------------------------------- messages from the client
  function scale() {
    // The /whip window: 1250×690 at 1.8 × (height / 1440), never wider than the screen.
    const s = Math.min((window.innerHeight / 1440) * 1.8 * 0.72, (window.innerWidth - 40) / 1250);
    document.documentElement.style.setProperty('--res-scale', String(Math.max(0.5, s)));
  }
  window.addEventListener('resize', scale);

  function onPad(cmd, down) {
    if (down === false) return;
    if (!$('sheet').hidden) {
      if (cmd === 'a') return sheetGo && sheetGo();
      if (cmd === 'b') return closeSheet();
      return;
    }
    switch (cmd) {
      case 'up': return step(-1);
      case 'down': return step(1);
      case 'left': return cycleOp(-1);
      case 'right': return cycleOp(1);
      case 'a': return submit();
      case 'b': return S.page ? (S.page = null, render()) : post('close');
    }
  }

  window.addEventListener('message', (e) => {
    const m = e.data || {};
    switch (m.action) {
      case 'open':
        S.open = true;
        S.loc = m.locale || {};
        S.lang = m.lang || 'en';
        S.quick = Array.isArray(m.quick) && m.quick.length ? m.quick.slice(0, 4) : S.quick;
        S.pad = !!m.pad;
        S.page = null; S.history = {}; S.access = {}; S.nearby = null;
        document.documentElement.lang = S.lang;
        document.querySelectorAll('[data-t]').forEach((el) => { el.textContent = t(el.dataset.t); });
        applyState(m.state || {});
        scale();
        $('bank').hidden = false;
        render();
        if (S.sel) loadHistory(S.sel);
        break;
      case 'close':
        S.open = false;
        closeSheet();
        $('bank').hidden = true;
        break;
      case 'changed':
        if (S.open) refreshAll();
        break;
      case 'pad':
        if (S.open) onPad(m.cmd, m.down);
        break;
      case 'padDevice':
        S.pad = !!m.pad;
        break;
    }
  });

  // ---------------------------------------------------------------- outside the game: example data to look at
  const Mock = {
    cash: 2340,
    accounts: [
      { id: 1, number: 'WB-482913', label: 'Personal Account', type: 'personal', balance: 48250, role: 'owner', default: true, frozen: false, can: { deposit: true, withdraw: true, transfer: true, share: true, close: false } },
      { id: 2, number: 'WB-118204', label: 'Emergency fund', type: 'savings', balance: 120000, role: 'owner', default: false, frozen: false, can: { deposit: true, withdraw: true, transfer: true, share: true, close: true } },
      { id: 3, number: 'WB-903377', label: 'House bills', type: 'shared', balance: 3410, role: 'withdraw', default: false, frozen: false, can: { deposit: true, withdraw: true, transfer: true, share: false, close: false } },
      { id: 4, number: 'WB-550021', label: "Benny's Motorworks", type: 'business', job: "Benny's", balance: 612880, role: 'manager', default: false, frozen: false, can: { deposit: true, withdraw: true, transfer: true, share: true, close: false } },
      { id: 5, number: 'WB-771045', label: 'Old savings', type: 'savings', balance: 900, role: 'owner', default: false, frozen: true, can: { deposit: true, withdraw: true, transfer: true, share: true, close: true } },
    ],
    async post(name, d) {
      await new Promise((r) => setTimeout(r, 200));
      const now = Math.floor(Date.now() / 1000);
      const find = (id) => this.accounts.find((a) => a.id === id);
      switch (name) {
        case 'state': return { ok: true, data: { accounts: JSON.parse(JSON.stringify(this.accounts)), cash: this.cash, branch: 'Fleeca · Legion Square' } };
        case 'history': return { ok: true, data: d.id === 5 ? [] : [
          { id: 6, amount: 3200, dir: 'in', kind: 'transfer_in', party: "Benny's Motorworks", text: 'Wages', time: now - 1800, balance: find(d.id).balance },
          { id: 5, amount: 1850, dir: 'out', kind: 'payment', text: 'Los Santos Customs', time: now - 60000, balance: 45050 },
          { id: 4, amount: 500, dir: 'out', kind: 'withdraw', text: 'ATM withdrawal', time: now - 80000, balance: 46900 },
          { id: 3, amount: 1000, dir: 'out', kind: 'transfer_out', text: 'November rent', time: now - 260000, balance: 47400 },
          { id: 2, amount: 6000, dir: 'in', kind: 'deposit', text: null, time: now - 350000, balance: 48400 },
          { id: 1, amount: 250, dir: 'out', kind: 'payment', text: 'Parking fine', time: now - 450000, balance: 42400 },
        ] };
        case 'deposit': { const a = find(d.id); if (d.amount > this.cash) return { ok: false, error: 'Not enough cash' }; a.balance += d.amount; this.cash -= d.amount; return { ok: true, data: true }; }
        case 'withdraw': { const a = find(d.id); if (d.amount > a.balance) return { ok: false, error: 'Not enough money in the account' }; a.balance -= d.amount; this.cash += d.amount; return { ok: true, data: true }; }
        case 'transfer': { const a = find(d.from); if (d.amount > a.balance) return { ok: false, error: 'Not enough money in the account' }; a.balance -= d.amount; const b = find(d.to); if (b) b.balance += d.amount; return { ok: true, data: true }; }
        case 'open': { const id = this.accounts.length + 1; const n = 'WB-' + String(100000 + id * 7919).slice(0, 6); this.accounts.push({ id, number: n, label: d.label, type: d.type, balance: 0, role: 'owner', default: false, frozen: false, can: { deposit: true, withdraw: true, transfer: true, share: true, close: true } }); return { ok: true, data: { id, number: n } }; }
        case 'closeAccount': this.accounts = this.accounts.filter((a) => a.id !== d.id); return { ok: true, data: true };
        case 'access': return { ok: true, data: { roles: find(d.id).role === 'owner' ? ['view', 'deposit', 'withdraw', 'manager'] : ['view', 'deposit', 'withdraw'], people: [
          { charId: 10, name: 'Alex Moreno', role: find(d.id).role, me: true, editable: false },
          { charId: 11, name: 'Sam Carter', role: 'withdraw', me: false, editable: true },
          { charId: 12, name: 'Jo Lin', role: 'view', me: false, editable: true },
        ], pending: [] } };
        case 'nearby': return { ok: true, data: [{ src: 7, name: 'Riley Hayes', dist: 1.4 }] };
        case 'invite': return { ok: true, data: { name: 'Riley Hayes' } };
        case 'setRole': case 'revoke': return { ok: true, data: true };
        case 'close': S.open = false; return { ok: true };
        default: return { ok: true, data: true };
      }
    },
  };

  if (!RES) {
    // Opened in a browser: the English words (a copy of the keys the page uses) and example accounts.
    const EN = {
      ui_your_accounts: 'Your accounts', ui_on_hand: 'On hand', ui_open_account: 'Open an account', ui_open_sub: 'Savings or shared',
      ui_recent: 'Recent activity', ui_no_activity: 'No activity on this account yet', ui_no_accounts: 'You have no bank account yet', ui_loading: 'Loading…',
      ui_tab_deposit: 'Deposit', ui_tab_withdraw: 'Withdraw', ui_tab_transfer: 'Transfer', ui_tab_access: 'Access',
      ui_deposit_into: 'Deposit into %s', ui_withdraw_from: 'Withdraw from %s', ui_transfer_from: 'Transfer from %s', ui_all: 'All',
      ui_note: 'Note', ui_optional: 'Optional', ui_from: 'From', ui_to: 'To', ui_to_mine: 'My account', ui_to_number: 'Account number', ui_number_ph: 'WB-000000',
      ui_do_deposit: 'Deposit %s', ui_do_withdraw: 'Withdraw %s', ui_do_transfer: 'Transfer %s', ui_left_on_hand: 'Leaves %s on hand',
      ui_left_in_account: 'Leaves %s in the account', ui_not_enough_cash: 'You only carry %s', ui_not_enough_bal: 'The account only has %s',
      ui_confirm: 'Confirm', ui_cancel: 'Cancel', ui_working: 'One moment…', ui_done_deposit: 'Deposited %s', ui_done_withdraw: 'Withdrew %s',
      ui_done_transfer: 'Sent %s', ui_done_open: 'Account %s opened', ui_done_close: 'Account closed', ui_done_role: 'Access changed',
      ui_done_revoke: 'Removed from the account', ui_frozen: 'Frozen', ui_frozen_note: 'No money can go in or out of a frozen account.',
      ui_cant: 'Your access to this account does not allow this.', ui_close_account: 'Close account', ui_close_q: 'Close %s?',
      ui_close_empty: 'Empty it first: an account closes only with $0 in it.', ui_close_note: 'This can not be undone.',
      ui_people: 'People on this account', ui_add_person: 'Add someone next to you',
      ui_add_hint: 'They must be standing at the counter with you, and they say yes on their own screen.', ui_nobody_near: 'Nobody is standing next to you',
      ui_look_again: 'Look again', ui_ask: 'Ask', ui_remove: 'Remove', ui_you: '%s (you)', ui_access_as: 'Give them', ui_new_title: 'Open an account',
      ui_new_name: 'Name', ui_new_name_ph: 'Emergency fund', ui_new_type: 'Type', ui_open: 'Open account', ui_back: 'Back',
      ui_key_account: 'Account', ui_key_tab: 'Operation', ui_key_confirm: 'Confirm', ui_key_close: 'Leave',
      type_personal: 'Personal', type_savings: 'Savings', type_shared: 'Shared', type_business: 'Business', ui_default: 'Main',
      role_owner: 'Owner', role_manager: 'Manager', role_withdraw: 'Withdraw', role_deposit: 'Deposit', role_view: 'View only',
      tx_deposit: 'Deposit', tx_withdraw: 'Withdrawal', tx_transfer_in: 'Transfer in', tx_transfer_out: 'Transfer out', tx_payment: 'Payment',
      tx_from: 'From %s', tx_to: 'To %s', invite_sent: 'Asked %s. Waiting for their answer', bank_down: 'The bank is not answering, try again',
    };
    document.body.style.background = 'linear-gradient(180deg,#1b2230,#0b0e14)';
    Mock.post('state').then((r) => window.postMessage({ action: 'open', state: r.data, locale: EN, lang: 'en', quick: [100, 500, 1000, 5000] }, '*'));
  }
})();
