export interface NameserverAddresses {
  owner: "ns1" | "ns2";
  a: string;
  aaaa: string;
}

export const TLD_NAMESERVER_ADDRESSES: readonly NameserverAddresses[] = [
  {
    owner: "ns1",
    a: "52.200.129.52",
    aaaa: "2600:1f18:79c4:5a00:91f7:3bf2:f396:c7c9"
  },
  {
    owner: "ns2",
    a: "44.207.35.249",
    aaaa: "2600:1f18:79c4:5a01:fca2:4974:cd49:7994"
  }
];
