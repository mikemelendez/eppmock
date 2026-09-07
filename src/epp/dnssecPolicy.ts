import type { DomainDsRecord } from "../domain/types.js";

/** IANA DNSSEC algorithm numbers commonly accepted for DS records. */
const DS_ALGORITHMS = new Set([3, 5, 6, 7, 8, 10, 12, 13, 14, 15, 16]);

const DIGEST_HEX_LENGTH: Record<number, number> = {
  1: 40,
  2: 64,
  4: 96
};

export class DnssecPolicyError extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}

export function assertValidDsRecord(record: DomainDsRecord): void {
  if (!Number.isInteger(record.keyTag) || record.keyTag < 0 || record.keyTag > 65535) {
    throw new DnssecPolicyError("DS keyTag must be an unsigned short");
  }

  if (!DS_ALGORITHMS.has(record.algorithm)) {
    throw new DnssecPolicyError("DS algorithm is not a registered DNSSEC algorithm");
  }

  const digestLength = DIGEST_HEX_LENGTH[record.digestType];

  if (digestLength === undefined) {
    throw new DnssecPolicyError("DS digestType must be 1, 2, or 4");
  }

  if (!/^[A-Fa-f0-9]+$/.test(record.digest) || record.digest.length !== digestLength) {
    throw new DnssecPolicyError(`DS digest must be ${digestLength} hexadecimal characters`);
  }
}
