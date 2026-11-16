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
    let query = callback.strip_prefix(PREFIX).ok_or(INVALID)?;
    if query.contains('#') {
        return Err(INVALID);
    }
    let parameters = parameters(query).ok_or(INVALID)?;
    if parameters.iter().any(|(name, _)| name == "error") || !has_state(&parameters, state) {
        return Err(INVALID);
    }
    let codes: Vec<_> = parameters
        .iter()
        .filter(|(name, _)| name == "code")
        .map(|(_, value)| *value)
        .collect();
    let [Some(code)] = codes[..] else {
        return Err(INVALID);
    };
    let code = decode(code).ok_or(INVALID)?;
    if code.is_empty() || code.len() > MAX_CODE_BYTES {
        return Err(INVALID);
    }
    Ok(code)
}

/// Whether a callback at the redirect carries exactly one `state`, equal to the pending one.
///
/// Only such a callback may end a waiting sign-in (issue #116). A program that does not know
/// the state cannot, which is how the Swift host behaved: there only the browser session's own
/// callback reached the attempt. What else the callback carries does not matter here, so a
/// refusal from the browser (an `error` and no `code`) still ends the attempt it belongs to;
/// [`authorization_code`] then decides whether there is a code to send.
pub fn carries_state(callback: &str, state: &str) -> bool {
    let Some(rest) = callback.strip_prefix(PREFIX) else {
        return false;
    };
    let query = rest.split_once('#').map_or(rest, |(query, _)| query);
    parameters(query).is_some_and(|parameters| has_state(&parameters, state))
}

/// The query's parameters, each name decoded and each value as it arrived; `None` when a name
/// cannot be decoded. A pair with no `=` has no value.
fn parameters(query: &str) -> Option<Vec<(String, Option<&str>)>> {
    query
        .split('&')
        .map(|pair| {
            let (name, value) = match pair.split_once('=') {
                Some((name, value)) => (name, Some(value)),
                None => (pair, None),
            };
            Some((decode(name)?, value))
        })
        .collect()
}

/// Exactly one `state`, whose decoded value is the pending state, which is never empty.
fn has_state(parameters: &[(String, Option<&str>)], state: &str) -> bool {
    let states: Vec<_> = parameters
        .iter()
        .filter(|(name, _)| name == "state")
        .map(|(_, value)| *value)
        .collect();
    match states[..] {
        [Some(found)] => !state.is_empty() && decode(found).as_deref() == Some(state),
        _ => false,
    }
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
