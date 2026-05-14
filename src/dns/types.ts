export interface DnsZoneOptions {
  dnssec: boolean;
  keyAction: "generate" | "renew";
  nsec3Hash: number;
  nsec3Flags: number;
  nsec3Iterations: number;
  nsec3Salt: string;
}

export interface DnssecKeyConfig {
  keyPath: string;
}

export interface ZoneRecord {
  owner: string;
  type: string;
  ttl: number;
  rdata: string;
  comment?: string;
}
