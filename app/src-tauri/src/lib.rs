// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

/// The device's own non-loopback IPv4 addresses (e.g. a LAN 192.168.x.x/10.x.x.x
/// address), so the frontend's TauriTcpTransport (see
/// app/src/backend/tauriTcpTransport.ts) can build real, LAN-dialable multiaddrs for
/// its TCP listener - neither tauri-plugin-tcp nor any other installed plugin exposes
/// this. `if_addrs` is pure Rust (libc getifaddrs on Unix/Android), so this works
/// identically on desktop and Android with no native Kotlin/Swift module.
#[tauri::command]
fn local_ipv4_addresses() -> Vec<String> {
    if_addrs::get_if_addrs()
        .unwrap_or_default()
        .into_iter()
        .filter(|iface| !iface.is_loopback())
        .filter_map(|iface| match iface.addr {
            if_addrs::IfAddr::V4(v4) => Some(v4.ip.to_string()),
            _ => None,
        })
        .collect()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();

    // Must be the very first plugin registered (per tauri-plugin-single-instance's own
    // docs) - its "deep-link" feature is what makes a helix:// link opened while the
    // app is already running (which on Windows/Linux relaunches a second process
    // rather than emitting an event directly) forward into the SAME onOpenUrl event
    // tauri-plugin-deep-link emits natively on macOS/Android/iOS, so the frontend
    // (deepLink.ts) only has to handle one code path. Desktop-only: mobile platforms
    // never have a "second instance" in this sense at all.
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|_app, argv, _cwd| {
        println!("[helix] second instance launched with {argv:?} - deep link event already forwarded");
    }));

    let builder = builder
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_tcp::init());

    // tauri-plugin-barcode-scanner's entire crate body is `#![cfg(mobile)]` - it has no
    // `init()` (or anything else) on desktop targets at all, confirmed by `cargo check`
    // failing outright without this gate. Matches the QR pairing plan: scanning is
    // mobile-only, desktop only shows its own code.
    #[cfg(mobile)]
    let builder = builder.plugin(tauri_plugin_barcode_scanner::init());

    builder
        .invoke_handler(tauri::generate_handler![greet, local_ipv4_addresses])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
