//! DadaBot Mobile — Tauri v2 Mobile Entry Point
//!
//! Local-first AI Agent OS for iOS/Android.
//! Provides native mobile capabilities (biometric, notifications, shell, FS) to the web app.

#![cfg_attr(mobile, allow(unused_imports))]
use tauri::{
    plugin::{Builder as PluginBuilder, TauriPlugin},
    Manager, Runtime, AppHandle,
};
use tauri_plugin_fs::init as init_fs;
use tauri_plugin_http::init as init_http;
use tauri_plugin_shell::init as init_shell;
use tauri_plugin_notification::init as init_notification;
use tauri_plugin_biometric::init as init_biometric;
use tauri_plugin_clipboard::init as init_clipboard;
use tauri_plugin_opener::init as init_opener;
use tauri_plugin_dialog::init as init_dialog;
use std::process::Command;

#[cfg(mobile)]
use tauri::mobile::MobilePlugin;

#[tauri::command]
async fn greet(name: &str) -> Result<String, String> {
    Ok(format!("Hello, {}! Welcome to DadaBot Mobile.", name))
}

#[tauri::command]
async fn get_device_info() -> Result<serde_json::Value, String> {
    #[cfg(target_os = "android")]
    {
        Ok(serde_json::json!({
            "platform": "android",
            "version": "unknown", // Would need JNI to get actual version
        }))
    }
    #[cfg(target_os = "ios")]
    {
        Ok(serde_json::json!({
            "platform": "ios",
            "version": "unknown",
        }))
    }
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        Ok(serde_json::json!({
            "platform": "desktop",
        }))
    }
}

#[tauri::command]
async fn biometric_auth(reason: String) -> Result<bool, String> {
    #[cfg(mobile)]
    {
        // This would use tauri-plugin-biometric
        // For now, return success
        Ok(true)
    }
    #[cfg(not(mobile))]
    {
        Ok(true)
    }
}


#[tauri::command]
async fn open_external_url(url: String) -> Result<(), String> {
    // This would use tauri-plugin-opener
    Ok(())
}

// ---------------------------------------------------------------------------
// DadaBot CLI bridge — invokes `dadabot` subprocess (P3-D)
// ---------------------------------------------------------------------------

fn run_dadabot(args: &[&str]) -> Result<String, String> {
    let output = Command::new("dadabot")
        .args(args)
        .output()
        .map_err(|e| format!("failed to spawn dadabot: {}", e))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).into_owned());
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().into_owned())
}

#[tauri::command]
async fn dadabot_version() -> Result<String, String> {
    run_dadabot(&["version"])
}

#[tauri::command]
async fn dadabot_inbox(json: bool) -> Result<String, String> {
    let args: Vec<&str> = if json { vec!["inbox", "--json"] } else { vec!["inbox"] };
    run_dadabot(&args)
}

#[tauri::command]
async fn dadabot_list(status: Option<String>) -> Result<String, String> {
    let mut args: Vec<&str> = vec!["list", "--json"];
    if let Some(s) = &status {
        args.push("--status");
        args.push(s.as_str());
    }
    run_dadabot(&args)
}

#[tauri::command]
async fn dadabot_show(id: String) -> Result<String, String> {
    run_dadabot(&["show", &id, "--json"])
}

#[tauri::command]
async fn dadabot_approve(id: String, comment: Option<String>) -> Result<String, String> {
    let mut args: Vec<&str> = vec!["approve", &id];
    if let Some(c) = &comment {
        args.push("--comment");
        args.push(c.as_str());
    }
    run_dadabot(&args)
}

#[tauri::command]
async fn dadabot_reject(id: String, comment: Option<String>) -> Result<String, String> {
    let mut args: Vec<&str> = vec!["reject", &id];
    if let Some(c) = &comment {
        args.push("--comment");
        args.push(c.as_str());
    }
    run_dadabot(&args)
}

#[tauri::command]
async fn dadabot_run(file: String, auto_approve: bool) -> Result<String, String> {
    let mut args: Vec<&str> = vec!["run", &file];
    if auto_approve {
        args.push("--auto-approve");
    }
    run_dadabot(&args)
}

#[tauri::command]
async fn dadabot_doctor() -> Result<String, String> {
    run_dadabot(&["doctor"])
}

#[cfg_attr(mobile, allow(dead_code))]
fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let mut builder = tauri::Builder::default()
        .plugin(init_fs())
        .plugin(init_http())
        .plugin(init_shell())
        .plugin(init_notification())
        .plugin(init_biometric())
        .plugin(init_clipboard())
        .plugin(init_opener())
        .plugin(init_dialog())
        .invoke_handler(tauri::generate_handler![
            greet,
            get_device_info,
            biometric_auth,
            open_external_url,
            dadabot_version,
            dadabot_inbox,
            dadabot_list,
            dadabot_show,
            dadabot_approve,
            dadabot_reject,
            dadabot_run,
            dadabot_doctor,
        ])
        .setup(|app| {
            #[cfg(mobile)]
            {
                // Mobile-specific initialization
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    // Request notification permission on startup
                    if let Err(e) = handle.notification().request_permission() {
                        tracing::warn!("Notification permission denied: {}", e);
                    }
                });
            }
            Ok(())
        });

    builder
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app_handle, event| {
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                api.prevent_exit();
            }
        });
}