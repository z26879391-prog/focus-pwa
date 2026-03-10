// ── Storage ──────────────────────────────────────────────────────────────
const DB = {
  get: (k, def) => { try { return JSON.parse(localStorage.getItem(k)) ?? def; } catch { return def; } },
  set: (k, v) => localStorage.setItem(k, JSON.stringify(v)),
};

// ── State ─────────────────────────────────────────────────────────────────
let todos = DB.get('todos', []);
let sessions = DB.get('sessions', []);
let settings = DB.get('settings', { focus: 25, break: 5, long: 15 });
let currentTaskId = DB.get('currentTaskId', null);

// ── Timer State Persistence (daily reset) ─────────────────────────────────
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function loadTimerState() {
  const saved = DB.get('timerState', null);
  const today = todayStr();

  // If saved state exists and is from today, restore it
  if (saved && saved.date === today) {
    return {
      running: false, // never restore as running (page was closed)
      mode: saved.mode || 'focus',
      pomodoroCount: saved.pomodoroCount || 0,
      remaining: saved.remaining ?? settings.focus * 60,
      total: saved.total ?? settings.focus * 60,
      interval: null,
      date: today,
    };
  }

  // New day → reset
  return {
    running: false,
    mode: 'focus',
    pomodoroCount: 0,
    remaining: settings.focus * 60,
    total: settings.focus * 60,
    interval: null,
    date: today,
  };
}

function saveTimerState() {
  DB.set('timerState', {
    date: todayStr(),
    mode: timerState.mode,
    pomodoroCount: timerState.pomodoroCount,
    remaining: timerState.remaining,
    total: timerState.total,
  });
}

let timerState = loadTimerState();

let reviewWeekOffset = 0; // 0 = this week, -1 = last week, etc.

// ── Save ──────────────────────────────────────────────────────────────────
function save() {
  DB.set('todos', todos);
  DB.set('sessions', sessions);
  DB.set('settings', settings);
  DB.set('currentTaskId', currentTaskId);
}

// ── Navigation ────────────────────────────────────────────────────────────
document.querySelectorAll('.nav-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    const pageId = 'page-' + tab.dataset.page;
    document.getElementById(pageId).classList.add('active');
    if (tab.dataset.page === 'review') renderReview();
    if (tab.dataset.page === 'todos' || tab.dataset.page === 'timer') renderTodos();
  });
});

// ── Timer Logic ───────────────────────────────────────────────────────────
const CIRCUMFERENCE = 2 * Math.PI * 100; // ~628
const ringProgress = document.getElementById('ringProgress');
const timerDisplay = document.getElementById('timerDisplay');
const sessionDisplay = document.getElementById('sessionDisplay');
const timerCard = document.getElementById('timerCard');
const modeLabel = document.getElementById('modeLabel');
const btnStart = document.getElementById('btnStart');

function formatTime(s) {
  const m = Math.floor(s / 60).toString().padStart(2, '0');
  const sec = (s % 60).toString().padStart(2, '0');
  return `${m}:${sec}`;
}

function updateRing() {
  const pct = timerState.remaining / timerState.total;
  const offset = CIRCUMFERENCE * (1 - pct);
  ringProgress.style.strokeDashoffset = offset;
}

function updateTimerUI() {
  timerDisplay.textContent = formatTime(timerState.remaining);
  updateRing();

  const isBreak = timerState.mode !== 'focus';
  timerCard.classList.toggle('break-mode', isBreak);

  if (timerState.mode === 'focus') {
    modeLabel.textContent = '專注時間';
    sessionDisplay.textContent = `第 ${timerState.pomodoroCount + 1} 個蕃茄`;
  } else if (timerState.mode === 'break') {
    modeLabel.textContent = '短暫休息';
    sessionDisplay.textContent = `第 ${timerState.pomodoroCount} 個蕃茄 完成`;
  } else {
    modeLabel.textContent = '長休息';
    sessionDisplay.textContent = `完成 ${timerState.pomodoroCount} 個蕃茄！`;
  }

  btnStart.textContent = timerState.running ? '暫停' : '開始';
  document.title = timerState.running
    ? `${formatTime(timerState.remaining)} · Focus`
    : 'Focus · 蕃茄鐘';
}

function startTimer() {
  if (timerState.running) return;
  timerState.running = true;
  timerState.interval = setInterval(() => {
    timerState.remaining--;
    updateTimerUI();
    // Save every 5 seconds to avoid excessive writes
    if (timerState.remaining % 5 === 0) saveTimerState();
    if (timerState.remaining <= 0) {
      clearInterval(timerState.interval);
      timerState.running = false;
      saveTimerState();
      onTimerEnd();
    }
  }, 1000);
  updateTimerUI();
}

function pauseTimer() {
  clearInterval(timerState.interval);
  timerState.running = false;
  updateTimerUI();
  saveTimerState();
}

function resetTimer() {
  clearInterval(timerState.interval);
  timerState.running = false;
  timerState.remaining = getModeDuration();
  timerState.total = timerState.remaining;
  updateTimerUI();
  saveTimerState();
}

function getModeDuration(mode) {
  mode = mode || timerState.mode;
  if (mode === 'focus') return settings.focus * 60;
  if (mode === 'break') return settings.break * 60;
  return settings.long * 60;
}

function onTimerEnd() {
  playBell();
  sendNotification();

  if (timerState.mode === 'focus') {
    timerState.pomodoroCount++;
    // Show session log modal
    openSessionModal();
  } else {
    // After break, go back to focus
    switchMode('focus');
  }
}

function switchMode(mode) {
  timerState.mode = mode;
  timerState.remaining = getModeDuration(mode);
  timerState.total = timerState.remaining;
  updateTimerUI();
  saveTimerState();
}

function skipTimer() {
  clearInterval(timerState.interval);
  timerState.running = false;
  if (timerState.mode === 'focus') {
    timerState.pomodoroCount++;
    openSessionModal();
  } else {
    switchMode('focus');
  }
}

document.getElementById('btnStart').addEventListener('click', () => {
  if (timerState.running) pauseTimer();
  else startTimer();
});

document.getElementById('btnReset').addEventListener('click', resetTimer);
document.getElementById('btnSkip').addEventListener('click', skipTimer);

// ── Settings Modal ────────────────────────────────────────────────────────
['setFocus', 'setBreak', 'setLong'].forEach(id => {
  document.getElementById(id).addEventListener('click', openSettings);
});

function openSettings() {
  document.getElementById('inputFocus').value = settings.focus;
  document.getElementById('inputBreak').value = settings.break;
  document.getElementById('inputLong').value = settings.long;
  document.getElementById('settingsModal').classList.add('visible');
}

document.getElementById('cancelSettings').addEventListener('click', () => {
  document.getElementById('settingsModal').classList.remove('visible');
});

document.getElementById('saveSettings').addEventListener('click', () => {
  const f = parseInt(document.getElementById('inputFocus').value) || 25;
  const b = parseInt(document.getElementById('inputBreak').value) || 5;
  const l = parseInt(document.getElementById('inputLong').value) || 15;
  settings = {
    focus: Math.min(99, Math.max(1, f)),
    break: Math.min(99, Math.max(1, b)),
    long: Math.min(99, Math.max(1, l)),
  };
  document.getElementById('valFocus').textContent = settings.focus;
  document.getElementById('valBreak').textContent = settings.break;
  document.getElementById('valLong').textContent = settings.long;
  save();
  if (!timerState.running) resetTimer();
  document.getElementById('settingsModal').classList.remove('visible');
});

// Close modal on overlay click
document.getElementById('settingsModal').addEventListener('click', e => {
  if (e.target === document.getElementById('settingsModal'))
    document.getElementById('settingsModal').classList.remove('visible');
});

// ── Session Modal ─────────────────────────────────────────────────────────
let pendingSessionTaskId = null;

function openSessionModal() {
  pendingSessionTaskId = currentTaskId;
  // Render task chips
  const chips = document.getElementById('modalTaskChips');
  chips.innerHTML = '';
  const activeTodos = todos.filter(t => !t.done);
  if (activeTodos.length === 0) {
    chips.innerHTML = '<span style="font-size:12px;color:var(--muted);font-style:italic;">目前沒有待辦任務</span>';
  } else {
    activeTodos.forEach(t => {
      const chip = document.createElement('div');
      chip.className = 'task-chip' + (t.id === pendingSessionTaskId ? ' selected' : '');
      chip.textContent = t.text;
      chip.addEventListener('click', () => {
        pendingSessionTaskId = t.id;
        chips.querySelectorAll('.task-chip').forEach(c => c.classList.remove('selected'));
        chip.classList.add('selected');
      });
      chips.appendChild(chip);
    });
  }
  document.getElementById('sessionNote').value = '';

  // Determine next mode
  const nextMode = timerState.pomodoroCount % 4 === 0 ? 'long' : 'break';
  document.getElementById('sessionModal').classList.add('visible');

  // Auto-switch to break after save/skip
  document.getElementById('sessionModal').dataset.nextMode = nextMode;
}

function closeSessionModal(save) {
  const modal = document.getElementById('sessionModal');
  if (save) {
    const note = document.getElementById('sessionNote').value.trim();
    const taskId = pendingSessionTaskId;
    const task = todos.find(t => t.id === taskId);
    const session = {
      id: Date.now(),
      ts: Date.now(),
      taskId: taskId || null,
      taskText: task ? task.text : '未分類',
      note: note,
      duration: settings.focus,
    };
    sessions.push(session);
    // Increment pomodoro count on task
    if (task) {
      task.pomodoros = (task.pomodoros || 0) + 1;
    }
    DB.set('sessions', sessions);
    DB.set('todos', todos);
    renderTodos();
  }
  const nextMode = modal.dataset.nextMode || 'break';
  modal.classList.remove('visible');
  switchMode(nextMode);
}

document.getElementById('skipSession').addEventListener('click', () => closeSessionModal(false));
document.getElementById('saveSession').addEventListener('click', () => closeSessionModal(true));
document.getElementById('sessionModal').addEventListener('click', e => {
  if (e.target === document.getElementById('sessionModal')) closeSessionModal(false);
});

// ── Task Select Modal ─────────────────────────────────────────────────────
document.getElementById('currentTaskBanner').addEventListener('click', openTaskSelect);

function openTaskSelect() {
  const chips = document.getElementById('taskSelectChips');
  chips.innerHTML = '';
  const activeTodos = todos.filter(t => !t.done);
  if (activeTodos.length === 0) {
    chips.innerHTML = '<span style="font-size:12px;color:var(--muted);font-style:italic;">請先新增待辦任務</span>';
  } else {
    activeTodos.forEach(t => {
      const chip = document.createElement('div');
      chip.className = 'task-chip' + (t.id === currentTaskId ? ' selected' : '');
      chip.textContent = t.text;
      chip.addEventListener('click', () => {
        currentTaskId = t.id;
        save();
        updateCurrentTaskBanner();
        document.getElementById('taskSelectModal').classList.remove('visible');
      });
      chips.appendChild(chip);
    });
  }
  document.getElementById('taskSelectModal').classList.add('visible');
}

document.getElementById('cancelTaskSelect').addEventListener('click', () => {
  document.getElementById('taskSelectModal').classList.remove('visible');
});

document.getElementById('clearCurrentTask').addEventListener('click', () => {
  currentTaskId = null;
  save();
  updateCurrentTaskBanner();
  document.getElementById('taskSelectModal').classList.remove('visible');
});

document.getElementById('taskSelectModal').addEventListener('click', e => {
  if (e.target === document.getElementById('taskSelectModal'))
    document.getElementById('taskSelectModal').classList.remove('visible');
});

function updateCurrentTaskBanner() {
  const el = document.getElementById('currentTaskText');
  const task = todos.find(t => t.id === currentTaskId && !t.done);
  if (task) {
    el.textContent = task.text;
    el.classList.remove('empty');
  } else {
    currentTaskId = null;
    el.textContent = '點擊選擇當前任務…';
    el.classList.add('empty');
  }
}

// ── Todos ─────────────────────────────────────────────────────────────────
function addTodo(text) {
  if (!text.trim()) return;
  const todo = {
    id: Date.now(),
    text: text.trim(),
    done: false,
    createdAt: Date.now(),
    pomodoros: 0,
  };
  todos.unshift(todo);
  save();
  renderTodos();
}

function toggleTodo(id) {
  const t = todos.find(t => t.id === id);
  if (t) {
    t.done = !t.done;
    if (t.done && currentTaskId === id) {
      currentTaskId = null;
      save();
      updateCurrentTaskBanner();
    }
    save();
    renderTodos();
  }
}

function deleteTodo(id) {
  todos = todos.filter(t => t.id !== id);
  if (currentTaskId === id) {
    currentTaskId = null;
    updateCurrentTaskBanner();
  }
  save();
  renderTodos();
}

function renderTodos() {
  updateCurrentTaskBanner();

  ['todoListTimer', 'todoListMain'].forEach(listId => {
    const list = document.getElementById(listId);
    if (!list) return;
    list.innerHTML = '';

    const sorted = [...todos].sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1;
      return b.createdAt - a.createdAt;
    });

    if (sorted.length === 0) {
      list.innerHTML = '<div class="empty-state">還沒有任務<br>新增一個開始專注吧</div>';
      return;
    }

    sorted.forEach(todo => {
      const item = document.createElement('div');
      item.className = 'todo-item' + (todo.done ? ' done' : '') + (todo.id === currentTaskId ? ' active-task' : '');

      const check = document.createElement('div');
      check.className = 'todo-check';
      check.innerHTML = todo.done ? '✓' : '';
      check.addEventListener('click', e => { e.stopPropagation(); toggleTodo(todo.id); });

      const text = document.createElement('div');
      text.className = 'todo-item-text';
      text.textContent = todo.text;

      const poms = document.createElement('div');
      poms.className = 'todo-pomodoros';
      poms.textContent = todo.pomodoros > 0 ? '🍅'.repeat(Math.min(todo.pomodoros, 5)) + (todo.pomodoros > 5 ? ` ×${todo.pomodoros}` : '') : '';

      const del = document.createElement('button');
      del.className = 'todo-delete';
      del.innerHTML = '×';
      del.addEventListener('click', e => { e.stopPropagation(); deleteTodo(todo.id); });

      item.addEventListener('click', () => {
        if (!todo.done) {
          currentTaskId = todo.id;
          save();
          renderTodos();
        }
      });

      item.appendChild(check);
      item.appendChild(text);
      item.appendChild(poms);
      item.appendChild(del);
      list.appendChild(item);
    });
  });
}

// Add todo inputs
function setupTodoInput(btnId, rowId, inputId, confirmId) {
  document.getElementById(btnId).addEventListener('click', () => {
    const row = document.getElementById(rowId);
    row.classList.toggle('visible');
    if (row.classList.contains('visible')) document.getElementById(inputId).focus();
  });
  document.getElementById(confirmId).addEventListener('click', () => {
    const input = document.getElementById(inputId);
    addTodo(input.value);
    input.value = '';
    document.getElementById(rowId).classList.remove('visible');
  });
  document.getElementById(inputId).addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      addTodo(e.target.value);
      e.target.value = '';
      document.getElementById(rowId).classList.remove('visible');
    }
    if (e.key === 'Escape') {
      document.getElementById(rowId).classList.remove('visible');
    }
  });
}

setupTodoInput('addTodoTimer', 'todoInputRowTimer', 'todoInputTimer', 'confirmTodoTimer');
setupTodoInput('addTodoMain', 'todoInputRowMain', 'todoInputMain', 'confirmTodoMain');

// ── Weekly Review ─────────────────────────────────────────────────────────
function getWeekRange(offset) {
  const now = new Date();
  const day = now.getDay(); // 0=Sun
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - day + (day === 0 ? -6 : 1) + offset * 7);
  startOfWeek.setHours(0, 0, 0, 0);
  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(startOfWeek.getDate() + 6);
  endOfWeek.setHours(23, 59, 59, 999);
  return { start: startOfWeek, end: endOfWeek };
}

function formatWeekLabel(offset) {
  if (offset === 0) return '本週';
  if (offset === -1) return '上週';
  const { start, end } = getWeekRange(offset);
  const fmt = d => `${d.getMonth() + 1}/${d.getDate()}`;
  return `${fmt(start)} – ${fmt(end)}`;
}

function renderReview() {
  const { start, end } = getWeekRange(reviewWeekOffset);
  document.getElementById('weekLabel').textContent = formatWeekLabel(reviewWeekOffset);

  const weekSessions = sessions.filter(s => s.ts >= start.getTime() && s.ts <= end.getTime());
  const completedTasks = todos.filter(t => t.done).length; // simplified

  document.getElementById('statPomodoros').textContent = weekSessions.length;
  document.getElementById('statMinutes').textContent = weekSessions.reduce((a, s) => a + (s.duration || 25), 0);
  document.getElementById('statTasks').textContent = weekSessions.filter(s => s.note).length;

  const list = document.getElementById('sessionsList');
  list.innerHTML = '';

  if (weekSessions.length === 0) {
    list.innerHTML = '<div class="empty-state">這週還沒有記錄<br><span style="font-size:11px;opacity:0.6">完成蕃茄鐘後會自動記錄在這裡</span></div>';
    return;
  }

  // Group by day
  const groups = {};
  weekSessions.slice().reverse().forEach(s => {
    const d = new Date(s.ts);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    if (!groups[key]) groups[key] = { label: formatDayLabel(d), items: [] };
    groups[key].items.push(s);
  });

  Object.values(groups).forEach(group => {
    const label = document.createElement('div');
    label.className = 'day-group-label';
    label.textContent = group.label;
    list.appendChild(label);

    group.items.forEach(s => {
      const item = document.createElement('div');
      item.className = 'session-item';
      const d = new Date(s.ts);
      const timeStr = `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;
      item.innerHTML = `
        <div class="session-header">
          <div class="session-task">${s.taskText || '未分類'}</div>
          <div class="session-time">${timeStr} · ${s.duration || 25}m</div>
        </div>
        ${s.note ? `<div class="session-note">${escapeHtml(s.note)}</div>` : ''}
      `;
      list.appendChild(item);
    });
  });
}

function formatDayLabel(d) {
  const days = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];
  const today = new Date();
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  if (isSameDay(d, today)) return '今天';
  if (isSameDay(d, yesterday)) return '昨天';
  return `${days[d.getDay()]} ${d.getMonth() + 1}/${d.getDate()}`;
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
}

document.getElementById('prevWeek').addEventListener('click', () => { reviewWeekOffset--; renderReview(); });
document.getElementById('nextWeek').addEventListener('click', () => {
  if (reviewWeekOffset < 0) { reviewWeekOffset++; renderReview(); }
});

// ── Notifications ─────────────────────────────────────────────────────────
async function requestNotificationPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    await Notification.requestPermission();
  }
}

function sendNotification() {
  if ('Notification' in window && Notification.permission === 'granted') {
    const msg = timerState.mode === 'focus'
      ? `🍅 蕃茄鐘完成！休息一下吧。`
      : `⏰ 休息結束，繼續加油！`;
    new Notification('Focus · 蕃茄鐘', { body: msg, icon: 'icon-192.png' });
  }
}

// ── Sound ─────────────────────────────────────────────────────────────────
function playBell() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.5);
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.5);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 1.5);
  } catch (e) {}
}

// ── PWA Install ───────────────────────────────────────────────────────────
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredPrompt = e;
  document.getElementById('installBanner').classList.add('show');
});

document.getElementById('installBtn').addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  const result = await deferredPrompt.userChoice;
  deferredPrompt = null;
  document.getElementById('installBanner').classList.remove('show');
});

document.getElementById('closeBanner').addEventListener('click', () => {
  document.getElementById('installBanner').classList.remove('show');
});

// ── Service Worker ────────────────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').then(() => {
    console.log('SW registered');
  }).catch(e => console.log('SW error', e));
}

// ── Init ──────────────────────────────────────────────────────────────────
document.getElementById('valFocus').textContent = settings.focus;
document.getElementById('valBreak').textContent = settings.break;
document.getElementById('valLong').textContent = settings.long;
// timerState already loaded from localStorage (with daily reset logic)
updateTimerUI();
renderTodos();
requestNotificationPermission();
