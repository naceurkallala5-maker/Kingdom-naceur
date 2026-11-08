// Browser logic. Rule: every visible string comes from /locales/ar.json via t().
// Never assign literal text to the page here (enforced by tests/arabic-ui.test.js).

let STRINGS = {};

function lookup(key) {
  return key.split('.').reduce((obj, part) => (obj == null ? undefined : obj[part]), STRINGS);
}

function t(key, vars = {}) {
  const value = lookup(key);
  if (typeof value !== 'string') return lookup('errors.generic');
  return value.replace(/\{(\w+)\}/g, (_, name) => (vars[name] ?? ''));
}

const timeFmt = new Intl.DateTimeFormat('ar-u-nu-latn', {
  timeZone: 'Europe/Paris', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
});
const formatTime = (iso) => (iso ? timeFmt.format(new Date(iso)) : '');

function el(tag, { cls, text, attrs } = {}, children = []) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  if (attrs) for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  for (const child of children) if (child) node.append(child);
  return node;
}

function applyStaticStrings() {
  document.querySelectorAll('[data-i18n]').forEach((n) => { n.textContent = t(n.dataset.i18n); });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((n) => { n.placeholder = t(n.dataset.i18nPlaceholder); });
  const help = document.getElementById('help-items');
  help.replaceChildren(...lookup('help.items').map((item) => el('li', { text: item })));
}

async function api(path, options = {}) {
  let res;
  try {
    res = await fetch(path, { headers: { 'content-type': 'application/json' }, ...options });
  } catch {
    throw new Error('network');
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || 'generic');
  return body;
}

const errorText = (code) => (lookup(`errors.${code}`) ? t(`errors.${code}`) : t('errors.generic'));

// ---------------- Live Office Board ----------------

function renderAttention(items) {
  const box = document.getElementById('attention');
  if (!items.length) return box.replaceChildren(el('p', { cls: 'muted', text: t('board.attentionEmpty') }));
  box.replaceChildren(...items.map((a) => {
    const note = el('input', { cls: 'note', attrs: { type: 'text', placeholder: t('approval.notePlaceholder') } });
    const status = el('p', { cls: 'error', attrs: { hidden: '' } });
    const decide = async (decision) => {
      try {
        await api(`/api/approvals/${a.id}/decision`, { method: 'POST', body: JSON.stringify({ decision, note: note.value }) });
      } catch (err) {
        status.textContent = errorText(err.message);
        status.hidden = false;
      }
    };
    const button = (key, decision, cls) => {
      const b = el('button', { cls, text: t(key), attrs: { type: 'button' } });
      b.addEventListener('click', () => decide(decision));
      return b;
    };
    return el('article', { cls: 'attention-item' }, [
      el('div', { cls: 'attention-head' }, [
        el('span', { cls: 'chip', text: t(`approvalKind.${a.kind}`) }),
        el('h3', { text: a.title }),
      ]),
      el('p', { text: a.details }),
      el('p', { cls: 'meta', text: `${t('board.requestedBy')}: ${a.employee_name} · ${a.department} · ${t('board.waitingSince')} ${formatTime(a.created_at)}` }),
      a.task_title ? el('p', { cls: 'meta', text: `${t('board.relatedTask')}: ${a.task_title}` }) : null,
      note,
      el('div', { cls: 'actions' }, [
        button('approval.approve', 'approved', 'primary'),
        button('approval.changes', 'changes_requested', 'secondary'),
        button('approval.reject', 'rejected', 'danger'),
      ]),
      status,
    ]);
  }));
}

function renderEmployees(employees) {
  const grid = document.getElementById('employees');
  grid.replaceChildren(...employees.map((e) => el('article', { cls: `employee status-${e.status}` }, [
    el('div', { cls: 'employee-head' }, [
      el('h3', { text: e.name }),
      el('span', { cls: `status-badge status-${e.status}`, text: t(`status.${e.status}`) }),
    ]),
    el('p', { cls: 'role', text: e.title }),
    el('p', { cls: 'meta', text: `${e.department} · ${t('board.level')}: ${e.level}` }),
    el('p', { cls: 'meta', text: `${t('board.currentTask')}: ${e.currentTask ? e.currentTask.title : t('board.noTask')}` }),
    el('p', { cls: 'meta', text: [`${t('board.completed')}: ${e.completedTasks}`, e.since && `${t('board.since')} ${formatTime(e.since)}`].filter(Boolean).join(' · ') }),
  ])));
}

function renderTasks(tasks) {
  const box = document.getElementById('tasks');
  if (!tasks.length) return box.replaceChildren(el('p', { cls: 'muted', text: t('board.tasksEmpty') }));
  box.replaceChildren(...tasks.map((task) => el('article', { cls: 'task' }, [
    el('div', { cls: 'task-head' }, [
      el('h3', { text: task.title }),
      el('span', { cls: 'chip', text: t(`taskStatus.${task.status}`) }),
    ]),
    el('p', { text: task.objective }),
    el('p', { cls: 'meta', text: `${t('board.taskNumber', { id: task.id })} · ${t('board.assignedTo')}: ${task.employee_name} · ${task.department}` }),
  ])));
}

function describeEvent(ev) {
  const taskPart = ev.task_title ? t('events.taskPart', { task: ev.task_title }) : '';
  const status = ev.type === 'approval_decided' ? t(`decision.${ev.status}`) : (ev.status ? t(`status.${ev.status}`) : '');
  return t(`events.${ev.type}`, { name: ev.employee_name ?? '', task: ev.task_title ?? '', status, taskPart });
}

function renderActivity(activity) {
  const list = document.getElementById('activity');
  if (!activity.length) return list.replaceChildren(el('li', { cls: 'muted', text: t('board.activityEmpty') }));
  list.replaceChildren(...activity.map((ev) => el('li', {}, [
    el('span', { cls: 'time', text: formatTime(ev.created_at) }),
    el('span', { text: describeEvent(ev) }),
    ev.note ? el('span', { cls: 'meta', text: ev.note }) : null,
  ])));
}

async function refreshBoard() {
  try {
    const data = await api('/api/board');
    renderAttention(data.attention);
    renderEmployees(data.employees);
    renderTasks(data.tasks);
    renderActivity(data.activity);
  } catch { /* the live indicator reports connection problems */ }
}

// ---------------- Executive chat ----------------

function renderMessages(messages) {
  const box = document.getElementById('messages');
  if (!messages.length) return box.replaceChildren(el('p', { cls: 'muted', text: t('chat.empty') }));
  box.replaceChildren(...messages.map((m) => el('div', { cls: `message ${m.role}` }, [
    el('span', { cls: 'who', text: [t(`chat.${m.role}`), formatTime(m.created_at)].join(' · ') }),
    el('p', { text: m.content }),
  ])));
  box.scrollTop = box.scrollHeight;
}

async function refreshChat() {
  try {
    const data = await api('/api/chat');
    renderMessages(data.messages);
  } catch { /* handled by live indicator */ }
}

function setupChat() {
  const form = document.getElementById('chat-form');
  const input = document.getElementById('chat-input');
  const sendBtn = document.getElementById('chat-send');
  const error = document.getElementById('chat-error');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    error.hidden = true;
    const text = input.value.trim();
    if (!text) {
      error.textContent = errorText('empty_message');
      error.hidden = false;
      return;
    }
    sendBtn.disabled = true;
    sendBtn.textContent = t('chat.sending');
    try {
      await api('/api/chat', { method: 'POST', body: JSON.stringify({ text }) });
      input.value = '';
    } catch (err) {
      if (err.message === 'em_not_configured') input.value = '';
      error.textContent = errorText(err.message);
      error.hidden = false;
    } finally {
      sendBtn.disabled = false;
      sendBtn.textContent = t('chat.send');
      refreshChat();
    }
  });
}

// ---------------- Navigation & live updates ----------------

function setupTabs() {
  document.querySelectorAll('.tab').forEach((tab) => tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === tab));
    document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${tab.dataset.view}`));
  }));
}

function connectLive() {
  const live = document.getElementById('live');
  const source = new EventSource('/api/events');
  source.addEventListener('hello', () => {
    live.textContent = t('board.live');
    live.classList.remove('down');
    refreshBoard();
    refreshChat();
  });
  source.addEventListener('change', () => { refreshBoard(); refreshChat(); });
  source.onerror = () => {
    live.textContent = t('board.offline');
    live.classList.add('down');
  };
}

async function main() {
  STRINGS = await (await fetch('/locales/ar.json')).json();
  applyStaticStrings();
  setupTabs();
  setupChat();
  await Promise.all([refreshBoard(), refreshChat()]);
  connectLive();
}

main();
