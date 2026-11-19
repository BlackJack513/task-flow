'use strict';

const { app, BrowserWindow, Menu, ipcMain, screen, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const APP_NAME = 'TaskFlow';
const MAX_DATA_BYTES = 8 * 1024 * 1024;
const DEFAULT_WINDOW = Object.freeze({ width: 1380, height: 860 });

// A private data directory is useful for UI review and automated checks.
if (process.env.TASKFLOW_DATA_DIR) {
  const customDataDir = path.resolve(process.env.TASKFLOW_DATA_DIR);
  fs.mkdirSync(customDataDir, { recursive: true });
  app.setPath('userData', customDataDir);
}

let mainWindow = null;
let dataFile = '';
let backupFile = '';
let windowStateFile = '';

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(bootstrap).catch((error) => {
    console.error('[TaskFlow] Failed to start:', error);
    app.quit();
  });

  app.on('window-all-closed', () => {
    app.quit();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
}

function setupStorePaths() {
  const dataDir = app.getPath('userData');
  fs.mkdirSync(dataDir, { recursive: true });
  dataFile = path.join(dataDir, 'taskflow-data.json');
  backupFile = path.join(dataDir, 'taskflow-data.backup.json');
  windowStateFile = path.join(dataDir, 'taskflow-window.json');
}

async function bootstrap() {
  app.setAppUserModelId('com.taskflow.desktop');
  Menu.setApplicationMenu(null);
  setupStorePaths();
  registerIpcHandlers();
  createMainWindow();
}

function createMainWindow() {
  const saved = readWindowState();
  const bounds = resolveWindowBounds(saved);
  const isWindows = process.platform === 'win32';
  const captureMode = Boolean(process.env.TASKFLOW_CAPTURE);

  const windowOptions = {
    ...bounds,
    minWidth: 1000,
    minHeight: 640,
    show: false,
    backgroundColor: '#f3f0e9',
    title: '任务看板 · TaskFlow',
    autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'build', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  };

  if (isWindows) {
    windowOptions.titleBarStyle = 'hidden';
    windowOptions.titleBarOverlay = {
      color: '#f3f0e9',
      symbolColor: '#334552',
      height: 46
    };
  }

  mainWindow = new BrowserWindow(windowOptions);

  if (isWindows && !captureMode) {
    mainWindow.once('ready-to-show', () => {
      if (saved.maximized) {
        mainWindow.maximize();
      }
      mainWindow.show();
    });
  } else {
    mainWindow.once('ready-to-show', () => {
      if (saved.maximized && !captureMode) mainWindow.maximize();
      mainWindow.show();
      if (captureMode) mainWindow.focus();
    });
  }

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event) => {
    event.preventDefault();
  });

  mainWindow.on('close', () => {
    saveWindowState();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  if (captureMode) {
    scheduleCapture();
  }
}

function registerIpcHandlers() {
  ipcMain.handle('taskflow:load', async () => {
    return loadBoardData();
  });

  ipcMain.on('taskflow:save', (event, payload) => {
    try {
      const result = saveBoardData(payload);
      event.returnValue = result;
    } catch (error) {
      console.error('[TaskFlow] Save failed:', error);
      event.returnValue = {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  });

  ipcMain.handle('taskflow:info', () => ({
    ok: true,
    version: app.getVersion(),
    dataDir: app.getPath('userData')
  }));

  ipcMain.handle('taskflow:open-data-folder', async () => {
    try {
      if (fs.existsSync(dataFile)) {
        shell.showItemInFolder(dataFile);
      } else {
        await shell.openPath(app.getPath('userData'));
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.on('taskflow:toggle-maximize', () => {
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validatePayload(payload) {
  if (!isPlainObject(payload)) {
    throw new Error('看板数据格式不正确');
  }
  if (!Array.isArray(payload.tasks)) {
    throw new Error('看板数据缺少任务列表');
  }
  if (payload.tasks.length > 50000) {
    throw new Error('任务数量超出支持范围');
  }

  const serialized = JSON.stringify(payload);
  if (Buffer.byteLength(serialized, 'utf8') > MAX_DATA_BYTES) {
    throw new Error('看板数据过大');
  }
  return serialized;
}

function readJsonFile(filePath) {
  const stat = fs.statSync(filePath);
  if (stat.size > MAX_DATA_BYTES) {
    throw new Error('数据文件过大');
  }
  const raw = fs.readFileSync(filePath, 'utf8');
  const data = JSON.parse(raw);
  if (!isPlainObject(data) || !Array.isArray(data.tasks)) {
    throw new Error('数据文件格式不正确');
  }
  return data;
}

function loadBoardData() {
  let primaryError = null;

  if (fs.existsSync(dataFile)) {
    try {
      return {
        ok: true,
        data: readJsonFile(dataFile),
        recovered: false
      };
    } catch (error) {
      primaryError = error;
      console.error('[TaskFlow] Primary data file could not be read:', error);
    }
  }

  if (fs.existsSync(backupFile)) {
    try {
      return {
        ok: true,
        data: readJsonFile(backupFile),
        recovered: true,
        warning: '主数据文件异常，已自动读取最近的本地备份。'
      };
    } catch (error) {
      console.error('[TaskFlow] Backup data file could not be read:', error);
    }
  }

  if (primaryError) {
    // Never overwrite a broken data file without keeping a copy first.
    try {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const quarantine = path.join(app.getPath('userData'), `taskflow-data.corrupt-${stamp}.json`);
      fs.copyFileSync(dataFile, quarantine);
      return {
        ok: true,
        data: null,
        recovered: false,
        warning: '原数据文件无法读取，已另存一份异常文件，并从空看板开始。'
      };
    } catch (error) {
      console.error('[TaskFlow] Could not quarantine corrupted data:', error);
      return {
        ok: false,
        data: null,
        error: '数据文件无法读取，且无法创建异常备份。'
      };
    }
  }

  return {
    ok: true,
    data: null,
    recovered: false
  };
}

function saveBoardData(payload) {
  const serialized = validatePayload(payload);
  fs.mkdirSync(path.dirname(dataFile), { recursive: true });

  if (fs.existsSync(dataFile)) {
    try {
      fs.copyFileSync(dataFile, backupFile);
    } catch (error) {
      console.error('[TaskFlow] Could not refresh backup:', error);
    }
  }

  const tempFile = `${dataFile}.${process.pid}.tmp`;
  fs.writeFileSync(tempFile, serialized, 'utf8');

  try {
    fs.renameSync(tempFile, dataFile);
  } catch (error) {
    // Windows can briefly reject a replace if a virus scanner is reading the file.
    if (process.platform === 'win32') {
      try {
        fs.rmSync(dataFile, { force: true });
        fs.renameSync(tempFile, dataFile);
      } catch (retryError) {
        try { fs.rmSync(tempFile, { force: true }); } catch { /* ignore */ }
        throw retryError;
      }
    } else {
      try { fs.rmSync(tempFile, { force: true }); } catch { /* ignore */ }
      throw error;
    }
  }

  return { ok: true, savedAt: new Date().toISOString() };
}

function readWindowState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(windowStateFile, 'utf8'));
    if (!isPlainObject(parsed)) return {};
    const state = {};
    for (const key of ['x', 'y', 'width', 'height']) {
      if (Number.isFinite(parsed[key])) state[key] = Math.round(parsed[key]);
    }
    state.maximized = parsed.maximized === true;
    return state;
  } catch {
    return {};
  }
}

function resolveWindowBounds(saved) {
  const width = clampNumber(saved.width, 1000, 3840, DEFAULT_WINDOW.width);
  const height = clampNumber(saved.height, 640, 2160, DEFAULT_WINDOW.height);
  const hasPosition = Number.isFinite(saved.x) && Number.isFinite(saved.y);

  if (hasPosition) {
    const visible = screen.getAllDisplays().some((display) => {
      const area = display.workArea;
      const overlapX = Math.max(0, Math.min(saved.x + width, area.x + area.width) - Math.max(saved.x, area.x));
      const overlapY = Math.max(0, Math.min(saved.y + height, area.y + area.height) - Math.max(saved.y, area.y));
      return overlapX >= 120 && overlapY >= 80;
    });
    if (visible) {
      return { x: saved.x, y: saved.y, width, height };
    }
  }

  return { width, height, center: true };
}

function saveWindowState() {
  if (!mainWindow || mainWindow.isDestroyed() || !windowStateFile) return;
  try {
    const bounds = mainWindow.getNormalBounds();
    const state = {
      ...bounds,
      maximized: mainWindow.isMaximized()
    };
    fs.writeFileSync(windowStateFile, JSON.stringify(state), 'utf8');
  } catch (error) {
    console.error('[TaskFlow] Could not save window state:', error);
  }
}

function clampNumber(value, min, max, fallback) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function scheduleCapture() {
  const target = path.resolve(process.env.TASKFLOW_CAPTURE);
  const captureWidth = clampNumber(Number(process.env.TASKFLOW_CAPTURE_WIDTH), 1000, 3840, 1440);
  const captureHeight = clampNumber(Number(process.env.TASKFLOW_CAPTURE_HEIGHT), 640, 2160, 900);

  mainWindow.setContentSize(captureWidth, captureHeight);

  mainWindow.webContents.once('did-finish-load', () => {
    setTimeout(async () => {
      try {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        const image = await mainWindow.webContents.capturePage();
        fs.writeFileSync(target, image.toPNG());
        console.log(`[TaskFlow] Captured ${target}`);
      } catch (error) {
        console.error('[TaskFlow] Capture failed:', error);
      } finally {
        app.quit();
      }
    }, 1400);
  });
}
