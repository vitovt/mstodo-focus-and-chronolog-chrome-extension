const STORAGE_KEY = 'kuro.logs';
const IDLE_LABEL = 'Idle';
const COL_START_W = 5;
const COL_NAME_W = 37;
const COL_SPENT_W = 7;

const pad2 = (n) => String(n).padStart(2, '0');
function todayKey(d = new Date()) {
  const y = d.getFullYear();
  const m = pad2(d.getMonth() + 1);
  const da = pad2(d.getDate());
  return `${y}-${m}-${da}`;
}
function fmtHHMM(ts) {
  const d = new Date(ts);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
function humanDur(ms) {
  const mins = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}
function padRightOrKeep(s, w) {
  s = (s ?? '').trim();
  return s.length >= w ? s : s + ' '.repeat(w - s.length);
}
function padLeft(s, w) {
  s = (s ?? '').trim();
  return s.length >= w ? s : ' '.repeat(w - s.length) + s;
}
function toMarkdown(daySessions, nowTs = Date.now()) {
  const lines = [];
  lines.push(`|Start| ${padRightOrKeep('Task name', COL_NAME_W - 1)}| Spent |`);
  lines.push(`|${'-'.repeat(COL_START_W)}|${'-'.repeat(COL_NAME_W)}|${'-'.repeat(COL_SPENT_W)}|`);

  for (const s of daySessions) {
    const start = fmtHHMM(s.start);
    const rawLabel = (s.label || IDLE_LABEL).trim();
    const nameCell = rawLabel.length <= COL_NAME_W ? padRightOrKeep(rawLabel, COL_NAME_W) : rawLabel;
    const endMs = (s.end != null ? s.end : nowTs) - s.start;
    const spentCell = padLeft(humanDur(endMs), COL_SPENT_W);
    lines.push(`|${start}|${nameCell}|${spentCell}|`);
  }
  return lines.join('\n');
}

function storageGet(keys) {
  return new Promise(resolve => chrome.storage.local.get(keys, resolve));
}
function storageSet(obj) {
  return new Promise(resolve => chrome.storage.local.set(obj, resolve));
}

async function resetTodayPreserveIdle() {
  const data = await storageGet([STORAGE_KEY]);
  const logs = data[STORAGE_KEY] || {};
  const key = todayKey();

  const now = Date.now();
  // Start fresh with Idle from now.
  logs[key] = [{ label: IDLE_LABEL, start: now }];
  await storageSet({ [STORAGE_KEY]: logs });
}

async function load() {
  const elDate = document.getElementById('date');
  const elCurrLabel = document.getElementById('curr-label');
  const elCurrSince = document.getElementById('curr-since');
  const elCurrElapsed = document.getElementById('curr-elapsed');
  const elMd = document.getElementById('md');
  const elDownload = document.getElementById('download');

  const nowTs = Date.now();
  const key = todayKey();
  elDate.textContent = key;

  const data = await storageGet([STORAGE_KEY]);
  const logs = data[STORAGE_KEY] || {};
  const day = logs[key] || [];

  // Determine current session (open last, or none)
  let curr = null;
  if (day.length > 0) {
    const last = day[day.length - 1];
    curr = { label: last.label || IDLE_LABEL, start: last.start, end: last.end ?? null };
  }

  if (curr) {
    elCurrLabel.textContent = curr.label;
    elCurrSince.textContent = fmtHHMM(curr.start);
    const durMs = (curr.end ?? nowTs) - curr.start;
    elCurrElapsed.textContent = humanDur(durMs);
  } else {
    elCurrLabel.textContent = IDLE_LABEL;
    elCurrSince.textContent = '—';
    elCurrElapsed.textContent = '—';
  }

  // Render Markdown table (use now for open session)
  const md = toMarkdown(day, nowTs);
  elMd.value = md;

  // Prepare download link
  const blob = new Blob([md], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  elDownload.href = url;
}

document.addEventListener('DOMContentLoaded', () => {
  const link = document.getElementById('mstodo-link');
  link.addEventListener('click', (e) => {
    console.log("open MsToDo link");
    e.preventDefault();            // prevent the popup from trying to navigate itself
    chrome.tabs.create({ url: link.href }); // open in a normal browser tab
  });
});


document.getElementById('copy').addEventListener('click', async () => {
  const txt = document.getElementById('md').value;
  try {
    await navigator.clipboard.writeText(txt);
    const btn = document.getElementById('copy');
    const old = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => (btn.textContent = old), 1200);
  } catch {
    // ignore
  }
});

document.getElementById('reset-today').addEventListener('click', async () => {
  await resetTodayPreserveIdle();
  await load();
});

load();

