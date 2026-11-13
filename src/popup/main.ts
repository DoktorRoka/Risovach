import type { ContentMessage, ContentResponse } from '../shared/messages';

const root = document.getElementById('app')!;

root.innerHTML = `
  <style>
    :root { color-scheme: light dark; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      width: 280px;
      font: 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif;
      background: #1e1f24;
      color: #e8e9ed;
    }
    .wrap { padding: 14px; display: flex; flex-direction: column; gap: 12px; }
    .title { font-size: 15px; font-weight: 600; letter-spacing: .2px; }
    .row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    label.toggle { display: flex; align-items: center; gap: 8px; cursor: pointer; user-select: none; }
    input[type="checkbox"] { accent-color: #6c7cff; width: 16px; height: 16px; }
    button, .file-btn {
      display: block;
      width: 100%;
      padding: 8px 10px;
      border: 1px solid #3a3d47;
      border-radius: 7px;
      background: #2a2d35;
      color: inherit;
      font: inherit;
      text-align: center;
      cursor: pointer;
    }
    button:hover, .file-btn:hover { background: #333742; }
    .file-btn input { display: none; }
    .status { font-size: 12px; color: #9aa0ad; min-height: 16px; }
    .hint { font-size: 11px; color: #7d8493; line-height: 1.45; }
    kbd { background: #2a2d35; border: 1px solid #3a3d47; border-radius: 4px; padding: 0 4px; font-size: 11px; }
  </style>
  <div class="wrap">
    <div class="title">Risovach</div>
    <label class="toggle"><input type="checkbox" id="enabled" /> Включить на этой вкладке</label>
    <label class="file-btn">Загрузить картинку<input type="file" id="file" accept="image/png,image/jpeg,image/webp,image/gif" /></label>
    <div class="status" id="status"></div>
    <div class="hint">
      Настройка — в плавающей панели на странице.<br />
      <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>L</kbd> — фиксация, <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>H</kbd> — скрыть/показать.
    </div>
  </div>
`;

const enabledInput = document.getElementById('enabled') as HTMLInputElement;
const fileInput = document.getElementById('file') as HTMLInputElement;
const statusEl = document.getElementById('status') as HTMLDivElement;

async function activeTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function send(message: ContentMessage): Promise<ContentResponse | null> {
  const tab = await activeTab();
  if (tab?.id === undefined) return null;
  try {
    return (await chrome.tabs.sendMessage(tab.id, message)) as ContentResponse;
  } catch {
    return null;
  }
}

function setStatus(text: string): void {
  statusEl.textContent = text;
}

async function init(): Promise<void> {
  const state = await send({ type: 'get-state' });
  if (!state) {
    setStatus('Расширение недоступно на этой странице');
    enabledInput.disabled = true;
    fileInput.disabled = true;
    return;
  }
  enabledInput.checked = state.enabled ?? true;
  setStatus(state.hasImage ? 'Картинка загружена' : 'Картинка не загружена');
}

enabledInput.addEventListener('change', async () => {
  const response = await send({ type: 'set-enabled', enabled: enabledInput.checked });
  setStatus(response?.ok ? (enabledInput.checked ? 'Включено' : 'Выключено') : 'Не удалось применить');
});

fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  const dataUrl = await readFile(file);
  const response = await send({ type: 'set-image', dataUrl });
  setStatus(response?.ok ? 'Картинка загружена' : response?.error ?? 'Не удалось загрузить картинку');
});

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

void init();