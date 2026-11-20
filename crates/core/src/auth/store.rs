//! What the host must provide to keep a sign-in across launches.

use super::AuthError;

/// The operating system's protected storage for the one saved credential, the refresh token.
///
/// Implementations must keep it out of files the UI can read, out of logs and out of errors.
pub trait CredentialStore: Send + Sync {
    /// The saved refresh token, or `None` when nothing is saved.
    fn load(&self) -> Result<Option<String>, AuthError>;
    /// Replaces the saved refresh token.
    fn save(&self, refresh_token: &str) -> Result<(), AuthError>;
    /// Removes the saved refresh token. Removing nothing is a success.
    fn delete(&self) -> Result<(), AuthError>;
}

/// A durable "the user signed out" flag kept outside the credential store.
///
/// Sign-out sets it before deleting the credential, so a credential that could not be deleted is
/// not used to sign the user back in at the next launch. A completed sign-in clears it.
pub trait SignedOutMarker: Send + Sync {
    fn signed_out(&self) -> bool;
    fn set_signed_out(&self, value: bool);
}
