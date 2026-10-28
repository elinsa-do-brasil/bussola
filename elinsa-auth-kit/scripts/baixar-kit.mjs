#!/usr/bin/env node
// Baixa um item do registro @elinsa como referência, para converter o kit para
// outro stack. Não instala nada no app e nunca imprime o token.
//
//   node baixar-kit.mjs [item] [--destino <pasta>] [--url <modelo>]
//
// item:     auth-kit (padrão), sextans, entrar ou menu-usuario
// destino:  pasta onde gravar (padrão: uma pasta nova no diretório temporário)
// url:      modelo do registro (padrão: o do components.json; senão
//           <SEXTANS_URL>/r/{name}.json; senão o de produção,
//           https://auth.elinsadobrasil.com.br/r/{name}.json)
//
// O token (ELINSA_REGISTRY_TOKEN) e o SEXTANS_URL vêm do shell primeiro, depois
// de .env.local, .env.development.local, .env.development e .env da pasta atual.
// O token só vale no Sextans onde foi criado.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const args = process.argv.slice(2);
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const positional = args.filter((a, i) => !a.startsWith("--") && !["--destino", "--url"].includes(args[i - 1]));
const item = positional[0] ?? "auth-kit";
const cwd = process.cwd();

if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item)) {
  console.error(`Nome de item inválido: ${item}`);
  process.exit(1);
}

function parseEnvFile(path) {
  const vars = {};
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(raw);
    if (!m) continue;
    let value = m[2].trim();
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.lastIndexOf(quote) > 0) {
      value = value.slice(1, value.lastIndexOf(quote));
    } else {
      value = value.replace(/\s+#.*$/, "");
    }
    vars[m[1]] = value;
  }
  return vars;
}

function readVar(name) {
  if (process.env[name]) return process.env[name];
  for (const file of [".env.local", ".env.development.local", ".env.development", ".env"]) {
    const path = join(cwd, file);
    if (!existsSync(path)) continue;
    const value = parseEnvFile(path)[name];
    if (value) return value;
  }
  return null;
}

/** De onde baixar: --url, o components.json, o SEXTANS_URL do app ou produção. */
function registryUrl() {
  const fromArgs = option("--url");
  if (fromArgs) return { url: fromArgs, from: "--url" };
  const componentsPath = join(cwd, "components.json");
  if (existsSync(componentsPath)) {
    try {
      const entry = JSON.parse(readFileSync(componentsPath, "utf8")).registries?.["@elinsa"];
      const url = typeof entry === "string" ? entry : entry?.url;
      if (url) return { url, from: "components.json" };
    } catch {}
  }
  const sextans = readVar("SEXTANS_URL")?.replace(/\/$/, "");
  if (sextans) return { url: `${sextans}/r/{name}.json`, from: "SEXTANS_URL" };
  return { url: "https://auth.elinsadobrasil.com.br/r/{name}.json", from: "produção" };
}

const token = readVar("ELINSA_REGISTRY_TOKEN");
if (!token) {
  console.error(
    "Sem ELINSA_REGISTRY_TOKEN no shell nem nos arquivos .env da pasta atual.\n" +
      "Crie o token em Minha conta → Tokens do registro (conta Elinsa) e ponha no .env.local, fora do git.",
  );
  process.exit(1);
}

const registry = registryUrl();
const url = registry.url.replace("{name}", item);
console.log(`Registro: ${new URL(url).origin} (de ${registry.from})`);
let response;
try {
  response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(20000),
  });
} catch (error) {
  console.error(`Não deu para falar com ${new URL(url).origin}: ${error.cause?.code ?? error.message}`);
  process.exit(1);
}
const text = await response.text();
let data = null;
try {
  data = JSON.parse(text);
} catch {}
if (!response.ok) {
  console.error(`${response.status}: ${data?.message ?? "resposta inesperada do registro"}`);
  process.exit(1);
}
if (!Array.isArray(data?.files)) {
  console.error("A resposta não é um item do registro (sem files).");
  process.exit(1);
}

const dest = resolve(option("--destino") ?? mkdtempSync(join(tmpdir(), `elinsa-${item}-`)));
mkdirSync(dest, { recursive: true });

/** Caminho de cada arquivo como ficaria num app: @lib/x → lib/x, @components/x → components/x. */
function localPath(file) {
  const target = file.target || file.path.replace(/^registry\/elinsa\//, "");
  return target.replace(/^@(lib|components|hooks|ui)\//, (_, dir) => (dir === "ui" ? "components/ui/" : `${dir}/`));
}

const written = [];
for (const file of data.files) {
  const path = localPath(file);
  const full = resolve(dest, path);
  if (!full.startsWith(dest)) continue; // nada fora da pasta de destino
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, file.content ?? "");
  written.push(path);
}

const { files: _files, ...meta } = data;
writeFileSync(join(dest, "_item.json"), `${JSON.stringify(meta, null, 2)}\n`);

console.log(`Item @elinsa/${item} gravado em ${dest}`);
for (const path of written) console.log(`  ${path}`);
console.log("  _item.json (dependências, variáveis e itens de que depende)");
if (meta.registryDependencies?.length) {
  console.log(`Depende também de: ${meta.registryDependencies.join(", ")} (componentes do shadcn, troque pelos do projeto).`);
}
console.log("Os imports apontam para @/registry/elinsa/...: é o fonte antes da reescrita do shadcn.");
