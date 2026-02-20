#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use reqwest::Url;
use tauri_plugin_shell::ShellExt;
use tiny_http::{Response, Server};

fn read_required_env(name: &str) -> Result<String, String> {
    let value = std::env::var(name)
        .map_err(|_| format!("Falta variable de entorno requerida: {}", name))?;
    let trimmed = value.trim().to_string();
    if trimmed.is_empty() {
        return Err(format!("La variable de entorno {} esta vacia.", name));
    }
    Ok(trimmed)
}

#[tauri::command]
async fn google_oauth(app: tauri::AppHandle) -> Result<String, String> {
    let client_id = read_required_env("GOOGLE_OAUTH_CLIENT_ID")?;
    let client_secret = read_required_env("GOOGLE_OAUTH_CLIENT_SECRET")?;
    let redirect_uri = std::env::var("GOOGLE_OAUTH_REDIRECT_URI")
        .unwrap_or_else(|_| "http://localhost".to_string());
    let redirect_url = Url::parse(&redirect_uri).map_err(|e| e.to_string())?;
    let host = redirect_url
        .host_str()
        .ok_or_else(|| "GOOGLE_OAUTH_REDIRECT_URI no tiene host valido.".to_string())?
        .to_string();
    let port = redirect_url
        .port_or_known_default()
        .ok_or_else(|| "GOOGLE_OAUTH_REDIRECT_URI no tiene puerto valido.".to_string())?;
    let bind_addr = format!("{}:{}", host, port);

    let server = Server::http(&bind_addr).map_err(|e| e.to_string())?;

    // Abrir navegador
    let mut auth_url =
        Url::parse("https://accounts.google.com/o/oauth2/v2/auth").map_err(|e| e.to_string())?;
    auth_url
        .query_pairs_mut()
        .append_pair("client_id", &client_id)
        .append_pair("redirect_uri", &redirect_uri)
        .append_pair("response_type", "code")
        .append_pair("scope", "openid email profile");

    #[allow(deprecated)]
    app.shell()
        .open(auth_url.to_string(), None)
        .map_err(|e| e.to_string())?;

    // Esperar redirect
    let request = server.recv().map_err(|e| e.to_string())?;
    let callback_url = format!(
        "{}://{}:{}{}",
        redirect_url.scheme(),
        host,
        port,
        request.url()
    );
    let parsed_url = Url::parse(&callback_url).map_err(|e| e.to_string())?;
    let code = parsed_url
        .query_pairs()
        .find(|(key, _)| key == "code")
        .map(|(_, value)| value.into_owned())
        .unwrap_or_default();
    if code.is_empty() {
        return Err("No se recibio codigo OAuth en el redirect.".into());
    }

    request
        .respond(Response::from_string(
            "Login exitoso. Puede cerrar esta ventana.",
        ))
        .map_err(|e| e.to_string())?;

    // Intercambiar code por token
    let client = reqwest::Client::new();

    let params = [
        ("code", code.as_str()),
        ("client_id", client_id.as_str()),
        ("client_secret", client_secret.as_str()),
        ("redirect_uri", redirect_uri.as_str()),
        ("grant_type", "authorization_code"),
    ];

    let res = client
        .post("https://oauth2.googleapis.com/token")
        .form(&params)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = res.status();
    let body = res.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!(
            "OAuth token endpoint error {}: {}",
            status.as_u16(),
            body
        ));
    }

    let token_json: serde_json::Value = serde_json::from_str(&body).map_err(|e| e.to_string())?;
    let id_token = token_json
        .get("id_token")
        .and_then(|value| value.as_str())
        .unwrap_or("")
        .to_string();
    if id_token.is_empty() {
        return Err(format!("Respuesta OAuth sin id_token: {}", body));
    }

    Ok(id_token)
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![google_oauth])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
