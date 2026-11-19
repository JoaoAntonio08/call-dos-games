// App de Windows do Call dos Games, em Rust (Tauri): uma janela leve que abre o site publicado.
// Como o conteúdo vem do site, o app se atualiza sozinho sempre que o site é republicado.
// Só esta casca (bandeja, jogos abertos, abrir com o Windows) precisa de instalador novo.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod jogos;

use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashSet};
use std::fs;
use std::io::{Read, Write};
use std::os::windows::process::CommandExt;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering::SeqCst};
use std::sync::Mutex;
use std::time::Duration;
use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System};
use tauri::ipc::CapabilityBuilder;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::webview::{NewWindowResponse, PermissionKind, PermissionResponse};
use tauri::window::{Color, ProgressBarState, ProgressBarStatus};
use tauri::{AppHandle, Emitter, Manager, Url, Webview, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent, Wry};
use tauri_plugin_autostart::ManagerExt as _;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_opener::OpenerExt;

/// Só baixa instalador das versões publicadas do projeto no GitHub.
const RELEASES: &str = "https://github.com/JoaoAntonio08/call-dos-games/releases/download/";
/// Login com Google abre na janelinha do próprio Google; o resto de fora vai para o navegador.
const POPUP_HOSTS: &[&str] = &["accounts.google.com"];
const SEM_JANELA: u32 = 0x0800_0000; // CREATE_NO_WINDOW: comandos auxiliares sem piscar janela preta

/* ------------------------------------------------------------------ preferências e estado */

/// startup: abrir junto com o Windows; hidden: nesse caso, abrir só na bandeja;
/// background: o X esconde a janela e a call continua (fecha de vez pela bandeja)
#[derive(Clone, Serialize, Deserialize)]
#[serde(default)]
struct Prefs {
    startup: bool,
    hidden: bool,
    background: bool,
}
impl Default for Prefs {
    fn default() -> Self {
        Self { startup: false, hidden: false, background: true }
    }
}

#[derive(Serialize, Deserialize, Default)]
#[serde(default)]
struct Janela {
    x: Option<f64>,
    y: Option<f64>,
    width: Option<f64>,
    height: Option<f64>,
    maximized: bool,
}

#[derive(Serialize)]
struct Meu {
    exe: String,
    name: String,
}

#[derive(Serialize)]
struct Candidato {
    exe: String,
    title: String,
}

struct Estado {
    site: Url,
    origem: String,
    dir: PathBuf,
    prefs: Mutex<Prefs>,
    meus: Mutex<BTreeMap<String, String>>,
    jogo: Mutex<Option<String>>,
    /// true quando a pessoa mandou fechar de vez (bandeja, atualização)
    fechando: AtomicBool,
    avisou_bandeja: AtomicBool,
    atualizando: AtomicBool,
}

impl Estado {
    fn arquivo(&self, nome: &str) -> PathBuf {
        self.dir.join(nome)
    }
    fn do_site(&self, url: &Url) -> bool {
        url.origin().ascii_serialization() == self.origem
    }
}

fn ler<T: for<'de> Deserialize<'de> + Default>(p: &PathBuf) -> T {
    fs::read_to_string(p).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

fn gravar<T: Serialize>(p: &PathBuf, v: &T) {
    if let Ok(s) = serde_json::to_string(v) {
        let _ = fs::write(p, s);
    }
}

/// Quem já usava o app antigo (Electron) mantém as opções, os jogos adicionados e o tamanho da janela.
fn trazer_do_app_antigo(dir: &PathBuf) {
    let Some(appdata) = std::env::var_os("APPDATA") else { return };
    let antigo = PathBuf::from(appdata).join("Call dos Games");
    for nome in ["app.json", "jogos-meus.json", "janela.json"] {
        let novo = dir.join(nome);
        if !novo.exists() {
            let _ = fs::copy(antigo.join(nome), novo);
        }
    }
}

/// Chamadas do site só valem vindas do próprio site da turma.
fn so_do_site(wv: &Webview, e: &Estado) -> Result<(), String> {
    match wv.url() {
        Ok(u) if e.do_site(&u) => Ok(()),
        _ => Err("origem".into()),
    }
}

/* ------------------------------------------------------------------ janela */

fn mostrar(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

fn guardar_janela(w: &WebviewWindow, e: &Estado) {
    let mut j: Janela = ler(&e.arquivo("janela.json"));
    j.maximized = w.is_maximized().unwrap_or(false);
    if !j.maximized && !w.is_minimized().unwrap_or(false) {
        if let (Ok(f), Ok(p), Ok(s)) = (w.scale_factor(), w.outer_position(), w.inner_size()) {
            let p = p.to_logical::<f64>(f);
            let s = s.to_logical::<f64>(f);
            j.x = Some(p.x);
            j.y = Some(p.y);
            j.width = Some(s.width);
            j.height = Some(s.height);
        }
    }
    gravar(&e.arquivo("janela.json"), &j);
}

/// O canto da janela salva ainda cai em algum monitor? (monitor desligado: abre no meio da tela)
fn na_tela(app: &AppHandle, x: f64, y: f64) -> bool {
    app.available_monitors()
        .map(|ms| {
            ms.iter().any(|m| {
                let f = m.scale_factor();
                let p = m.position().to_logical::<f64>(f);
                let s = m.size().to_logical::<f64>(f);
                x + 60.0 >= p.x && x <= p.x + s.width - 60.0 && y + 10.0 >= p.y && y <= p.y + s.height - 60.0
            })
        })
        .unwrap_or(false)
}

fn fechar_de_vez(app: &AppHandle) {
    let e = app.state::<Estado>();
    e.fechando.store(true, SeqCst);
    if let Some(w) = app.get_webview_window("main") {
        guardar_janela(&w, &e);
    }
    app.exit(0);
}

/// Navegação na janela principal: só o site da turma; o resto abre no navegador.
fn navegar(app: &AppHandle, url: &Url) -> bool {
    if matches!(url.scheme(), "tauri" | "about" | "data" | "blob") || url.host_str() == Some("tauri.localhost") {
        return true;
    }
    if app.state::<Estado>().do_site(url) {
        return true;
    }
    if matches!(url.scheme(), "http" | "https") {
        let _ = app.opener().open_url(url.as_str(), None::<&str>);
    }
    false
}

/// window.open e links em nova aba.
fn nova_janela(app: &AppHandle, url: Url) -> NewWindowResponse<Wry> {
    // login do Google (a janelinha começa em branco e depois vai para o Google)
    if url.as_str() == "about:blank" || url.host_str().is_some_and(|h| POPUP_HOSTS.contains(&h)) {
        return NewWindowResponse::Allow;
    }
    if app.state::<Estado>().do_site(&url) {
        if url.path() == "/app" || url.path().starts_with("/app/") {
            // navega dentro do site já aberto: recarregar a janela derrubaria a call
            let mut caminho = url.path().to_string();
            if let Some(q) = url.query() {
                caminho.push('?');
                caminho.push_str(q);
            }
            if let Some(f) = url.fragment() {
                caminho.push('#');
                caminho.push_str(f);
            }
            let caminho = serde_json::to_string(&caminho).unwrap_or_default();
            let completo = serde_json::to_string(url.as_str()).unwrap_or_default();
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.eval(format!("window.__cdgOpen ? window.__cdgOpen({caminho}) : location.assign({completo})"));
            }
            mostrar(app);
            return NewWindowResponse::Deny;
        }
        // convite e outras páginas do site: janelinha separada, a principal (com a call) fica como está
        return NewWindowResponse::Allow;
    }
    if matches!(url.scheme(), "http" | "https") {
        let _ = app.opener().open_url(url.as_str(), None::<&str>);
    }
    NewWindowResponse::Deny
}

fn criar_janela(app: &AppHandle, mostrar_agora: bool) -> tauri::Result<WebviewWindow> {
    let e = app.state::<Estado>();
    let j: Janela = ler(&e.arquivo("janela.json"));
    let ponte = include_str!("ponte.js")
        .replace("__ORIGEM__", &e.origem)
        .replace("__VERSAO__", env!("CARGO_PKG_VERSION"));
    let (h_nav, h_nova) = (app.clone(), app.clone());
    let origem = e.origem.clone();

    let mut b = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
        .title("Call dos Games")
        .inner_size(j.width.unwrap_or(1280.0).max(940.0), j.height.unwrap_or(800.0).max(560.0))
        .min_inner_size(940.0, 560.0)
        .background_color(Color(0x1f, 0x20, 0x23, 0xff))
        .visible(false)
        .initialization_script(ponte)
        .on_navigation(move |url| navegar(&h_nav, url))
        .on_new_window(move |url, _| nova_janela(&h_nova, url))
        // microfone, câmera, tela e notificações só para o site do app
        .on_permission_request(move |wv, tipo| {
            let do_site = wv.url().is_ok_and(|u| u.origin().ascii_serialization() == origem);
            let ok = matches!(
                tipo,
                PermissionKind::Microphone
                    | PermissionKind::Camera
                    | PermissionKind::DisplayCapture
                    | PermissionKind::Notifications
                    | PermissionKind::ClipboardRead
                    | PermissionKind::Autoplay
                    | PermissionKind::WindowManagement
            );
            if do_site && ok {
                PermissionResponse::Allow
            } else {
                PermissionResponse::Default
            }
        });
    b = match (j.x, j.y) {
        (Some(x), Some(y)) if na_tela(app, x, y) => b.position(x, y),
        _ => b.center(),
    };
    let w = b.build()?;
    if mostrar_agora {
        let _ = w.show();
        if j.maximized {
            let _ = w.maximize();
        }
    }
    Ok(w)
}

/* ------------------------------------------------------------------ bandeja e avisos */

fn criar_bandeja(app: &AppHandle) -> tauri::Result<()> {
    let abrir = MenuItem::with_id(app, "abrir", "Abrir o Call dos Games", true, None::<&str>)?;
    let sair_call = MenuItem::with_id(app, "sair-call", "Sair da call", true, None::<&str>)?;
    let linha = PredefinedMenuItem::separator(app)?;
    let fechar = MenuItem::with_id(app, "fechar", "Fechar de vez", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&abrir, &sair_call, &linha, &fechar])?;
    let mut t = TrayIconBuilder::with_id("bandeja")
        .tooltip("Call dos Games")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, ev| match ev.id().as_ref() {
            "abrir" => mostrar(app),
            "sair-call" => {
                let _ = app.emit("cdg:tray", "leave");
            }
            "fechar" => fechar_de_vez(app),
            _ => {}
        })
        .on_tray_icon_event(|t, ev| match ev {
            TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. }
            | TrayIconEvent::DoubleClick { button: MouseButton::Left, .. } => mostrar(t.app_handle()),
            _ => {}
        });
    if let Some(icone) = app.default_window_icon() {
        t = t.icon(icone.clone());
    }
    t.build(app)?;
    Ok(())
}

fn avisar(app: &AppHandle, titulo: &str, texto: &str) {
    let _ = app.notification().builder().title(titulo).body(texto).show();
}

fn aplicar_inicio(app: &AppHandle, ligar: bool) {
    let al = app.autolaunch();
    // só mexe no registro quando muda de verdade
    if al.is_enabled().unwrap_or(false) != ligar {
        let _ = if ligar { al.enable() } else { al.disable() };
    }
}

/* ------------------------------------------------------------------ jogo aberto no PC */
// A cada 15 s olha a lista de programas abertos (só o nome) e avisa o site quando o jogo muda.
// Nada sai do PC além do nome do jogo reconhecido, e o site só manda se a pessoa deixar ligado.

fn nomes_abertos(sys: &mut System) -> HashSet<String> {
    sys.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::nothing());
    sys.processes().values().map(|p| p.name().to_string_lossy().to_lowercase()).collect()
}

fn escanear(app: &AppHandle, sys: &mut System) {
    let abertos = nomes_abertos(sys);
    let e = app.state::<Estado>();
    // os jogos que a pessoa adicionou têm preferência sobre a lista pronta
    let achado = {
        let meus = e.meus.lock().unwrap();
        meus.iter().find(|(exe, _)| abertos.contains(*exe)).map(|(_, n)| n.clone())
    }
    .or_else(|| jogos::CONHECIDOS.iter().find(|(exe, _)| abertos.contains(*exe)).map(|(_, n)| n.to_string()));
    let mut atual = e.jogo.lock().unwrap();
    if *atual != achado {
        atual.clone_from(&achado);
        drop(atual);
        let _ = app.emit("cdg:game", achado);
    }
}

fn vigiar_jogos(app: AppHandle) {
    std::thread::spawn(move || {
        let Ok(mut sys) = System::new() else { return };
        std::thread::sleep(Duration::from_secs(4));
        loop {
            escanear(&app, &mut sys);
            std::thread::sleep(Duration::from_secs(15));
        }
    });
}

/// Janelas visíveis com título: (id do processo, título)
fn janelas_abertas() -> Vec<(u32, String)> {
    use windows_sys::Win32::Foundation::{HWND, LPARAM};
    use windows_sys::Win32::UI::WindowsAndMessaging::{EnumWindows, GetWindowTextLengthW, GetWindowTextW, GetWindowThreadProcessId, IsWindowVisible};

    unsafe extern "system" fn cada(h: HWND, l: LPARAM) -> i32 {
        let lista = unsafe { &mut *(l as *mut Vec<(u32, String)>) };
        unsafe {
            if IsWindowVisible(h) == 0 {
                return 1;
            }
            let n = GetWindowTextLengthW(h);
            if n <= 0 {
                return 1;
            }
            let mut buf = vec![0u16; n as usize + 1];
            let lidos = GetWindowTextW(h, buf.as_mut_ptr(), buf.len() as i32).max(0) as usize;
            let mut pid = 0u32;
            GetWindowThreadProcessId(h, &mut pid);
            lista.push((pid, String::from_utf16_lossy(&buf[..lidos])));
        }
        1
    }
    let mut lista: Vec<(u32, String)> = Vec::new();
    unsafe {
        EnumWindows(Some(cada), &mut lista as *mut _ as LPARAM);
    }
    lista
}

/* ------------------------------------------------------------------ comandos que o site chama */

#[tauri::command]
fn cdg_site(estado: tauri::State<Estado>) -> String {
    estado.site.to_string()
}

#[tauri::command]
fn cdg_app_prefs(app: AppHandle, webview: Webview, estado: tauri::State<Estado>, patch: Option<serde_json::Value>) -> Result<Prefs, String> {
    so_do_site(&webview, &estado)?;
    let mut p = estado.prefs.lock().unwrap();
    if let Some(serde_json::Value::Object(m)) = patch {
        let b = |k: &str| m.get(k).and_then(|v| v.as_bool());
        if let Some(v) = b("startup") {
            p.startup = v;
        }
        if let Some(v) = b("hidden") {
            p.hidden = v;
        }
        if let Some(v) = b("background") {
            p.background = v;
        }
        gravar(&estado.arquivo("app.json"), &*p);
        aplicar_inicio(&app, p.startup);
    }
    Ok(p.clone())
}

#[tauri::command]
fn cdg_game_now(webview: Webview, estado: tauri::State<Estado>) -> Option<String> {
    so_do_site(&webview, &estado).ok()?;
    estado.jogo.lock().unwrap().clone()
}

/// Janelas abertas agora, para a pessoa escolher um jogo que a lista não conhece.
#[tauri::command]
async fn cdg_game_candidates(webview: Webview, estado: tauri::State<'_, Estado>) -> Result<Vec<Candidato>, String> {
    so_do_site(&webview, &estado)?;
    let janelas = janelas_abertas();
    let Ok(mut sys) = System::new() else { return Ok(vec![]) };
    sys.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::nothing());
    let eu = std::env::current_exe().ok().and_then(|p| p.file_name().map(|n| n.to_string_lossy().to_lowercase())).unwrap_or_default();
    let pular: HashSet<&str> = [
        "explorer.exe",
        "taskmgr.exe",
        "applicationframehost.exe",
        "textinputhost.exe",
        "systemsettings.exe",
        "searchhost.exe",
        "shellexperiencehost.exe",
        "startmenuexperiencehost.exe",
        "msedgewebview2.exe",
        eu.as_str(),
    ]
    .into_iter()
    .collect();
    let mut vistos = BTreeMap::new();
    for (pid, titulo) in janelas {
        let Some(proc_) = sys.process(sysinfo::Pid::from_u32(pid)) else { continue };
        let exe = proc_.name().to_string_lossy().to_lowercase();
        if !exe.ends_with(".exe") || pular.contains(exe.as_str()) || titulo.trim().is_empty() || vistos.contains_key(&exe) {
            continue;
        }
        let titulo: String = titulo.chars().take(120).collect();
        vistos.insert(exe.clone(), Candidato { exe, title: titulo });
    }
    let mut lista: Vec<Candidato> = vistos.into_values().collect();
    lista.sort_by_key(|c| c.title.to_lowercase());
    Ok(lista)
}

#[tauri::command]
fn cdg_game_custom(app: AppHandle, webview: Webview, estado: tauri::State<Estado>, list: Option<Vec<serde_json::Value>>) -> Result<Vec<Meu>, String> {
    so_do_site(&webview, &estado)?;
    if let Some(lista) = list {
        let mut novo = BTreeMap::new();
        for it in lista.iter().take(60) {
            let exe = it.get("exe").and_then(|v| v.as_str()).unwrap_or("").trim().to_lowercase();
            let nome: String = it.get("name").and_then(|v| v.as_str()).unwrap_or("").trim().chars().take(80).collect();
            let valido = exe.ends_with(".exe")
                && (5..=84).contains(&exe.chars().count())
                && !exe.contains(['\\', '/', ':', '*', '?', '"', '<', '>', '|']);
            if valido && !nome.is_empty() {
                novo.insert(exe, nome);
            }
        }
        gravar(&estado.arquivo("jogos-meus.json"), &novo);
        *estado.meus.lock().unwrap() = novo;
        // confere de novo na hora, sem esperar os 15 s
        std::thread::spawn(move || {
            if let Ok(mut sys) = System::new() {
                escanear(&app, &mut sys);
            }
        });
    }
    let meus = estado.meus.lock().unwrap();
    Ok(meus.iter().map(|(exe, name)| Meu { exe: exe.clone(), name: name.clone() }).collect())
}

#[tauri::command]
fn cdg_notify(app: AppHandle, webview: Webview, estado: tauri::State<Estado>, title: String, body: String) -> Result<(), String> {
    so_do_site(&webview, &estado)?;
    let titulo: String = title.chars().take(120).collect();
    let texto: String = body.chars().take(400).collect();
    avisar(&app, &titulo, &texto);
    Ok(())
}

#[tauri::command]
fn cdg_fullscreen(window: WebviewWindow) {
    let cheia = window.is_fullscreen().unwrap_or(false);
    let _ = window.set_fullscreen(!cheia);
}

#[tauri::command]
fn cdg_devtools(window: WebviewWindow) {
    if window.is_devtools_open() {
        window.close_devtools();
    } else {
        window.open_devtools();
    }
}

/* ------------------------------------------------------------------ atualização do próprio app */

fn barra(app: &AppHandle, pct: Option<f64>) {
    if let Some(w) = app.get_webview_window("main") {
        let estado = match pct {
            Some(p) => ProgressBarState { status: Some(ProgressBarStatus::Normal), progress: Some((p * 100.0) as u64) },
            None => ProgressBarState { status: Some(ProgressBarStatus::None), progress: None },
        };
        let _ = w.set_progress_bar(estado);
    }
}

fn baixar_e_instalar(app: &AppHandle, url: &str) -> Result<(), String> {
    let mut resp = ureq::get(url).call().map_err(|e| format!("download falhou ({e})"))?;
    let total: u64 = resp
        .headers()
        .get("content-length")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);
    let nome = url.rsplit('/').next().filter(|n| !n.is_empty()).unwrap_or("Call-dos-Games-Setup.exe");
    let arquivo = std::env::temp_dir().join(nome);
    let mut saida = fs::File::create(&arquivo).map_err(|e| e.to_string())?;
    let mut leitor = resp.body_mut().as_reader();
    let mut buf = vec![0u8; 64 * 1024];
    let (mut baixado, mut ultimo) = (0u64, -1i64);
    loop {
        let n = leitor.read(&mut buf).map_err(|e| format!("download falhou ({e})"))?;
        if n == 0 {
            break;
        }
        saida.write_all(&buf[..n]).map_err(|e| e.to_string())?;
        baixado += n as u64;
        if total > 0 {
            let pct = baixado as f64 / total as f64;
            let passo = (pct * 100.0) as i64;
            if passo != ultimo {
                ultimo = passo;
                barra(app, Some(pct));
                let _ = app.emit("cdg:update-progress", pct);
            }
        }
    }
    saida.flush().map_err(|e| e.to_string())?;
    drop(saida);
    if total > 0 && baixado != total {
        return Err("download incompleto".into());
    }
    barra(app, None);
    // espera o app fechar e instala por cima sem perguntar nada; o instalador abre o app de novo no fim
    let caminho = arquivo.to_string_lossy().replace('\'', "''");
    std::process::Command::new("powershell")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-WindowStyle",
            "Hidden",
            "-Command",
            &format!("Start-Sleep -Seconds 2; Start-Process -FilePath '{caminho}' -ArgumentList '/S'"),
        ])
        .creation_flags(SEM_JANELA)
        .spawn()
        .map_err(|e| e.to_string())?;
    let a = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(400));
        fechar_de_vez(&a);
    });
    Ok(())
}

#[tauri::command]
async fn cdg_update(app: AppHandle, webview: Webview, url: String) -> Result<String, String> {
    {
        let e = app.state::<Estado>();
        so_do_site(&webview, &e)?;
        if !url.starts_with(RELEASES) || !url.ends_with(".exe") || url.contains("..") {
            return Err("Endereço de atualização inválido.".into());
        }
        if e.atualizando.swap(true, SeqCst) {
            return Ok("baixando".into());
        }
    }
    let a = app.clone();
    let r = tauri::async_runtime::spawn_blocking(move || baixar_e_instalar(&a, &url))
        .await
        .map_err(|e| e.to_string())
        .and_then(|r| r);
    if let Err(err) = r {
        app.state::<Estado>().atualizando.store(false, SeqCst);
        barra(&app, None);
        return Err(err);
    }
    Ok("instalando".into())
}

/* ------------------------------------------------------------------ início */

fn main() {
    let site = std::env::var("CDG_URL")
        .ok()
        .and_then(|s| Url::parse(&s).ok())
        .filter(|u| matches!(u.scheme(), "http" | "https"))
        .unwrap_or_else(|| Url::parse("https://call.zapeu.net/app").expect("endereço do site"));
    let origem = site.origin().ascii_serialization();
    let pelo_windows = std::env::args().any(|a| a == "--startup");

    tauri::Builder::default()
        // abriu de novo com o app já aberto: só mostra a janela que já existe
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| mostrar(app)))
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, Some(vec!["--startup"])))
        .plugin(
            // Alt+Shift+C clipa o lance mesmo com o jogo na frente (o site decide se dá para clipar agora)
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _atalho, ev| {
                    if ev.state == ShortcutState::Pressed {
                        let _ = app.emit("cdg:clip", ());
                    }
                })
                .build(),
        )
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            cdg_site,
            cdg_app_prefs,
            cdg_game_now,
            cdg_game_candidates,
            cdg_game_custom,
            cdg_notify,
            cdg_fullscreen,
            cdg_devtools,
            cdg_update
        ])
        .on_window_event(|w, ev| {
            if w.label() != "main" {
                return;
            }
            if let WindowEvent::CloseRequested { api, .. } = ev {
                let app = w.app_handle();
                let e = app.state::<Estado>();
                if let Some(ww) = app.get_webview_window("main") {
                    guardar_janela(&ww, &e);
                }
                if e.fechando.load(SeqCst) || !e.prefs.lock().unwrap().background {
                    e.fechando.store(true, SeqCst);
                    app.exit(0);
                    return;
                }
                // o X só esconde: a call e os avisos continuam, e o app volta pelo ícone perto do relógio
                api.prevent_close();
                let _ = w.hide();
                if !e.avisou_bandeja.swap(true, SeqCst) {
                    avisar(
                        app,
                        "Call dos Games continua aberto",
                        "A call segue rolando. Para fechar de vez, clique com o botão direito no ícone perto do relógio e em “Fechar de vez”.",
                    );
                }
            }
        })
        .setup(move |app| {
            let dir = app.path().app_data_dir()?;
            fs::create_dir_all(&dir)?;
            trazer_do_app_antigo(&dir);
            let prefs: Prefs = ler(&dir.join("app.json"));
            let meus: BTreeMap<String, String> = ler(&dir.join("jogos-meus.json"));
            let escondido = pelo_windows && prefs.startup && prefs.hidden;
            app.manage(Estado {
                site: site.clone(),
                origem: origem.clone(),
                dir,
                prefs: Mutex::new(prefs.clone()),
                meus: Mutex::new(meus),
                jogo: Mutex::new(None),
                fechando: AtomicBool::new(false),
                avisou_bandeja: AtomicBool::new(false),
                atualizando: AtomicBool::new(false),
            });
            // o site (de fora do app) pode chamar os comandos acima e ouvir os eventos do app
            app.add_capability(
                CapabilityBuilder::new("site")
                    .remote(format!("{origem}/*"))
                    .window("main")
                    .permission("core:event:default")
                    .permission("allow-cdg-app-prefs")
                    .permission("allow-cdg-game-now")
                    .permission("allow-cdg-game-candidates")
                    .permission("allow-cdg-game-custom")
                    .permission("allow-cdg-notify")
                    .permission("allow-cdg-fullscreen")
                    .permission("allow-cdg-devtools")
                    .permission("allow-cdg-update"),
            )?;
            let h = app.handle().clone();
            aplicar_inicio(&h, prefs.startup);
            criar_bandeja(&h)?;
            criar_janela(&h, !escondido)?;
            let _ = h.global_shortcut().register("alt+shift+c");
            vigiar_jogos(h);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("erro ao abrir o Call dos Games");
}
