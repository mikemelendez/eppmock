/**
 * RFC 5733 / RFC 5730 contact field checks used by RST epp-07 and epp-09.
 */

const CLID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{2,15}$/;
const VOICE_PATTERN = /^\+[0-9]{1,3}\.[0-9]{1,14}$/;
const EMAIL_PATTERN = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

/** RFC 5733 postalLineType / optPostalLineType. */
export const POSTAL_LINE_MAX_LENGTH = 255;
/** RFC 5733 pcType. */
export const POSTAL_PC_MAX_LENGTH = 16;
/** RFC 5321 local-part limit enforced for contact:email. */
export const EMAIL_LOCAL_MAX_LENGTH = 64;

/** Statuses a client may add/remove on contact:update (RFC 5733 §2.2). */
export const CLIENT_SETTABLE_CONTACT_STATUSES = new Set([
  "clientDeleteProhibited",
  "clientTransferProhibited",
  "clientUpdateProhibited"
]);

/** ISO 3166-1 alpha-2 codes accepted in contact:cc. */
const ISO_3166_1_ALPHA2 = new Set([
  "AD", "AE", "AF", "AG", "AI", "AL", "AM", "AO", "AQ", "AR", "AS", "AT", "AU", "AW", "AX", "AZ",
  "BA", "BB", "BD", "BE", "BF", "BG", "BH", "BI", "BJ", "BL", "BM", "BN", "BO", "BQ", "BR", "BS",
  "BT", "BV", "BW", "BY", "BZ", "CA", "CC", "CD", "CF", "CG", "CH", "CI", "CK", "CL", "CM", "CN",
  "CO", "CR", "CU", "CV", "CW", "CX", "CY", "CZ", "DE", "DJ", "DK", "DM", "DO", "DZ", "EC", "EE",
  "EG", "EH", "ER", "ES", "ET", "FI", "FJ", "FK", "FM", "FO", "FR", "GA", "GB", "GD", "GE", "GF",
  "GG", "GH", "GI", "GL", "GM", "GN", "GP", "GQ", "GR", "GS", "GT", "GU", "GW", "GY", "HK", "HM",
  "HN", "HR", "HT", "HU", "ID", "IE", "IL", "IM", "IN", "IO", "IQ", "IR", "IS", "IT", "JE", "JM",
  "JO", "JP", "KE", "KG", "KH", "KI", "KM", "KN", "KP", "KR", "KW", "KY", "KZ", "LA", "LB", "LC",
  "LI", "LK", "LR", "LS", "LT", "LU", "LV", "LY", "MA", "MC", "MD", "ME", "MF", "MG", "MH", "MK",
  "ML", "MM", "MN", "MO", "MP", "MQ", "MR", "MS", "MT", "MU", "MV", "MW", "MX", "MY", "MZ", "NA",
  "NC", "NE", "NF", "NG", "NI", "NL", "NO", "NP", "NR", "NU", "NZ", "OM", "PA", "PE", "PF", "PG",
  "PH", "PK", "PL", "PM", "PN", "PR", "PS", "PT", "PW", "PY", "QA", "RE", "RO", "RS", "RU", "RW",
  "SA", "SB", "SC", "SD", "SE", "SG", "SH", "SI", "SJ", "SK", "SL", "SM", "SN", "SO", "SR", "SS",
  "ST", "SV", "SX", "SY", "SZ", "TC", "TD", "TF", "TG", "TH", "TJ", "TK", "TL", "TM", "TN", "TO",
  "TR", "TT", "TV", "TW", "TZ", "UA", "UG", "UM", "US", "UY", "UZ", "VA", "VC", "VE", "VG", "VI",
  "VN", "VU", "WF", "WS", "YE", "YT", "ZA", "ZM", "ZW"
]);

export function isValidContactId(id: string): boolean {
  return CLID_PATTERN.test(id);
}

/**
 * True when the id can appear in a schema-valid contact:id element (clIDType:
 * token length 3–16). Overlong/short ids must not be echoed in check responses.
 */
export function isSchemaCompatibleContactId(id: string): boolean {
  return id.length >= 3 && id.length <= 16;
}

export function isValidVoiceOrFax(value: string): boolean {
  return VOICE_PATTERN.test(value);
}

export function isValidContactEmail(value: string): boolean {
  if (value.length < 1 || value.length > 320 || !EMAIL_PATTERN.test(value)) {
    return false;
  }

  const at = value.lastIndexOf("@");
  if (at <= 0) {
    return false;
  }

  return at <= EMAIL_LOCAL_MAX_LENGTH;
}

export function isClientSettableContactStatus(status: string): boolean {
  return CLIENT_SETTABLE_CONTACT_STATUSES.has(status);
}

export function exceedsPostalLineLength(value: string | undefined): boolean {
  return value !== undefined && value.length > POSTAL_LINE_MAX_LENGTH;
}

export function isValidCountryCode(value: string): boolean {
  return value.length === 2 && ISO_3166_1_ALPHA2.has(value.toUpperCase());
}

export function isAscii7Bit(value: string): boolean {
  return /^[\x20-\x7E]*$/.test(value);
}
