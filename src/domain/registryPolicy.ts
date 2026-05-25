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

    return {
      input,
      canonicalName,
      unicodeName: domainToUnicode(canonicalName),
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
