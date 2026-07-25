import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("db", {
  load: () => ipcRenderer.invoke("db:load"),
  save: (state) => ipcRenderer.invoke("db:save", state),
  exportBackup: () => ipcRenderer.invoke("db:export"),
  importBackup: () => ipcRenderer.invoke("db:import"),
  importMergeBackup: () => ipcRenderer.invoke("db:importMerge"),
  getAppVersion: () => ipcRenderer.invoke("db:version"),
  getTheme: () => ipcRenderer.invoke("prefs:getTheme"),
  setTheme: (theme) => ipcRenderer.invoke("prefs:setTheme", theme),
  isElectron: true,
});
