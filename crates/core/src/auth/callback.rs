//! Validation of the sign-in callback URL.

use super::AuthError;

/// `REDIRECT` followed by the start of the query. Matching this literal prefix fixes the scheme,
/// the host and the path exactly, and rules out a user, a password and a port.
const PREFIX: &str = "opensesame://auth/callback?";
const MAX_CODE_BYTES: usize = 8192;

/// Returns the authorisation code from a callback URL, or rejects the URL.
///
/// The rules are those of `OpenSesameAuthentication.authorizationCode` in the Swift host: exact
/// scheme, host and path; no user, password, port or fragment; exactly one `state`, equal to the
/// pending one; exactly one non-empty `code` of at most 8192 bytes; no `error` parameter.
pub fn authorization_code(callback: &str, state: &str) -> Result<String, AuthError> {
    const INVALID: AuthError = AuthError::InvalidCallback;
    if state.is_empty() {
        return Err(INVALID);
    }
    let query = callback.strip_prefix(PREFIX).ok_or(INVALID)?;
    if query.contains('#') {
        return Err(INVALID);
    }
    let mut states = Vec::new();
    let mut codes = Vec::new();
    for pair in query.split('&') {
        let (name, value) = match pair.split_once('=') {
            Some((name, value)) => (name, Some(value)),
            None => (pair, None),
        };
        match decode(name).ok_or(INVALID)?.as_str() {
            "error" => return Err(INVALID),
            "state" => states.push(value),
            "code" => codes.push(value),
            _ => {}
        }
    }
    let [Some(found)] = states[..] else {
        return Err(INVALID);
    };
    if decode(found).ok_or(INVALID)? != state {
        return Err(INVALID);
    }
    let [Some(code)] = codes[..] else {
        return Err(INVALID);
    };
    let code = decode(code).ok_or(INVALID)?;
    if code.is_empty() || code.len() > MAX_CODE_BYTES {
        return Err(INVALID);
    }
    Ok(code)
}

/// Percent-decodes one query name or value. `+` is not a space, as in `URLComponents`.
fn decode(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            let high = hex(*bytes.get(index + 1)?)?;
            let low = hex(*bytes.get(index + 2)?)?;
            out.push(high << 4 | low);
            index += 3;
        } else {
            out.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(out).ok()
}

fn hex(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}
