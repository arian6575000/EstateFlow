// ====== PER-APP LICENSE SETTINGS (EstateFlow) ======
// PROJECT_CODE: must match the code of the "estateflow" project in the License Generator / Hub.
// PUBLIC_KEY_HEX: the Ed25519 PUBLIC key (64 hex chars) of the "estateflow" project. Never put a private key here.
// EstateFlow has its OWN signing identity: do NOT reuse the RetailX CRM key. Until the real EstateFlow public key is pasted
// below, the app shows a "license not configured" screen (it never opens unlicensed).
export const PROJECT_CODE = "estateflow";
export const PUBLIC_KEY_HEX = "";
// =================================================
// DEVICE_PREFIX: app name at the start of the Device ID ("EstateFlow-87A9-F285-E2DF"); unique per app so licenses never cross apps.
export const DEVICE_PREFIX = "EstateFlow";
// New app: there are no legacy 20-hex IDs to accept.
export const ACCEPT_LEGACY_DEVICE_ID = false;
export const KEY_CONFIGURED = /^[0-9a-fA-F]{64}$/.test(PUBLIC_KEY_HEX);
