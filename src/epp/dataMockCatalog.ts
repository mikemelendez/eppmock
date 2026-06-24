/**
 * Single source of truth for the data-based mock mode (port 7001).
 *
 * In this mode the server is stateless: every response is derived from substrings ("tags") in
 * the request data, never from the database. The catalog below is consumed by the
 * DataMockHandler for matching AND rendered into the dashboard / README documentation tables, so
 * the behavior and the docs can never drift apart.
 */

/** Case-insensitive substring triggers checked against a command's primary identifier. */
export const MOCK_TAGS = {
  invalid: "invalid",
  policy: "policy",
  linked: "linked",
  pending: "pending",
  unavailable: "unavailable"
} as const;

export function includesTag(identifier: string | undefined, tag: string): boolean {
  return (identifier ?? "").toLowerCase().includes(tag.toLowerCase());
}

export interface MockVariation {
  variation: string;
  tag: string;
  resultCode: string;
  exampleRequest: string;
  exampleResponse: string;
}

export interface MockCommandDoc {
  command: string;
  identifier: string;
  variations: MockVariation[];
}

const loginReq = (clid: string) =>
  `<command><login><clID>${clid}</clID><pw>any</pw><options><version>1.0</version><lang>en</lang></options><svcs><objURI>urn:ietf:params:xml:ns:domain-1.0</objURI></svcs></login></command>`;
const domainReq = (action: string, name: string, body = "") =>
  `<command><${action}><domain:${action} xmlns:domain="urn:ietf:params:xml:ns:domain-1.0"><domain:name>${name}</domain:name>${body}</domain:${action}></${action}></command>`;
const contactReq = (action: string, id: string) =>
  `<command><${action}><contact:${action} xmlns:contact="urn:ietf:params:xml:ns:contact-1.0"><contact:id>${id}</contact:id></contact:${action}></${action}></command>`;
const hostReq = (action: string, name: string) =>
  `<command><${action}><host:${action} xmlns:host="urn:ietf:params:xml:ns:host-1.0"><host:name>${name}</host:name></host:${action}></${action}></command>`;

export const dataMockCatalog: MockCommandDoc[] = [
  {
    command: "hello",
    identifier: "(none)",
    variations: [
      {
        variation: "Greeting",
        tag: "always",
        resultCode: "greeting",
        exampleRequest: "<hello/>",
        exampleResponse: "<greeting> with svcMenu + dcp"
      }
    ]
  },
  {
    command: "login",
    identifier: "clID",
    variations: [
      {
        variation: "Authentication error",
        tag: 'clID contains "invalid"',
        resultCode: "2200",
        exampleRequest: loginReq("invalid-user"),
        exampleResponse: "Authentication error"
      },
      {
        variation: "Success",
        tag: "any other clID (default)",
        resultCode: "1000",
        exampleRequest: loginReq("valid-user"),
        exampleResponse: "Command completed successfully"
      }
    ]
  },
  {
    command: "logout",
    identifier: "(none)",
    variations: [
      {
        variation: "Session ended",
        tag: "always",
        resultCode: "1500",
        exampleRequest: "<command><logout/></command>",
        exampleResponse: "Command completed successfully; ending session"
      }
    ]
  },
  {
    command: "domain:check",
    identifier: "domain:name",
    variations: [
      {
        variation: "Unavailable",
        tag: 'name contains "invalid" or "unavailable"',
        resultCode: "1000",
        exampleRequest: domainReq("check", "invalid.melendez"),
        exampleResponse: 'chkData with avail="0"'
      },
      {
        variation: "Available",
        tag: "any other name (default)",
        resultCode: "1000",
        exampleRequest: domainReq("check", "valid.melendez"),
        exampleResponse: 'chkData with avail="1"'
      }
    ]
  },
  {
    command: "domain:create",
    identifier: "domain:name",
    variations: [
      {
        variation: "Object exists",
        tag: 'name contains "invalid"',
        resultCode: "2302",
        exampleRequest: domainReq("create", "invalid.melendez"),
        exampleResponse: "Object exists"
      },
      {
        variation: "Parameter policy error",
        tag: 'name contains "policy"',
        resultCode: "2005",
        exampleRequest: domainReq("create", "policy.melendez"),
        exampleResponse: "Parameter value policy error"
      },
      {
        variation: "Created",
        tag: "any other name (default)",
        resultCode: "1000",
        exampleRequest: domainReq("create", "valid.melendez"),
        exampleResponse: "creData echoing the requested name"
      }
    ]
  },
  {
    command: "domain:info",
    identifier: "domain:name",
    variations: [
      {
        variation: "Object does not exist",
        tag: 'name contains "invalid"',
        resultCode: "2303",
        exampleRequest: domainReq("info", "invalid.melendez"),
        exampleResponse: "Object does not exist"
      },
      {
        variation: "Info",
        tag: "any other name (default)",
        resultCode: "1000",
        exampleRequest: domainReq("info", "valid.melendez"),
        exampleResponse: "infData synthesized from the request"
      }
    ]
  },
  {
    command: "domain:update",
    identifier: "domain:name",
    variations: [
      {
        variation: "Object does not exist",
        tag: 'name contains "invalid"',
        resultCode: "2303",
        exampleRequest: domainReq("update", "invalid.melendez"),
        exampleResponse: "Object does not exist"
      },
      {
        variation: "Updated",
        tag: "any other name (default)",
        resultCode: "1000",
        exampleRequest: domainReq("update", "valid.melendez"),
        exampleResponse: "Command completed successfully"
      }
    ]
  },
  {
    command: "domain:delete",
    identifier: "domain:name",
    variations: [
      {
        variation: "Object does not exist",
        tag: 'name contains "invalid"',
        resultCode: "2303",
        exampleRequest: domainReq("delete", "invalid.melendez"),
        exampleResponse: "Object does not exist"
      },
      {
        variation: "Association prohibits operation",
        tag: 'name contains "linked"',
        resultCode: "2305",
        exampleRequest: domainReq("delete", "linked.melendez"),
        exampleResponse: "Object association prohibits operation"
      },
      {
        variation: "Deleted",
        tag: "any other name (default)",
        resultCode: "1000",
        exampleRequest: domainReq("delete", "valid.melendez"),
        exampleResponse: "Command completed successfully"
      }
    ]
  },
  {
    command: "domain:renew",
    identifier: "domain:name",
    variations: [
      {
        variation: "Object does not exist",
        tag: 'name contains "invalid"',
        resultCode: "2303",
        exampleRequest: domainReq("renew", "invalid.melendez", "<domain:curExpDate>2026-01-01</domain:curExpDate>"),
        exampleResponse: "Object does not exist"
      },
      {
        variation: "Renewed",
        tag: "any other name (default)",
        resultCode: "1000",
        exampleRequest: domainReq("renew", "valid.melendez", "<domain:curExpDate>2026-01-01</domain:curExpDate>"),
        exampleResponse: "renData with a new expiry date"
      }
    ]
  },
  {
    command: "domain:transfer",
    identifier: "domain:name",
    variations: [
      {
        variation: "Object does not exist",
        tag: 'name contains "invalid"',
        resultCode: "2303",
        exampleRequest: `<command><transfer op="request"><domain:transfer xmlns:domain="urn:ietf:params:xml:ns:domain-1.0"><domain:name>invalid.melendez</domain:name></domain:transfer></transfer></command>`,
        exampleResponse: "Object does not exist"
      },
      {
        variation: "Transfer pending",
        tag: "any other name (default)",
        resultCode: "1001",
        exampleRequest: `<command><transfer op="request"><domain:transfer xmlns:domain="urn:ietf:params:xml:ns:domain-1.0"><domain:name>valid.melendez</domain:name></domain:transfer></transfer></command>`,
        exampleResponse: "Command completed successfully; action pending (trnData)"
      }
    ]
  },
  {
    command: "contact:check",
    identifier: "contact:id",
    variations: [
      {
        variation: "Unavailable",
        tag: 'id contains "invalid"',
        resultCode: "1000",
        exampleRequest: contactReq("check", "invalid-id"),
        exampleResponse: 'chkData with avail="0"'
      },
      {
        variation: "Available",
        tag: "any other id (default)",
        resultCode: "1000",
        exampleRequest: contactReq("check", "valid-id"),
        exampleResponse: 'chkData with avail="1"'
      }
    ]
  },
  {
    command: "contact:create",
    identifier: "contact:id",
    variations: [
      {
        variation: "Object exists",
        tag: 'id contains "invalid"',
        resultCode: "2302",
        exampleRequest: contactReq("create", "invalid-id"),
        exampleResponse: "Object exists"
      },
      {
        variation: "Created",
        tag: "any other id (default)",
        resultCode: "1000",
        exampleRequest: contactReq("create", "valid-id"),
        exampleResponse: "creData echoing the requested id"
      }
    ]
  },
  {
    command: "contact:info",
    identifier: "contact:id",
    variations: [
      {
        variation: "Object does not exist",
        tag: 'id contains "invalid"',
        resultCode: "2303",
        exampleRequest: contactReq("info", "invalid-id"),
        exampleResponse: "Object does not exist"
      },
      {
        variation: "Info",
        tag: "any other id (default)",
        resultCode: "1000",
        exampleRequest: contactReq("info", "valid-id"),
        exampleResponse: "infData synthesized from the request"
      }
    ]
  },
  {
    command: "host:check",
    identifier: "host:name",
    variations: [
      {
        variation: "Unavailable",
        tag: 'name contains "invalid"',
        resultCode: "1000",
        exampleRequest: hostReq("check", "ns1.invalid.melendez"),
        exampleResponse: 'chkData with avail="0"'
      },
      {
        variation: "Available",
        tag: "any other name (default)",
        resultCode: "1000",
        exampleRequest: hostReq("check", "ns1.valid.melendez"),
        exampleResponse: 'chkData with avail="1"'
      }
    ]
  },
  {
    command: "host:create",
    identifier: "host:name",
    variations: [
      {
        variation: "Object exists",
        tag: 'name contains "invalid"',
        resultCode: "2302",
        exampleRequest: hostReq("create", "ns1.invalid.melendez"),
        exampleResponse: "Object exists"
      },
      {
        variation: "Created",
        tag: "any other name (default)",
        resultCode: "1000",
        exampleRequest: hostReq("create", "ns1.valid.melendez"),
        exampleResponse: "creData echoing the requested name"
      }
    ]
  },
  {
    command: "host:info",
    identifier: "host:name",
    variations: [
      {
        variation: "Object does not exist",
        tag: 'name contains "invalid"',
        resultCode: "2303",
        exampleRequest: hostReq("info", "ns1.invalid.melendez"),
        exampleResponse: "Object does not exist"
      },
      {
        variation: "Info",
        tag: "any other name (default)",
        resultCode: "1000",
        exampleRequest: hostReq("info", "ns1.valid.melendez"),
        exampleResponse: "infData synthesized from the request"
      }
    ]
  },
  {
    command: "poll",
    identifier: "clTRID",
    variations: [
      {
        variation: "Message waiting",
        tag: 'op="req" and clTRID contains "pending"',
        resultCode: "1301",
        exampleRequest: '<command><poll op="req"/><clTRID>poll-pending</clTRID></command>',
        exampleResponse: "msgQ with one canned service message"
      },
      {
        variation: "No messages",
        tag: 'op="req" (default)',
        resultCode: "1300",
        exampleRequest: '<command><poll op="req"/><clTRID>poll-1</clTRID></command>',
        exampleResponse: "Command completed successfully; no messages"
      },
      {
        variation: "Acknowledged",
        tag: 'op="ack"',
        resultCode: "1000",
        exampleRequest: '<command><poll op="ack" msgID="any"/></command>',
        exampleResponse: "msgQ count=0"
      }
    ]
  }
];
