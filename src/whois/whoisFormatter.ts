import type { DomainRecord } from "../domain/types.js";
import { RegistryPolicy, RegistryPolicyError, unicodeDomainName } from "../domain/registryPolicy.js";

export interface WhoisResult {
  query: string;
  response: string;
}

export function formatWhoisResponse(query: string, domain: DomainRecord | null, registryTld = "melendez"): WhoisResult {
  const normalizedQuery = query.trim().replace(/\.$/, "");
  const policy = new RegistryPolicy(registryTld);

  let canonicalName: string;
  let unicodeName: string;

  try {
    const normalized = policy.normalizeDomainName(normalizedQuery);
    canonicalName = normalized.canonicalName;
    unicodeName = normalized.unicodeName;
  } catch (error) {
    if (error instanceof RegistryPolicyError) {
      return {
        query: normalizedQuery,
        response: [`% Invalid query: ${normalizedQuery}`, `% ${error.reason}`, ""].join("\r\n")
      };
    }

    throw error;
  }

  if (!domain) {
    return {
      query: canonicalName,
      response: [`No match for "${canonicalName}"`, "", ...disclaimerFooter()].join("\r\n")
    };
  }

  const lines = [
    `Domain Name: ${domain.name}`,
    `Unicode Name: ${unicodeDomainName(domain.name)}`,
    `Registry Domain ID: ${domain.name}-EPP`,
    `Registrar: ${domain.registrarId}`,
    `Creation Date: ${domain.createdAt}`,
    `Updated Date: ${domain.updatedAt ?? ""}`,
    `Registry Expiry Date: ${domain.expiresAt}`,
    ...domain.statuses.map((status) => `Domain Status: ${status}`),
    ...domain.nameservers.map((nameserver) => `Name Server: ${nameserver}`),
    domain.registrantContact ? `Registrant Contact: ${domain.registrantContact}` : "",
    ...domain.contacts.map((contact) => `${contact.type.toUpperCase()} Contact: ${contact.id}`),
    `DNSSEC: ${domain.dsRecords.length ? "signedDelegation" : "unsigned"}`,
    ...domain.dsRecords.map(
      (record) => `DS Record: ${record.keyTag} ${record.algorithm} ${record.digestType} ${record.digest}`
    ),
    "",
    `>>> Last update of WHOIS database: ${new Date().toISOString()} <<<`,
    "",
    ...disclaimerFooter()
  ].filter((line) => line !== "");

  return {
    query: canonicalName,
    response: `${lines.join("\r\n")}\r\n`
  };
}

/**
 * ICANN Specification 4 requires a limited-data disclaimer pointing registrants to
 * the centralized lookup service.
 */
function disclaimerFooter(): string[] {
  return [
    "% The registration data available in this service is limited. Additional data may be",
    "% available at https://lookup.icann.org",
    "% For more information on WHOIS status codes, please visit https://icann.org/epp",
    ""
  ];
}
