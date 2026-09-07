import { copyFile, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";

const hostname = process.env.EPP_HOSTNAME ?? "eppmock.melendez.mx";
const root = process.env.CADDY_CERTS_ROOT ?? "/caddy-data/caddy/certificates";
const dest = process.env.EPP_CERT_DIR ?? "/app/certs";

async function walk(dir) {
  let entries;

  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const files = [];

  for (const entry of entries) {
    const path = join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await walk(path)));
    } else {
      files.push(path);
    }
  }

  return files;
}

const files = await walk(root);
const crt = files.find((file) => file.endsWith(`/${hostname}.crt`) || file.endsWith(`\\${hostname}.crt`));
const key = files.find((file) => file.endsWith(`/${hostname}.key`) || file.endsWith(`\\${hostname}.key`));

if (!crt || !key) {
  console.error(`No Caddy certificate pair for ${hostname} under ${root}.`);
  console.error(`Looked for ${hostname}.crt and ${hostname}.key (${files.length} files found).`);
  for (const file of files.slice(0, 20)) {
    console.error(`  ${file}`);
  }
  process.exit(1);
}

await mkdir(dest, { recursive: true });
await copyFile(crt, join(dest, "fullchain.pem"));
await copyFile(key, join(dest, "privkey.pem"));
