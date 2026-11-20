use minisign_verify::{PublicKey, Signature};
use std::path::Path;

fn fixtures() -> (&'static [u8], PublicKey, Signature) {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures");
    let data = include_bytes!("fixtures/updater.txt");
    let key = PublicKey::from_file(&dir.join("updater.pub")).expect("public key fixture");
    let signature = Signature::from_file(&dir.join("updater.minisig")).expect("signed fixture");
    (data, key, signature)
}

#[test]
fn official_tauri_signature_verifies() {
    let (data, key, signature) = fixtures();
    key.verify(data, &signature, false).expect("valid signed update");
}

#[test]
fn modified_update_is_rejected() {
    let (data, key, signature) = fixtures();
    let mut changed = data.to_vec();
    changed[0] ^= 1;
    assert!(key.verify(&changed, &signature, false).is_err());
}

#[test]
fn modified_version_metadata_is_rejected() {
    let (data, key, _) = fixtures();
    let signature = include_str!("fixtures/updater.minisig").replace("version:2.0.1", "version:9.9.9");
    let changed = Signature::decode(&signature).expect("syntactically valid signature");
    assert!(key.verify(data, &changed, false).is_err());
}

#[test]
fn missing_signature_is_rejected() {
    assert!(Signature::decode("").is_err());
}
