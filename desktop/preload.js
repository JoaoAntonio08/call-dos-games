// Avisa o site que ele está rodando dentro do app de Windows, com a versão do app e o botão de atualizar.
const { contextBridge, ipcRenderer } = require("electron");

const arg = process.argv.find((a) => a.startsWith("--cdg-version="));

contextBridge.exposeInMainWorld("cdgDesktop", {
  app: "windows",
  version: process.versions.electron,
  appVersion: arg ? arg.slice("--cdg-version=".length) : "",
  update: (url) => ipcRenderer.invoke("cdg:update", url),
  onUpdateProgress: (cb) => {
    const f = (_e, pct) => cb(pct);
    ipcRenderer.on("cdg:update-progress", f);
    return () => ipcRenderer.removeListener("cdg:update-progress", f);
  },
  // jogo aberto no PC (só o nome do jogo reconhecido)
  onGame: (cb) => {
    const f = (_e, name) => cb(name);
    ipcRenderer.on("cdg:game", f);
    ipcRenderer.invoke("cdg:game-now").then(cb, () => {});
    return () => ipcRenderer.removeListener("cdg:game", f);
  },
  gameCandidates: () => ipcRenderer.invoke("cdg:game-candidates"),
  customGames: (list) => ipcRenderer.invoke("cdg:game-custom", list),
  // abrir com o Windows, abrir escondido e continuar em segundo plano ao fechar
  appPrefs: (patch) => ipcRenderer.invoke("cdg:app-prefs", patch),
  onTray: (cb) => {
    const f = (_e, what) => cb(what);
    ipcRenderer.on("cdg:tray", f);
    return () => ipcRenderer.removeListener("cdg:tray", f);
  },
  onClip: (cb) => {
    const f = () => cb();
    ipcRenderer.on("cdg:clip", f);
    return () => ipcRenderer.removeListener("cdg:clip", f);
  },
});
