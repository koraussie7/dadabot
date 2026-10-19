// lib.rs — Tauri v2 mobile entry point for dadabot-mobile.
//
// Mobile (iOS/Android) targets compile this lib as a static lib and look
// for a `#[tauri::mobile_entry_point]`-annotated function. The desktop
// binary (main.rs) also delegates to `run()` so the same Tauri builder is
// shared across all targets.
//
// The actual app builder + commands live in main.rs (not yet factored
// out into a separate `app` module). On mobile, `main()` is hidden by
// `#[cfg_attr(not(mobile), ...)]`, so we re-export a no-op here.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  // On mobile this is the entry point. On desktop, main() in main.rs
  // is the entry point and never calls run().
  #[cfg(mobile)]
  super::main();
}

