'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('taskflow', {
  isDesktop: true,
  platform: process.platform,
  load: () => ipcRenderer.invoke('taskflow:load'),
  save: (payload) => ipcRenderer.sendSync('taskflow:save', payload),
  info: () => ipcRenderer.invoke('taskflow:info'),
  openDataFolder: () => ipcRenderer.invoke('taskflow:open-data-folder'),
  toggleMaximize: () => ipcRenderer.send('taskflow:toggle-maximize')
});
