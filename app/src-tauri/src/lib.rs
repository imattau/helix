// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init());

    // tauri-plugin-barcode-scanner's entire crate body is `#![cfg(mobile)]` - it has no
    // `init()` (or anything else) on desktop targets at all, confirmed by `cargo check`
    // failing outright without this gate. Matches the QR pairing plan: scanning is
    // mobile-only, desktop only shows its own code.
    #[cfg(mobile)]
    let builder = builder.plugin(tauri_plugin_barcode_scanner::init());

    builder
        .invoke_handler(tauri::generate_handler![greet])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
