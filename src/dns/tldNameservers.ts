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
    a: "67.217.246.69",
    aaaa: "2607:f1c0:f07e:9100::1"
  }
];
