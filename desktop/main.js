// App de Windows do Call dos Games: uma janela própria que abre o site publicado.
// Como o conteúdo vem do site, o app se atualiza sozinho sempre que o site é republicado.
const { app, BrowserWindow, Menu, desktopCapturer, globalShortcut, ipcMain, net, session, shell, clipboard } = require("electron");
const { execFile, spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const APP_URL = process.env.CDG_URL || "https://call.zapeu.net/app";
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
      // a versão do app vai para o site, que avisa quando tiver uma nova
      additionalArguments: [`--cdg-version=${app.getVersion()}`],
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
      const u = new URL(url);
      if (/^\/app(\/|$)/.test(u.pathname)) {
        // navega dentro do site já aberto: recarregar a janela derrubaria a call
        const p = JSON.stringify(u.pathname + u.search + u.hash);
        win.webContents
          .executeJavaScript(`window.__cdgOpen ? (window.__cdgOpen(${p}), true) : false`)
          .then((ok) => ok || win.loadURL(url))
          .catch(() => win.loadURL(url));
        return { action: "deny" };
      }
      // convite e outras páginas do site: janelinha separada, a principal (com a call) fica como está
      return { action: "allow", overrideBrowserWindowOptions: { width: 1000, height: 760, autoHideMenuBar: true, backgroundColor: "#1f2023" } };
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

  // Alt+Shift+C clipa o lance mesmo com o jogo na frente (o site decide se dá para clipar agora)
  try {
    globalShortcut.register("Alt+Shift+C", () => win?.webContents.send("cdg:clip"));
  } catch {
    /* outro programa já usa o atalho */
  }
});

app.on("will-quit", () => globalShortcut.unregisterAll());

/* ------------------------------------------------------------------ jogo aberto no PC */
// A cada 15 s olha a lista de programas abertos (só o nome) e avisa o site quando o jogo muda.
// Nada sai do PC além do nome do jogo reconhecido, e o site só manda se a pessoa deixar ligado.
const KNOWN = require("./jogos.js");
const customFile = () => path.join(app.getPath("userData"), "jogos-meus.json");
let custom = {};
try {
  custom = JSON.parse(fs.readFileSync(customFile(), "utf8")) || {};
} catch {
  custom = {};
}
let currentGame = null;

function tasklist(verbose) {
  return new Promise((resolve) => {
    execFile("tasklist", verbose ? ["/v", "/fo", "csv", "/nh"] : ["/fo", "csv", "/nh"], { windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, out) => {
      if (err) return resolve([]);
      resolve(
        out
          .split(/\r?\n/)
          .filter(Boolean)
          .map((line) => (line.match(/"([^"]*)"/g) || []).map((c) => c.slice(1, -1))),
      );
    });
  });
}

async function scanGame() {
  const rows = await tasklist(false);
  // os jogos que a pessoa adicionou têm preferência sobre a lista pronta
  const open = rows.map((r) => (r[0] || "").toLowerCase());
  const mine = open.find((exe) => custom[exe]);
  const known = open.find((exe) => KNOWN[exe]);
  const found = mine ? custom[mine] : known ? KNOWN[known] : null;
  if (found !== currentGame) {
    currentGame = found;
    if (win && !win.isDestroyed()) win.webContents.send("cdg:game", found);
  }
}

app.whenReady().then(() => {
  setTimeout(scanGame, 4000);
  setInterval(scanGame, 15000);
});

const fromApp = (e) => isApp(e.senderFrame?.url || "");

ipcMain.handle("cdg:game-now", (e) => (fromApp(e) ? currentGame : null));

// janelas abertas agora, para a pessoa escolher um jogo que a lista não conhece
ipcMain.handle("cdg:game-candidates", async (e) => {
  if (!fromApp(e)) return [];
  const rows = await tasklist(true);
  const skip = new Set(["explorer.exe", "call dos games.exe", "taskmgr.exe", "applicationframehost.exe", "textinputhost.exe", "systemsettings.exe", "searchhost.exe", "shellexperiencehost.exe", "startmenuexperiencehost.exe"]);
  const seen = new Map();
  for (const r of rows) {
    const exe = (r[0] || "").toLowerCase();
    const title = r[8] || "";
    if (!exe.endsWith(".exe") || skip.has(exe) || !title || title === "N/A" || title === "N/D" || seen.has(exe)) continue;
    seen.set(exe, { exe, title: title.slice(0, 120) });
  }
  return [...seen.values()].sort((a, b) => a.title.localeCompare(b.title));
});

ipcMain.handle("cdg:game-custom", (e, list) => {
  if (!fromApp(e)) throw new Error("origem");
  if (list !== undefined) {
    if (!Array.isArray(list)) throw new Error("lista");
    const next = {};
    for (const it of list.slice(0, 60)) {
      const exe = String(it?.exe || "").toLowerCase().trim();
      const name = String(it?.name || "").trim().slice(0, 80);
      if (/^[^\\/:*?"<>|]{1,80}\.exe$/.test(exe) && name) next[exe] = name;
    }
    custom = next;
    try {
      fs.writeFileSync(customFile(), JSON.stringify(custom));
    } catch {
      /* sem problema */
    }
    void scanGame();
  }
  return Object.entries(custom).map(([exe, name]) => ({ exe, name }));
});

/* ------------------------------------------------------------------ atualização */
// Só baixa instalador das versões publicadas do projeto no GitHub.
const RELEASES = "https://github.com/JoaoAntonio08/call-dos-games/releases/download/";
let updating = false;

ipcMain.handle("cdg:update", async (e, url) => {
  if (!isApp(e.senderFrame?.url || "")) throw new Error("origem");
  if (typeof url !== "string" || !url.startsWith(RELEASES) || !url.endsWith(".exe")) throw new Error("Endereço de atualização inválido.");
  if (updating) return "baixando";
  updating = true;
  try {
    const res = await net.fetch(url, { redirect: "follow" });
    if (!res.ok || !res.body) throw new Error(`download falhou (${res.status})`);
    const total = Number(res.headers.get("content-length")) || 0;
    const file = path.join(app.getPath("temp"), path.basename(new URL(url).pathname));
    const out = fs.createWriteStream(file);
    let got = 0;
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      got += value.length;
      if (!out.write(Buffer.from(value))) await new Promise((r) => out.once("drain", r));
      if (total) {
        const pct = got / total;
        win?.setProgressBar(pct);
        e.sender.send("cdg:update-progress", pct);
      }
    }
    await new Promise((r, j) => out.end((err) => (err ? j(err) : r())));
    win?.setProgressBar(-1);
    // instala por cima sem perguntar nada e abre o app de novo no fim
    spawn(file, ["/S", "--force-run"], { detached: true, stdio: "ignore" }).unref();
    setTimeout(() => app.quit(), 400);
    return "instalando";
  } catch (err) {
    updating = false;
    win?.setProgressBar(-1);
    throw err;
  }
});

app.on("window-all-closed", () => app.quit());
