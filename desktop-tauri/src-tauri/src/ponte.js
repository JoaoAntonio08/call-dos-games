// Ponte entre o site e o app de Windows (Tauri). O site só conversa com `window.cdgDesktop`,
// igual ao app antigo em Electron, então nada muda no site.
// Só vale dentro do site da turma: em qualquer outra página nada disso existe.
(() => {
  if (location.origin !== "__ORIGEM__") return;
  const T = () => window.__TAURI__;
  const inv = (cmd, args) => T().core.invoke(cmd, args);
  // devolve "parar de ouvir" na hora, mesmo que o Tauri responda depois
  const on = (evento, cb) => {
    let off = null;
    let morto = false;
    T()
      .event.listen(evento, (e) => cb(e.payload))
      .then((u) => (morto ? u() : (off = u)))
      .catch(() => {});
    return () => {
      morto = true;
      if (off) off();
    };
  };

  Object.defineProperty(window, "cdgDesktop", {
    configurable: false,
    value: Object.freeze({
      app: "windows",
      version: "tauri",
      appVersion: "__VERSAO__",
      update: (url) => inv("cdg_update", { url }),
      onUpdateProgress: (cb) => on("cdg:update-progress", cb),
      // jogo aberto no PC (só o nome do jogo reconhecido)
      onGame: (cb) => {
        const off = on("cdg:game", cb);
        inv("cdg_game_now").then(cb, () => {});
        return off;
      },
      gameCandidates: () => inv("cdg_game_candidates"),
      customGames: (list) => inv("cdg_game_custom", { list: list === undefined ? null : list }),
      // abrir com o Windows, abrir escondido e continuar em segundo plano ao fechar
      appPrefs: (patch) => inv("cdg_app_prefs", { patch: patch === undefined ? null : patch }),
      onTray: (cb) => on("cdg:tray", cb),
      onClip: (cb) => on("cdg:clip", () => cb()),
    }),
  });

  // Notificações do site viram notificações do Windows com o nome e o ícone do app
  class Aviso {
    static get permission() {
      return "granted";
    }
    static requestPermission(cb) {
      if (typeof cb === "function") cb("granted");
      return Promise.resolve("granted");
    }
    constructor(title, opts = {}) {
      this.title = String(title ?? "");
      this.body = String(opts.body ?? "");
      this.onclick = null;
      this.onclose = null;
      this.onerror = null;
      this.onshow = null;
      inv("cdg_notify", { title: this.title, body: this.body }).catch(() => {});
    }
    close() {}
    addEventListener() {}
    removeEventListener() {}
  }
  try {
    Object.defineProperty(window, "Notification", { configurable: true, writable: true, value: Aviso });
  } catch {
    /* fica a do navegador */
  }

  // F5 recarrega, F11 tela cheia, Ctrl+Shift+I ferramentas (para ajudar a achar problema)
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "F5") {
        e.preventDefault();
        location.reload();
      } else if (e.key === "F11") {
        e.preventDefault();
        inv("cdg_fullscreen").catch(() => {});
      } else if (e.ctrlKey && e.shiftKey && (e.key === "I" || e.key === "i")) {
        e.preventDefault();
        inv("cdg_devtools").catch(() => {});
      }
    },
    true,
  );
})();
