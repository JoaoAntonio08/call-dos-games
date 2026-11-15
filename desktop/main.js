// App de Windows do Call dos Games: uma janela própria que abre o site publicado.
// Como o conteúdo vem do site, o app se atualiza sozinho sempre que o site é republicado.
const { app, BrowserWindow, Menu, desktopCapturer, ipcMain, session, shell, clipboard } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const APP_URL = process.env.CDG_URL || "https://call-dos-games.vercel.app/app";
const APP_ORIGIN = new URL(APP_URL).origin;
// login com Google abre em janela própria do Google; o resto vai para o navegador
const POPUP_HOSTS = ["accounts.google.com"];

app.setAppUserModelId("com.calldosgames.app"); // notificações do Windows com nome e ícone certos

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
}

/** @type {BrowserWindow | null} */
let win = null;

/* ------------------------------------------------------------------ tamanho e posição da janela */
const stateFile = () => path.join(app.getPath("userData"), "janela.json");
function loadState() {
  try {
    return JSON.parse(fs.readFileSync(stateFile(), "utf8"));
  } catch {
    return { width: 1280, height: 800 };
  }
}
function saveState() {
  if (!win || win.isDestroyed()) return;
  const b = win.getNormalBounds();
  try {
    fs.writeFileSync(stateFile(), JSON.stringify({ ...b, maximized: win.isMaximized() }));
  } catch {
    /* sem problema */
  }
}

const isApp = (url) => {
  try {
    return new URL(url).origin === APP_ORIGIN;
  } catch {
    return false;
  }
};

/* ------------------------------------------------------------------ janela principal */
function createWindow() {
  const s = loadState();
  win = new BrowserWindow({
    x: s.x,
    y: s.y,
    width: s.width,
    height: s.height,
    minWidth: 940,
    minHeight: 560,
    title: "Call dos Games",
    backgroundColor: "#1f2023",
    icon: path.join(__dirname, "build", "icon-256.png"),
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      sandbox: true,
      spellcheck: true,
    },
  });
  if (s.maximized) win.maximize();
  win.once("ready-to-show", () => win.show());
  win.on("close", saveState);

  // links: os do app ficam aqui, login do Google abre em janelinha, o resto vai para o navegador
  win.webContents.setWindowOpenHandler(({ url }) => {
    const host = (() => {
      try {
        return new URL(url).hostname;
      } catch {
        return "";
      }
    })();
    if (POPUP_HOSTS.includes(host)) {
      return { action: "allow", overrideBrowserWindowOptions: { width: 500, height: 640, autoHideMenuBar: true, backgroundColor: "#ffffff" } };
    }
    if (isApp(url)) {
      win.loadURL(url);
      return { action: "deny" };
    }
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (isApp(url) || url.startsWith("file:")) return;
    e.preventDefault();
    if (/^https?:/.test(url)) shell.openExternal(url);
  });

  // sem internet ou site fora do ar: tela própria com "tentar de novo"
  win.webContents.on("did-fail-load", (_e, code, _desc, url, isMain) => {
    if (!isMain || code === -3) return; // -3 = navegação cancelada (normal)
    win.loadFile(path.join(__dirname, "offline.html"), { query: { voltar: url || APP_URL } });
  });

  // F5 recarrega, F11 tela cheia, Ctrl+Shift+I ferramentas (para ajudar a achar problema)
  win.webContents.on("before-input-event", (e, input) => {
    if (input.type !== "keyDown") return;
    if (input.key === "F5") {
      win.webContents.reload();
      e.preventDefault();
    } else if (input.key === "F11") {
      win.setFullScreen(!win.isFullScreen());
      e.preventDefault();
    } else if (input.control && input.shift && input.key.toLowerCase() === "i") {
      win.webContents.toggleDevTools();
      e.preventDefault();
    }
  });

  // menu do botão direito: copiar, colar, abrir link…
  win.webContents.on("context-menu", (_e, p) => {
    const items = [];
    if (p.linkURL) {
      items.push({ label: "Abrir link no navegador", click: () => shell.openExternal(p.linkURL) });
      items.push({ label: "Copiar link", click: () => clipboard.writeText(p.linkURL) });
    }
    if (p.hasImageContents && p.srcURL) items.push({ label: "Copiar imagem", click: () => win.webContents.copyImageAt(p.x, p.y) });
    if (p.misspelledWord && p.dictionarySuggestions.length) {
      if (items.length) items.push({ type: "separator" });
      for (const sug of p.dictionarySuggestions.slice(0, 4)) items.push({ label: sug, click: () => win.webContents.replaceMisspelling(sug) });
    }
    if (p.isEditable) {
      if (items.length) items.push({ type: "separator" });
      items.push({ label: "Recortar", role: "cut", enabled: p.editFlags.canCut });
      items.push({ label: "Copiar", role: "copy", enabled: p.editFlags.canCopy });
      items.push({ label: "Colar", role: "paste", enabled: p.editFlags.canPaste });
      items.push({ label: "Selecionar tudo", role: "selectAll" });
    } else if (p.selectionText) {
      items.push({ label: "Copiar", role: "copy" });
    }
    if (items.length) Menu.buildFromTemplate(items).popup({ window: win });
  });

  win.loadURL(APP_URL);
}

/* ------------------------------------------------------------------ compartilhar tela: seletor próprio */
/** Abre a janelinha de escolher tela/janela e devolve o id escolhido (ou null). */
function pickSource() {
  return new Promise((resolve) => {
    const picker = new BrowserWindow({
      parent: win,
      modal: true,
      width: 760,
      height: 560,
      resizable: false,
      minimizable: false,
      maximizable: false,
      title: "Compartilhar a tela",
      backgroundColor: "#1f2023",
      autoHideMenuBar: true,
      show: false,
      webPreferences: { preload: path.join(__dirname, "picker-preload.js"), contextIsolation: true, sandbox: true },
    });
    let done = false;
    const finish = (id) => {
      if (done) return;
      done = true;
      ipcMain.removeHandler("picker:sources");
      ipcMain.removeAllListeners("picker:choose");
      resolve(id);
      if (!picker.isDestroyed()) picker.close();
    };
    ipcMain.handle("picker:sources", async () => {
      const sources = await desktopCapturer.getSources({ types: ["screen", "window"], thumbnailSize: { width: 320, height: 180 }, fetchWindowIcons: true });
      return sources
        .filter((s) => !s.name.startsWith("Compartilhar a tela"))
        .map((s) => ({ id: s.id, name: s.name, screen: s.id.startsWith("screen:"), thumb: s.thumbnail.toDataURL(), icon: s.appIcon ? s.appIcon.toDataURL() : null }));
    });
    ipcMain.on("picker:choose", (_e, id) => finish(id || null));
    picker.on("closed", () => finish(null));
    picker.once("ready-to-show", () => picker.show());
    picker.loadFile(path.join(__dirname, "picker.html"));
  });
}

app.whenReady().then(() => {
  const ses = session.defaultSession;

  // microfone, câmera, notificações e tela só para o site do app
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    const ok = ["media", "notifications", "clipboard-read", "clipboard-sanitized-write", "fullscreen", "display-capture", "speaker-selection"];
    callback(isApp(details.requestingUrl || wc.getURL()) && ok.includes(permission));
  });
  ses.setPermissionCheckHandler((_wc, permission, origin) => origin === APP_ORIGIN || isApp(origin || ""));

  ses.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      const id = await pickSource();
      if (!id) return callback({});
      const [source] = (await desktopCapturer.getSources({ types: ["screen", "window"] })).filter((s) => s.id === id);
      if (!source) return callback({});
      // "loopback" = som do PC junto (só existe no Windows)
      callback(request.audioRequested ? { video: source, audio: "loopback" } : { video: source });
    } catch {
      callback({});
    }
  });

  createWindow();
});

app.on("window-all-closed", () => app.quit());
