import { domainToASCII, domainToUnicode } from "node:url";

export interface RegistryDomainName {
  input: string;
  canonicalName: string;
  unicodeName: string;
  label: string;
  tld: string;
}

export class RegistryPolicyError extends Error {
  constructor(
    name: string,
    readonly reason: string
  ) {
    super(`Domain ${name} is not allowed by registry policy: ${reason}`);
  }
}

export class RegistryPolicy {
  private readonly canonicalTld: string;

  constructor(tld = "melendez") {
    const canonicalTld = canonicalizeLabel(tld.replace(/^\./, ""));

    if (!canonicalTld) {
      throw new Error(`Invalid registry TLD: ${tld}`);
    }

    this.canonicalTld = canonicalTld;
  }

  normalizeDomainName(name: string): RegistryDomainName {
    const input = name;
    const trimmed = name.trim().replace(/\.$/, "").toLowerCase();

    if (!trimmed) {
      throw new RegistryPolicyError(input, "domain name is required");
    }

    const canonicalName = domainToASCII(trimmed);

    if (!canonicalName) {
      throw new RegistryPolicyError(input, "domain name is not valid IDNA");
    }

    const labels = canonicalName.split(".");

    if (labels.length !== 2) {
      throw new RegistryPolicyError(input, `only second-level .${this.canonicalTld} domains are allowed`);
    }

    const [label, tld] = labels;

    if (tld !== this.canonicalTld) {
      throw new RegistryPolicyError(input, `only .${this.canonicalTld} domains are allowed`);
    }

    if (!isValidDnsLabel(label)) {
      throw new RegistryPolicyError(input, "domain label is not a valid DNS label");
    }

    if (canonicalName.length > 253) {
      throw new RegistryPolicyError(input, "domain name exceeds DNS length limit");
    }

    const unicodeName = domainToUnicode(canonicalName);
    const unicodeLabel = unicodeName.split(".")[0] ?? "";

    if (!isAllowedIdnLabel(unicodeLabel)) {
      throw new RegistryPolicyError(input, "domain label contains code points outside the IDN table");
    }

    if (isReservedLabel(label)) {
      throw new RegistryPolicyError(input, "domain label is reserved by registry policy");
    }

    return {
      input,
      canonicalName,
      unicodeName,
      label,
      tld
    };
  }

  isValidDomainName(name: string): boolean {
    try {
      this.normalizeDomainName(name);
      return true;
    } catch (error) {
      if (error instanceof RegistryPolicyError) {
        return false;
      }

      throw error;
    }
  }
}

export function unicodeDomainName(name: string): string {
  return domainToUnicode(name);
}

export function canonicalHostName(name: string): string {
  const hasTrailingDot = name.trim().endsWith(".");
  const canonical = domainToASCII(name.trim().replace(/\.$/, "").toLowerCase());

  if (!canonical || canonical.length > 253) {
    throw new RegistryPolicyError(name, "host name is not valid IDNA");
  }

  const labels = canonical.split(".");

  if (!labels.every(isValidDnsLabel)) {
    throw new RegistryPolicyError(name, "host name contains an invalid DNS label");
  }

  return hasTrailingDot ? `${canonical}.` : canonical;
}

function canonicalizeLabel(label: string): string {
  const canonical = domainToASCII(label.trim().toLowerCase());
  return canonical && isValidDnsLabel(canonical) ? canonical : "";
}

function isValidDnsLabel(label: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label);
}

/**
 * IDN table for the registry (RFC 5891-5893). The base ASCII LDH set plus a Latin-script
 * code point repertoire. U-labels outside this repertoire are rejected.
 */
const IDN_LATIN_EXTRA = "àáâäãåāçćčèéêëēěìíîïı\u00f1ńňòóôöõōøśšùúûüūýÿžźż";
const idnLabelPattern = new RegExp(`^[a-z0-9-${IDN_LATIN_EXTRA}]+$`, "u");

function isAllowedIdnLabel(unicodeLabel: string): boolean {
  return idnLabelPattern.test(unicodeLabel);
}

/** ICANN Specification 5-style reserved labels for a testing registry. */
const TECHNICAL_RESERVED_LABELS = new Set([
  "nic",
  "whois",
  "rdap",
  "www",
  "rdds",
  "registry",
  "registrar"
]);

/** Sample brand strings blocked to simulate sunrise/brand protection policy. */
const BRAND_RESERVED_LABELS = new Set(["nike", "google", "apple", "amazon", "microsoft"]);

function isReservedLabel(label: string): boolean {
  if (label.length === 2) {
    return true;
  }

  return TECHNICAL_RESERVED_LABELS.has(label) || BRAND_RESERVED_LABELS.has(label);
}
