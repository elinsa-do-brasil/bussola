#!/usr/bin/env node
// Confere se um app está pronto para usar o registro @elinsa e, no Next 16, o
// kit de login da conta Elinsa. Nunca imprime o token nem os segredos.
//
//   node verificar.mjs [pasta do app] [--sem-rede]
//
// Sai com 1 se achar algum erro (✖); avisos (⚠) não mudam a saída.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
const offline = args.includes("--sem-rede");
const appDir = resolve(args.find((a) => !a.startsWith("--")) ?? ".");

let errors = 0;
const ok = (msg) => console.log(`  ✔ ${msg}`);
const warn = (msg) => console.log(`  ⚠ ${msg}`);
const fail = (msg) => {
  errors++;
  console.log(`  ✖ ${msg}`);
};
const section = (title) => console.log(`\n${title}`);

/** Lê um arquivo .env simples (KEY=valor, com ou sem aspas e export). */
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

/** Procura a variável como o shadcn/dotenv: o shell primeiro, depois os arquivos na ordem. */
function lookup(name, files) {
  if (process.env[name] !== undefined) return { value: process.env[name], from: "shell" };
  for (const file of files) {
    const path = join(appDir, file);
    if (!existsSync(path)) continue;
    const vars = parseEnvFile(path);
    if (vars[name] !== undefined) return { value: vars[name], from: file };
  }
  return null;
}

function git(...gitArgs) {
  try {
    execFileSync("git", ["-C", appDir, ...gitArgs], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

async function get(url, headers = {}) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
  const text = await response.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {}
  return { status: response.status, body };
}

// Ordens de leitura: a do shadcn (para o token) e a do `next dev` (para o app).
const SHADCN_ENV = [".env.local", ".env.development.local", ".env.development", ".env"];
const NEXT_DEV_ENV = [".env.development.local", ".env.local", ".env.development", ".env"];

/** Sem o @elinsa no components.json: o registro do Sextans do app (SEXTANS_URL) ou o de produção. */
function defaultRegistry() {
  const sextans = lookup("SEXTANS_URL", NEXT_DEV_ENV)?.value?.replace(/\/$/, "");
  const base = sextans || "https://auth.elinsadobrasil.com.br";
  console.log(
    `  · uso o registro de ${sextans ? "SEXTANS_URL" : "produção"} (${base}/r); o token só vale no Sextans onde foi criado.`,
  );
  return { url: `${base}/r/{name}.json`, headers: { Authorization: "Bearer ${ELINSA_REGISTRY_TOKEN}" } };
}

console.log(`App: ${appDir}`);

// ---------------------------------------------------------------- app
section("App");
const pkgPath = join(appDir, "package.json");
if (!existsSync(pkgPath)) {
  fail("não achei package.json nesta pasta. Rode na pasta do app (ou passe o caminho).");
  process.exit(1);
}
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const deps = { ...pkg.dependencies, ...pkg.devDependencies };
const nextVersion = deps.next;
const nextMajor = Number(/^[\^~>=v\s]*(\d+)/.exec(nextVersion ?? "")?.[1]);
// Fora do Next 16 o kit não se instala: ele é convertido (references/outros-stacks.md).
const isNext16 = Boolean(nextVersion) && !(nextMajor && nextMajor < 16);
if (isNext16) ok(`next ${nextVersion}`);
else {
  warn(
    `${nextVersion ? `next ${nextVersion}` : "o projeto não usa Next"}: o kit não se instala aqui, ele é convertido ` +
      "para o stack (references/outros-stacks.md). Confiro só o token e o acesso ao registro, para o baixar-kit.mjs.",
  );
}

// ---------------------------------------------------------------- components.json
section("components.json");
const componentsPath = join(appDir, "components.json");
let registry = null;
if (!existsSync(componentsPath)) {
  if (isNext16) fail("sem components.json: rode `pnpm dlx shadcn@latest init` antes.");
  else {
    console.log("  · sem components.json (normal fora do Next).");
    registry = defaultRegistry();
  }
} else {
  const raw = readFileSync(componentsPath, "utf8");
  if (/elinsa_reg_[A-Za-z0-9]/.test(raw)) {
    fail(
      "há um token do registro ESCRITO no components.json. Troque por ${ELINSA_REGISTRY_TOKEN}, " +
        "guarde o token no .env.local e, se o arquivo já foi commitado ou compartilhado, revogue o token.",
    );
  }
  const components = JSON.parse(raw);
  registry = components.registries?.["@elinsa"];
  if (!registry && !isNext16) {
    console.log("  · components.json sem @elinsa (normal fora do Next).");
    registry = defaultRegistry();
  } else if (!registry) {
    fail('falta "registries" → "@elinsa" (veja o passo 1 da skill).');
  } else {
    const url = typeof registry === "string" ? registry : registry.url;
    if (!url?.includes("{name}")) fail(`a url do @elinsa precisa ter {name}: ${url}`);
    else ok(`url: ${url}`);
    const auth = typeof registry === "string" ? undefined : registry.headers?.Authorization;
    if (!auth) fail("o @elinsa está sem o cabeçalho Authorization.");
    else if (!/\$\{[A-Z0-9_]+\}/.test(auth)) fail("o Authorization deveria usar ${ELINSA_REGISTRY_TOKEN}.");
    else ok("Authorization lê o token de uma variável");
  }
}

// ---------------------------------------------------------------- token
section("Token do registro");
const tokenVar =
  (typeof registry === "object" && /\$\{([A-Z0-9_]+)\}/.exec(registry?.headers?.Authorization ?? "")?.[1]) ||
  "ELINSA_REGISTRY_TOKEN";
const token = lookup(tokenVar, SHADCN_ENV);
if (!token?.value) {
  fail(`${tokenVar} não está no shell nem em ${SHADCN_ENV.join(", ")}.`);
} else {
  ok(`${tokenVar} vem de ${token.from} (${token.value.length} caracteres)`);
  if (!token.value.startsWith("elinsa_reg_"))
    warn("o token não começa com elinsa_reg_: confira se copiou o valor certo.");
  if (/\s/.test(token.value)) fail("o token tem espaço no meio ou no fim.");
}

// ---------------------------------------------------------------- git
section("Git");
const isRepo = git("rev-parse", "--is-inside-work-tree");
if (!isRepo) {
  warn("a pasta não é um repositório git: não deu para conferir o .gitignore.");
} else {
  for (const file of [".env", ".env.local", ".env.development", ".env.development.local"]) {
    if (!existsSync(join(appDir, file))) continue;
    if (git("ls-files", "--error-unmatch", file)) fail(`${file} está commitado no git: tire do git e revogue o que estiver nele.`);
    else if (!git("check-ignore", "-q", file)) fail(`${file} não está no .gitignore.`);
    else ok(`${file} fora do git`);
  }
}

// ---------------------------------------------------------------- registro (rede)
if (!offline && typeof registry === "object" && registry?.headers?.Authorization && token?.value) {
  section("Registro (rede)");
  const url = (typeof registry === "string" ? registry : registry.url).replace("{name}", "registry");
  const auth = registry.headers.Authorization.replace(/\$\{([A-Z0-9_]+)\}/g, (_, name) =>
    name === tokenVar ? token.value : (lookup(name, SHADCN_ENV)?.value ?? ""),
  );
  try {
    const { status, body } = await get(url, { Authorization: auth });
    const message = body?.message ? ` (${body.message})` : "";
    const meaning = {
      200: "token aceito: o `shadcn add @elinsa/auth-kit` deve funcionar",
      401: "token ausente, inválido, vencido ou revogado: crie outro em Minha conta → Tokens do registro",
      403: "o dono do token não está mais na organização desenvolvimento: peça à TI",
      404: "o servidor respondeu, mas sem o registro nessa URL: confira a url do components.json",
      429: "muitos pedidos com este token: espere um minuto",
    }[status];
    if (status === 200) ok(`${status}: ${meaning}`);
    else fail(`${status}: ${meaning ?? `resposta inesperada${message}`}`);
  } catch (error) {
    fail(`não deu para falar com ${new URL(url).origin}: ${error.cause?.code ?? error.message}`);
  }
}

// ---------------------------------------------------------------- kit instalado
const kitDir = ["lib/sextans", "src/lib/sextans"].map((d) => join(appDir, d)).find((d) => existsSync(join(d, "config.ts")));
section("Kit instalado");
if (!isNext16) {
  console.log("  · fora do Next a conferência do login é a lista da seção 7 de references/outros-stacks.md.");
} else if (!kitDir) {
  console.log("  · o kit ainda não está instalado (lib/sextans/config.ts não existe); o resto fica para depois do `shadcn add`.");
} else {
  ok(`kit em ${kitDir.slice(appDir.length + 1)}`);

  // Variáveis do app
  const read = (name) => lookup(name, NEXT_DEV_ENV);
  for (const name of ["SEXTANS_URL", "SEXTANS_CLIENT_ID", "SEXTANS_CLIENT_SECRET", "BETTER_AUTH_SECRET", "BETTER_AUTH_URL"]) {
    const found = read(name);
    if (!found?.value) fail(`${name} vazia ou ausente.`);
    else ok(`${name} definida (${found.from})`);
  }
  const secret = read("BETTER_AUTH_SECRET")?.value;
  if (secret && secret.length < 32) fail("BETTER_AUTH_SECRET curto: gere com `openssl rand -hex 32`.");
  const appUrl = read("BETTER_AUTH_URL")?.value;
  if (appUrl) {
    if (appUrl.endsWith("/")) warn("BETTER_AUTH_URL termina com barra: tire a barra.");
    try {
      const origin = new URL(appUrl).origin;
      console.log(`  · endereço de volta para a TI cadastrar: ${origin}/api/auth/callback/sextans`);
      console.log(`  · endereço depois de sair: ${origin}/`);
    } catch {
      fail(`BETTER_AUTH_URL não é uma URL: ${appUrl}`);
    }
  }
  for (const file of NEXT_DEV_ENV) {
    const path = join(appDir, file);
    if (!existsSync(path)) continue;
    for (const name of Object.keys(parseEnvFile(path))) {
      if (/^NEXT_PUBLIC_.*(SECRET|SEXTANS|BETTER_AUTH)/.test(name))
        fail(`${name} em ${file}: segredo do login não pode ter NEXT_PUBLIC_ (vai para o navegador).`);
    }
  }

  // Sextans no ar e com o emissor certo
  const sextansUrl = read("SEXTANS_URL")?.value?.replace(/\/$/, "");
  if (!offline && sextansUrl) {
    try {
      const { status, body } = await get(`${sextansUrl}/api/auth/.well-known/openid-configuration`);
      if (status === 200 && body?.issuer === `${sextansUrl}/api/auth`) ok(`Sextans responde em ${sextansUrl}`);
      else fail(`a descoberta OIDC em ${sextansUrl} respondeu ${status}${body?.issuer ? ` com issuer ${body.issuer}` : ""}.`);
    } catch (error) {
      fail(`não deu para falar com o Sextans em ${sextansUrl}: ${error.cause?.code ?? error.message}`);
    }
  }

  // proxy.ts
  const proxyFile = ["proxy.ts", "src/proxy.ts", "proxy.js", "src/proxy.js"].map((f) => join(appDir, f)).find(existsSync);
  if (!proxyFile) fail("falta o proxy.ts na raiz do app (ou em src/), chamando sextansProxy.");
  else if (!readFileSync(proxyFile, "utf8").includes("sextansProxy")) fail(`${proxyFile.slice(appDir.length + 1)} não chama sextansProxy.`);
  else ok(`${proxyFile.slice(appDir.length + 1)} chama sextansProxy`);
  for (const f of ["middleware.ts", "src/middleware.ts"]) {
    if (existsSync(join(appDir, f))) warn(`${f} existe: no Next 16 ele virou proxy.ts; junte os dois.`);
  }
}

console.log(errors ? `\n${errors} problema(s) para resolver.` : "\nTudo certo.");
process.exit(errors ? 1 : 0);
