// Plant Care Assistant — all data stored in localStorage, no external dependencies.
const STORAGE_KEY = 'plantCareAssistant.plants';
const DAY_MS = 24 * 60 * 60 * 1000;

/** @typedef {{date:string, condition:string, notes:string}} HealthLogEntry */

let plants = loadPlants();

// ---------- Persistence ----------
function loadPlants() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function savePlants() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(plants));
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(dateISO, days) {
  const d = new Date(dateISO + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(fromISO, toISO) {
  return Math.round((new Date(toISO + 'T00:00:00') - new Date(fromISO + 'T00:00:00')) / DAY_MS);
}

// ---------- Care task definitions ----------
const CARE_TYPES = [
  { key: 'watering', label: 'Watering', icon: '💧' },
  { key: 'misting', label: 'Misting', icon: '🌫️' },
  { key: 'fertilizing', label: 'Fertilizing', icon: '🌱' },
];

function getNextDue(plant, key) {
  const interval = plant.intervals[key];
  if (!interval) return null;
  const last = plant.lastDone[key] || plant.createdAt;
  return addDays(last, interval);
}

function buildTasks() {
  const today = todayISO();
  const tasks = [];
  plants.filter(p => !p.archived).forEach(plant => {
    CARE_TYPES.forEach(({ key, label, icon }) => {
      const due = getNextDue(plant, key);
      if (!due) return;
      const diff = daysBetween(today, due);
      let bucket;
      if (diff < 0) bucket = 'overdue';
      else if (diff === 0) bucket = 'today';
      else if (diff <= 3) bucket = 'upcoming';
      else return;
      tasks.push({ plantId: plant.id, plantName: plant.name, key, label, icon, due, diff, bucket });
    });

    // Health check reminder
    const dueHealth = getNextDue(plant, 'healthCheck');
    if (dueHealth) {
      const diff = daysBetween(today, dueHealth);
      let bucket;
      if (diff < 0) bucket = 'overdue';
      else if (diff === 0) bucket = 'today';
      else if (diff <= 3) bucket = 'upcoming';
      else return;
      tasks.push({ plantId: plant.id, plantName: plant.name, key: 'healthCheck', label: 'Health Check', icon: '🔍', due: dueHealth, diff, bucket });
    }
  });
  tasks.sort((a, b) => a.diff - b.diff);
  return tasks;
}

// ---------- Rendering: Dashboard ----------
function renderDashboard() {
  const container = document.getElementById('taskGroups');
  const emptyState = document.getElementById('dashboardEmpty');
  const activePlants = plants.filter(p => !p.archived);

  if (activePlants.length === 0) {
    emptyState.classList.remove('hidden');
    container.innerHTML = '';
    updateDashboardBadge(0);
    return;
  }
  emptyState.classList.add('hidden');

  const tasks = buildTasks();
  updateDashboardBadge(tasks.filter(t => t.bucket === 'overdue' || t.bucket === 'today').length);
  const groups = [
    { key: 'overdue', title: 'Overdue' },
    { key: 'today', title: 'Due Today' },
    { key: 'upcoming', title: 'Upcoming (Next 3 Days)' },
  ];

  if (tasks.length === 0) {
    container.innerHTML = '<div class="empty-state">🎉 All caught up! No tasks due right now.</div>';
    return;
  }

  container.innerHTML = groups.map(group => {
    const groupTasks = tasks.filter(t => t.bucket === group.key);
    if (groupTasks.length === 0) return '';
    return `
      <div class="task-group ${group.key}">
        <h3>${group.title} (${groupTasks.length})</h3>
        ${groupTasks.map(taskCardHtml).join('')}
      </div>
    `;
  }).join('');

  container.querySelectorAll('.done-btn').forEach(btn => {
    btn.addEventListener('click', () => completeTask(btn.dataset.plantId, btn.dataset.key));
  });
  container.querySelectorAll('.snooze-btn').forEach(btn => {
    btn.addEventListener('click', () => snoozeTask(btn.dataset.plantId, btn.dataset.key));
  });
}

function taskCardHtml(task) {
  const dueLabel = task.diff < 0
    ? `${Math.abs(task.diff)} day(s) overdue`
    : task.diff === 0
      ? 'Due today'
      : `Due in ${task.diff} day(s)`;
  const healthAction = task.key === 'healthCheck'
    ? `<button class="done-btn" data-plant-id="${task.plantId}" data-key="healthCheck" onclick="openHealthModal('${task.plantId}')">${task.icon} Check</button>`
    : `<button class="done-btn" data-plant-id="${task.plantId}" data-key="${task.key}">${task.icon} Done</button>
       <button class="snooze-btn" data-plant-id="${task.plantId}" data-key="${task.key}">+1d</button>`;
  return `
    <div class="task-card">
      <div class="task-info">
        <span class="task-plant">${escapeHtml(task.plantName)}</span>
        <span class="task-type">${task.icon} ${task.label}</span>
        <span class="task-due">${dueLabel}</span>
      </div>
      <div class="task-actions">
        ${healthAction}
      </div>
    </div>
  `;
}

function completeTask(plantId, key) {
  if (key === 'healthCheck') return; // handled via modal
  const plant = plants.find(p => p.id === plantId);
  if (!plant) return;
  plant.lastDone[key] = todayISO();
  savePlants();
  renderAll();
  showToast(`${plant.name}: ${key} marked done ✔`);
}

function snoozeTask(plantId, key) {
  const plant = plants.find(p => p.id === plantId);
  if (!plant) return;
  const currentDue = getNextDue(plant, key);
  // Push the "last done" back by one day equivalent so next due becomes +1 day
  const last = plant.lastDone[key] || plant.createdAt;
  plant.lastDone[key] = addDays(last, 1);
  savePlants();
  renderAll();
  showToast(`${plant.name}: ${key} snoozed by 1 day`);
}

// ---------- Rendering: Plants list ----------
function renderPlantList() {
  const list = document.getElementById('plantList');
  const emptyState = document.getElementById('plantsEmpty');
  if (plants.length === 0) {
    emptyState.classList.remove('hidden');
    list.innerHTML = '';
    return;
  }
  emptyState.classList.add('hidden');

  list.innerHTML = plants.map(plant => {
    const petClass = plant.petSafety === 'Toxic to Pets' ? 'toxic' : plant.petSafety === 'Pet Friendly' ? 'safe' : 'unknown';
    return `
      <div class="plant-card" data-plant-id="${plant.id}">
        ${plant.archived ? '<span class="archived-badge">Archived</span>' : ''}
        <h3>${escapeHtml(plant.name)}</h3>
        ${plant.species ? `<p class="plant-meta">${escapeHtml(plant.species)}</p>` : ''}
        <p class="plant-meta">📍 ${escapeHtml(plant.location)} · ☀️ ${escapeHtml(plant.sunlight)}</p>
        <span class="pet-tag ${petClass}">${plant.petSafety === 'Toxic to Pets' ? '⚠ Toxic to Pets' : plant.petSafety === 'Pet Friendly' ? '✔ Pet Safe' : '? Unknown'}</span>
        <div class="plant-card-actions">
          <button class="edit-plant-btn" data-plant-id="${plant.id}" title="Edit" aria-label="Edit ${escapeHtml(plant.name)}">✏️</button>
          <button class="health-btn" data-plant-id="${plant.id}" title="Health Check" aria-label="Health check for ${escapeHtml(plant.name)}">🩺</button>
          <button class="delete-plant-btn" data-plant-id="${plant.id}" title="Delete" aria-label="Delete ${escapeHtml(plant.name)}">🗑</button>
        </div>
      </div>
    `;
  }).join('');

  list.querySelectorAll('.edit-plant-btn').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); openPlantModal(btn.dataset.plantId); });
  });
  list.querySelectorAll('.health-btn').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); openHealthModal(btn.dataset.plantId); });
  });
  list.querySelectorAll('.delete-plant-btn').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); deletePlant(btn.dataset.plantId); });
  });
}

function deletePlant(plantId) {
  const plant = plants.find(p => p.id === plantId);
  if (!plant) return;
  if (!confirm(`Delete "${plant.name}" permanently? This cannot be undone.`)) return;
  plants = plants.filter(p => p.id !== plantId);
  savePlants();
  renderAll();
  showToast('Plant deleted');
}

function renderAll() {
  renderDashboard();
  renderPlantList();
  checkAndNotify();
}

function updateDashboardBadge(count) {
  const badge = document.getElementById('dashboardBadge');
  badge.textContent = String(count);
  badge.classList.toggle('hidden', count === 0);
}

// ---------- Utility ----------
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.remove('hidden');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.add('hidden'), 2200);
}

// ---------- Tabs ----------
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});
document.querySelectorAll('[data-goto]').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.goto));
});

function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === tab));
}

// ---------- Plant modal (add/edit) ----------
const plantModal = document.getElementById('plantModal');
const plantForm = document.getElementById('plantForm');

document.getElementById('addPlantBtn').addEventListener('click', () => openPlantModal(null));
document.querySelectorAll('[data-close]').forEach(btn => {
  btn.addEventListener('click', () => document.getElementById(btn.dataset.close).classList.add('hidden'));
});

const presetSelect = document.getElementById('presetSelect');
PLANT_PRESETS.forEach(preset => {
  const opt = document.createElement('option');
  opt.value = preset.id;
  opt.textContent = preset.commonName;
  presetSelect.appendChild(opt);
});

presetSelect.addEventListener('change', () => {
  const preset = PLANT_PRESETS.find(p => p.id === presetSelect.value);
  if (!preset) return;
  const draft = presetToPlantDraft(preset);
  document.getElementById('plantName').value = draft.name;
  document.getElementById('plantSpecies').value = draft.species;
  document.getElementById('plantLocation').value = draft.location;
  document.getElementById('plantSunlight').value = draft.sunlight;
  document.getElementById('plantPetSafety').value = draft.petSafety;
  document.getElementById('wateringInterval').value = draft.intervals.watering;
  document.getElementById('mistingInterval').value = draft.intervals.misting ?? '';
  document.getElementById('fertilizingInterval').value = draft.intervals.fertilizing ?? '';
  document.getElementById('healthCheckInterval').value = draft.intervals.healthCheck;
  document.getElementById('plantNotes').value = draft.notes;
});

function openPlantModal(plantId) {
  const plant = plantId ? plants.find(p => p.id === plantId) : null;
  document.getElementById('plantModalTitle').textContent = plant ? 'Edit Plant' : 'Add Plant';
  document.getElementById('plantId').value = plant ? plant.id : '';
  document.getElementById('presetField').classList.toggle('hidden', !!plant);
  presetSelect.value = '';
  document.getElementById('plantName').value = plant ? plant.name : '';
  document.getElementById('plantSpecies').value = plant ? plant.species : '';
  document.getElementById('plantLocation').value = plant ? plant.location : 'Living Room';
  document.getElementById('plantSunlight').value = plant ? plant.sunlight : 'Bright Indirect';
  document.getElementById('plantPetSafety').value = plant ? plant.petSafety : 'Unknown';
  document.getElementById('wateringInterval').value = plant ? plant.intervals.watering : 7;
  document.getElementById('mistingInterval').value = plant && plant.intervals.misting ? plant.intervals.misting : '';
  document.getElementById('fertilizingInterval').value = plant && plant.intervals.fertilizing ? plant.intervals.fertilizing : '';
  document.getElementById('healthCheckInterval').value = plant ? plant.intervals.healthCheck : 14;
  document.getElementById('plantNotes').value = plant ? plant.notes : '';

  document.getElementById('deletePlantBtn').classList.toggle('hidden', !plant);
  document.getElementById('archivePlantBtn').classList.toggle('hidden', !plant);
  if (plant) {
    document.getElementById('archivePlantBtn').textContent = plant.archived ? 'Unarchive' : 'Archive';
  }

  plantModal.classList.remove('hidden');
}

plantForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const id = document.getElementById('plantId').value;
  const name = document.getElementById('plantName').value.trim();
  if (!name) return;

  const watering = parseInt(document.getElementById('wateringInterval').value, 10);
  const misting = document.getElementById('mistingInterval').value ? parseInt(document.getElementById('mistingInterval').value, 10) : null;
  const fertilizing = document.getElementById('fertilizingInterval').value ? parseInt(document.getElementById('fertilizingInterval').value, 10) : null;
  const healthCheck = parseInt(document.getElementById('healthCheckInterval').value, 10);

  if (id) {
    const plant = plants.find(p => p.id === id);
    plant.name = name;
    plant.species = document.getElementById('plantSpecies').value.trim();
    plant.location = document.getElementById('plantLocation').value;
    plant.sunlight = document.getElementById('plantSunlight').value;
    plant.petSafety = document.getElementById('plantPetSafety').value;
    plant.intervals = { watering, misting, fertilizing, healthCheck };
    plant.notes = document.getElementById('plantNotes').value.trim();
  } else {
    const now = todayISO();
    plants.push({
      id: uid(),
      name,
      species: document.getElementById('plantSpecies').value.trim(),
      location: document.getElementById('plantLocation').value,
      sunlight: document.getElementById('plantSunlight').value,
      petSafety: document.getElementById('plantPetSafety').value,
      intervals: { watering, misting, fertilizing, healthCheck },
      lastDone: { watering: now, misting: misting ? now : null, fertilizing: fertilizing ? now : null, healthCheck: now },
      notes: document.getElementById('plantNotes').value.trim(),
      healthLogs: [],
      archived: false,
      createdAt: now,
    });
  }

  savePlants();
  plantModal.classList.add('hidden');
  renderAll();
  showToast('Plant saved 🌿');
});

document.getElementById('deletePlantBtn').addEventListener('click', () => {
  const id = document.getElementById('plantId').value;
  if (!id) return;
  deletePlant(id);
  plantModal.classList.add('hidden');
});

document.getElementById('archivePlantBtn').addEventListener('click', () => {
  const id = document.getElementById('plantId').value;
  const plant = plants.find(p => p.id === id);
  if (!plant) return;
  plant.archived = !plant.archived;
  savePlants();
  plantModal.classList.add('hidden');
  renderAll();
  showToast(plant.archived ? 'Plant archived' : 'Plant unarchived');
});

// ---------- Health check modal ----------
const healthModal = document.getElementById('healthModal');
const healthForm = document.getElementById('healthForm');

function openHealthModal(plantId) {
  const plant = plants.find(p => p.id === plantId);
  if (!plant) return;
  document.getElementById('healthPlantId').value = plant.id;
  document.getElementById('healthDate').value = todayISO();
  document.getElementById('healthCondition').value = 'Healthy';
  document.getElementById('healthNotes').value = '';
  renderHealthHistory(plant);
  healthModal.classList.remove('hidden');
}
window.openHealthModal = openHealthModal;

function renderHealthHistory(plant) {
  const list = document.getElementById('healthHistoryList');
  if (!plant.healthLogs || plant.healthLogs.length === 0) {
    list.innerHTML = '<li>No health checks logged yet.</li>';
    return;
  }
  const sorted = [...plant.healthLogs].sort((a, b) => b.date.localeCompare(a.date));
  list.innerHTML = sorted.map(log => `
    <li><span class="condition-tag">${escapeHtml(log.condition)}</span>${log.date}${log.notes ? ' — ' + escapeHtml(log.notes) : ''}</li>
  `).join('');
}

healthForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const plantId = document.getElementById('healthPlantId').value;
  const plant = plants.find(p => p.id === plantId);
  if (!plant) return;
  const date = document.getElementById('healthDate').value || todayISO();
  const condition = document.getElementById('healthCondition').value;
  const notes = document.getElementById('healthNotes').value.trim();

  plant.healthLogs = plant.healthLogs || [];
  plant.healthLogs.push({ date, condition, notes });
  plant.lastDone.healthCheck = date;

  savePlants();
  renderHealthHistory(plant);
  renderAll();
  showToast('Health check saved 🔍');
});

// ---------- Export / Import ----------
document.getElementById('exportBtn').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(plants, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `plant-care-backup-${todayISO()}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

const importFile = document.getElementById('importFile');
document.getElementById('importBtn').addEventListener('click', () => importFile.click());
importFile.addEventListener('change', () => {
  const file = importFile.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!Array.isArray(data)) throw new Error('Invalid format');
      if (!confirm('Import will replace your current garden data. Continue?')) return;
      plants = data;
      savePlants();
      renderAll();
      showToast('Data imported successfully ✅');
    } catch {
      alert('Invalid backup file. Please select a valid JSON export.');
    } finally {
      importFile.value = '';
    }
  };
  reader.readAsText(file);
});

// ---------- Personalized greeting ----------
const USER_NAME_KEY = 'plantCareAssistant.userName';

function renderGreeting() {
  const name = localStorage.getItem(USER_NAME_KEY) || 'Appy';
  document.getElementById('greetingText').textContent = `Hi, ${name} 👋`;
}

document.getElementById('editNameBtn').addEventListener('click', () => {
  const current = localStorage.getItem(USER_NAME_KEY) || 'Appy';
  const next = prompt('What should we call you?', current);
  if (next === null) return;
  const trimmed = next.trim();
  if (!trimmed) return;
  localStorage.setItem(USER_NAME_KEY, trimmed);
  renderGreeting();
});

// ---------- Reminders (browser notifications) ----------
const NOTIFY_PREF_KEY = 'plantCareAssistant.notificationsEnabled';
const NOTIFIED_LOG_KEY = 'plantCareAssistant.notifiedLog';
const notifyBtn = document.getElementById('notifyBtn');

function notificationsEnabled() {
  return localStorage.getItem(NOTIFY_PREF_KEY) === 'true' && 'Notification' in window && Notification.permission === 'granted';
}

function updateNotifyBtnLabel() {
  const on = notificationsEnabled();
  notifyBtn.classList.toggle('active', on);
  notifyBtn.title = on ? 'Reminders: On (tap to turn off)' : 'Reminders: Off (tap to turn on)';
}

notifyBtn.addEventListener('click', async () => {
  if (!('Notification' in window)) {
    showToast('Notifications are not supported in this browser');
    return;
  }
  if (notificationsEnabled()) {
    localStorage.setItem(NOTIFY_PREF_KEY, 'false');
    updateNotifyBtnLabel();
    showToast('Reminders turned off');
    return;
  }
  const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  if (permission !== 'granted') {
    showToast('Notifications permission denied');
    return;
  }
  localStorage.setItem(NOTIFY_PREF_KEY, 'true');
  updateNotifyBtnLabel();
  showToast('Reminders turned on ✔');
  checkAndNotify();
});

// Tracks which task+due-date combos already fired a notification today, so we don't spam the user.
function loadNotifiedLog() {
  try {
    return JSON.parse(localStorage.getItem(NOTIFIED_LOG_KEY)) || {};
  } catch {
    return {};
  }
}

function saveNotifiedLog(log) {
  localStorage.setItem(NOTIFIED_LOG_KEY, JSON.stringify(log));
}

function checkAndNotify() {
  if (!notificationsEnabled()) return;
  const tasks = buildTasks().filter(t => t.bucket === 'overdue' || t.bucket === 'today');
  if (tasks.length === 0) return;

  const today = todayISO();
  const log = loadNotifiedLog();

  tasks.forEach(task => {
    const notifyKey = `${task.plantId}:${task.key}:${task.due}`;
    if (log[notifyKey] === today) return; // already notified today for this task/due-date

    const lateness = task.diff < 0 ? ` — ${Math.abs(task.diff)} day(s) overdue!` : ' — due today';
    const notification = new Notification(`${task.icon} ${task.label} reminder`, {
      body: `Time to ${task.label.toLowerCase()} your ${task.plantName}${lateness}`,
      tag: notifyKey,
    });
    notification.onclick = () => {
      window.focus();
      switchTab('dashboard');
      notification.close();
    };
    log[notifyKey] = today;
  });

  saveNotifiedLog(log);
}

// Re-check periodically while the tab is open/backgrounded, and whenever it regains focus.
setInterval(checkAndNotify, 5 * 60 * 1000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') checkAndNotify();
});

// ---------- Init ----------
updateNotifyBtnLabel();
renderGreeting();
renderAll();
