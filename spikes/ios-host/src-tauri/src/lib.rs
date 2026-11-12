// Throwaway spike for issue #38. Not production code.
use serde_json::{json, Value};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

struct Report(Mutex<Value>);

fn update(app: &AppHandle, f: impl FnOnce(&mut Value)) {
    let state = app.state::<Report>();
    let snapshot = {
        let mut guard = state.0.lock().unwrap();
        f(&mut guard);
        guard.clone()
    };
    if let Ok(dir) = app.path().app_data_dir() {
        let _ = std::fs::create_dir_all(&dir);
        let _ = std::fs::write(
            dir.join("spike-report.json"),
            serde_json::to_vec_pretty(&snapshot).unwrap(),
        );
    }
}

fn push(app: &AppHandle, key: &str, item: Value) {
    update(app, |v| {
        let list = v.as_object_mut().unwrap().entry(key).or_insert(json!([]));
        list.as_array_mut().unwrap().push(item);
    });
}

/// The gate under test: records who reached it. Only the main frame of the
/// "main" webview on the bundled origin is expected to appear.
#[tauri::command]
fn gated_echo(app: AppHandle, webview: tauri::Webview, token: String) -> String {
    let url = webview.url().map(|u| u.to_string()).unwrap_or_default();
    push(&app, "gate_calls", json!({ "label": webview.label(), "url": url, "token": token }));
    format!("echo:{token}")
}

#[tauri::command]
fn record(app: AppHandle, key: String, value: Value) {
    update(&app, |v| {
        v.as_object_mut().unwrap().insert(key, value);
    });
}

#[tauri::command]
fn keychain_roundtrip() -> Value {
    keychain::roundtrip()
}

#[cfg(not(target_os = "ios"))]
mod keychain {
    pub fn roundtrip() -> serde_json::Value {
        serde_json::json!({ "skipped": "not iOS" })
    }
}

#[cfg(target_os = "ios")]
mod keychain {
    use core_foundation::base::{CFType, CFTypeRef, TCFType};
    use core_foundation::boolean::CFBoolean;
    use core_foundation::data::{CFData, CFDataRef};
    use core_foundation::dictionary::{CFDictionary, CFDictionaryRef};
    use core_foundation::string::{CFString, CFStringRef};
    use serde_json::{json, Value};
    use std::os::raw::c_void;

    #[link(name = "Security", kind = "framework")]
    extern "C" {
        static kSecClass: CFStringRef;
        static kSecClassGenericPassword: CFStringRef;
        static kSecAttrService: CFStringRef;
        static kSecAttrAccount: CFStringRef;
        static kSecValueData: CFStringRef;
        static kSecAttrAccessible: CFStringRef;
        static kSecAttrAccessibleWhenUnlockedThisDeviceOnly: CFStringRef;
        static kSecReturnData: CFStringRef;
        static kSecReturnAttributes: CFStringRef;
        static kSecMatchLimit: CFStringRef;
        static kSecMatchLimitOne: CFStringRef;
        fn SecItemAdd(query: CFDictionaryRef, result: *mut CFTypeRef) -> i32;
        fn SecItemCopyMatching(query: CFDictionaryRef, result: *mut CFTypeRef) -> i32;
        fn SecItemDelete(query: CFDictionaryRef) -> i32;
    }

    fn s(r: CFStringRef) -> CFType {
        unsafe { CFString::wrap_under_get_rule(r) }.as_CFType()
    }

    fn base() -> Vec<(CFType, CFType)> {
        unsafe {
            vec![
                (s(kSecClass), s(kSecClassGenericPassword)),
                (s(kSecAttrService), CFString::new("ai.opencoven.opensesame.spike").as_CFType()),
                (s(kSecAttrAccount), CFString::new("refresh-token").as_CFType()),
            ]
        }
    }

    /// Returns (status, value, accessibility class).
    fn read() -> (i32, Option<String>, Option<String>) {
        unsafe {
            let mut q = base();
            q.push((s(kSecReturnData), CFBoolean::true_value().as_CFType()));
            q.push((s(kSecReturnAttributes), CFBoolean::true_value().as_CFType()));
            q.push((s(kSecMatchLimit), s(kSecMatchLimitOne)));
            let dict = CFDictionary::from_CFType_pairs(&q);
            let mut out: CFTypeRef = std::ptr::null();
            let status = SecItemCopyMatching(dict.as_concrete_TypeRef(), &mut out);
            if status != 0 || out.is_null() {
                return (status, None, None);
            }
            let found: CFDictionary = CFDictionary::wrap_under_create_rule(out as CFDictionaryRef);
            let value = found.find(kSecValueData as *const c_void).map(|p| {
                let d = CFData::wrap_under_get_rule(*p as CFDataRef);
                String::from_utf8_lossy(d.bytes()).to_string()
            });
            let class = found
                .find(kSecAttrAccessible as *const c_void)
                .map(|p| CFString::wrap_under_get_rule(*p as CFStringRef).to_string());
            (status, value, class)
        }
    }

    pub fn roundtrip() -> Value {
        let (prev_status, prev_value, prev_class) = read();
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0);
        let secret = format!("spike-secret-{stamp}");
        let (delete_status, add_status) = unsafe {
            let del = SecItemDelete(CFDictionary::from_CFType_pairs(&base()).as_concrete_TypeRef());
            let mut q = base();
            q.push((s(kSecValueData), CFData::from_buffer(secret.as_bytes()).as_CFType()));
            q.push((s(kSecAttrAccessible), s(kSecAttrAccessibleWhenUnlockedThisDeviceOnly)));
            let add = SecItemAdd(
                CFDictionary::from_CFType_pairs(&q).as_concrete_TypeRef(),
                std::ptr::null_mut(),
            );
            (del, add)
        };
        let (read_status, read_value, read_class) = read();
        json!({
            "previous_launch": { "status": prev_status, "value": prev_value, "accessible": prev_class },
            "delete_status": delete_status,
            "add_status": add_status,
            "read_status": read_status,
            "written": secret,
            "read_back_matches": read_value.as_deref() == Some(secret.as_str()),
            "accessible": read_class,
        })
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(Report(Mutex::new(json!({}))))
        .invoke_handler(tauri::generate_handler![gated_echo, record, keychain_roundtrip])
        .setup(|app| {
            let handle = app.handle().clone();
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .on_navigation(move |url| {
                    let bundled = url.scheme() == "tauri" && url.host_str() == Some("localhost");
                    let allowed = bundled || url.scheme() == "about";
                    push(&handle, "navigations", json!({ "url": url.as_str(), "allowed": allowed }));
                    allowed
                })
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running spike");
}
