// Declara os comandos do app para poder liberar cada um só para quem precisa
// (a tela de abertura e o site da turma).
const COMANDOS: &[&str] = &[
    "cdg_site",
    "cdg_app_prefs",
    "cdg_game_now",
    "cdg_game_candidates",
    "cdg_game_custom",
    "cdg_notify",
    "cdg_fullscreen",
    "cdg_devtools",
    "cdg_update",
];

fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(COMANDOS)))
        .expect("falha ao preparar o app");
}
