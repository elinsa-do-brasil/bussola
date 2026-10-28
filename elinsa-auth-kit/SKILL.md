---
name: elinsa-auth-kit
description: Põe o login da conta Elinsa (Sextans, OIDC) num app com o kit @elinsa/auth-kit, do registro shadcn privado @elinsa (auth.elinsadobrasil.com.br/r). No Next.js 16, instala o kit (token ELINSA_REGISTRY_TOKEN, components.json, shadcn add, variáveis SEXTANS_* e BETTER_AUTH_*, proxy.ts com sextansProxy, requireSession e requireOrganization). Em qualquer outro stack (Vite/React, SvelteKit, Nuxt, Remix, Astro, Express, Hono, Laravel, Django, .NET, Next antigo...), guia a conversão do kit para o stack do projeto mantendo o mesmo contrato de segurança. Use sempre que alguém quiser login, SSO ou entrar com a conta Elinsa ou pelo Sextans num app, proteger páginas por organização, instalar, portar ou atualizar o kit, ou quando aparecer um erro do registro ([unauthorized] Token do registro, 401, 403) ou do login pelo Sextans (redirect_uri, sem-acesso, sessao-encerrada), mesmo sem citar auth-kit nem registro. Não serve para mudar o próprio Sextans.
---

# Kit de login da conta Elinsa (registro `@elinsa`)

O **Sextans** é o login central da Elinsa (código por e-mail, passkey e
Microsoft 365), um provedor OIDC em `https://auth.elinsadobrasil.com.br`. Para
apps Next, ele serve um **registro shadcn privado**, o `@elinsa`. O comando
`shadcn add @elinsa/auth-kit` copia para o app o conector, a página `/entrar`,
o menu do usuário e as rotas do Better Auth. Isso entrega uns 90% do login, e
o resto (variáveis, `proxy.ts` e escolher o que proteger) fica com o app.

O código do kit não tem segredo nenhum. O que é secreto fica fora dele:

- o **token do registro**, que só serve para baixar o kit;
- o **segredo do aplicativo** e o `BETTER_AUTH_SECRET`, que ficam no servidor
  do app.

## Primeiro: qual é o stack?

O registro só tem a versão para **Next.js 16 com App Router** (usa `proxy.ts`,
que não existe no Next 15). Olhe o `package.json` (ou o equivalente do stack)
antes de qualquer outra coisa:

- **Next.js 16 com App Router**: siga o [passo a passo](#passo-a-passo) abaixo.
- **Qualquer outro stack** (Next 15 ou Pages Router, SvelteKit, Nuxt, Astro,
  React Router/Remix, Vite + React/Vue sem servidor, Express, Hono, Laravel,
  Django, .NET, Go...): o `shadcn add` não serve. **Converta o kit para o
  stack do projeto**, como em
  [Outro stack: converter o kit](#outro-stack-converter-o-kit). Não tente
  instalar a versão Next num projeto que não é Next, e não deixe o projeto sem
  login por isso.

Nos dois casos, o token do registro e o aplicativo no Sextans (abaixo) são os
mesmos.

## Antes de começar

No Next 16, confira o app:

- **shadcn inicializado**, ou seja, com `components.json`. Se não estiver, rode
  `pnpm dlx shadcn@latest init` antes.
- **`/entrar` e `/api/auth/*` livres.** O kit é dono dessas duas rotas. Se o
  app já tem outro login (NextAuth, outro Better Auth), combine com o usuário
  antes, porque um substitui o outro. Numa conversão vale o mesmo cuidado.

Duas coisas só uma pessoa faz, porque exigem entrar no Sextans pelo
navegador. Peça as duas logo no começo, já que a segunda depende da TI e pode
demorar:

1. **O token do registro**, criado pelo próprio dev em **Minha conta → Tokens
   do registro**. A seção só aparece para quem está na organização
   `desenvolvimento`. O token começa com `elinsa_reg_`, vale 90 dias e aparece
   uma vez só. Para criar, o Sextans pede um login de menos de 1 hora; se ele
   disser "Por segurança, entre de novo antes de continuar.", é só sair e
   entrar.
2. **O aplicativo no Sextans**, criado pela TI em **Administração →
   Aplicativos**. A TI devolve o ID e o segredo, também mostrados uma vez só.
   Passe a ela:

   | O que | Valor |
   |---|---|
   | Nome do app | aparece na tela de entrar ("Entrar em <app>") |
   | Endereço de volta | `<origem>/api/auth/callback/sextans`, um por ambiente (ex.: `http://localhost:3000/api/auth/callback/sextans` e `https://app.elinsadobrasil.com.br/api/auth/callback/sextans`) |
   | Endereço depois de sair | `<origem>/`, com a barra |
   | Quem pode entrar | as organizações (ex.: `elinsa` para todo mundo, ou `almoxarifado`) |
   | Desenvolvimento? | marque "Aplicativo de desenvolvimento" para aceitar `http://localhost` |

## Passo a passo

### 1. Ligar o registro no `components.json`

```json
"registries": {
  "@elinsa": {
    "url": "https://auth.elinsadobrasil.com.br/r/{name}.json",
    "headers": { "Authorization": "Bearer ${ELINSA_REGISTRY_TOKEN}" }
  }
}
```

O registro fica em `<SEXTANS_URL>/r/{name}.json`. O exemplo acima é o de
produção. Se o usuário trabalha com outro Sextans (homologação, ou o local em
`http://localhost:3003`), use o endereço desse Sextans. Um token só vale no
Sextans onde foi criado, então não teste o token em outro ambiente: o 401 que
volta não diz nada, e a tentativa fica no log do outro Sextans.

Escreva o `${ELINSA_REGISTRY_TOKEN}` exatamente assim. O token **nunca** vai
literal nesse arquivo, porque o `components.json` vai para o git e o token é
pessoal: cada leitura do registro fica na auditoria do Sextans com o nome do
dono. O shadcn expande a variável sozinho. Ele lê o ambiente do shell e, na
pasta do app, os arquivos `.env.local`, `.env.development.local`,
`.env.development` e `.env`. O shell vale mais que os arquivos.

Se já existir um `"registries": {}`, acrescente a entrada `@elinsa` dentro
dele. O `shadcn registry add` não põe o cabeçalho, então edite à mão.

### 2. Guardar o token no `.env.local`

```bash
# .env.local (fora do git)
ELINSA_REGISTRY_TOKEN=elinsa_reg_...
```

O ideal é o usuário colar o token direto no arquivo. Se ele colar o token na
conversa, grave no `.env.local` sem repetir o valor na resposta.

Confirme que o arquivo está fora do git com `git check-ignore -v .env.local`
(e o mesmo para `.env`, se ele existir). O `create-next-app` já ignora
`.env*`.

### 3. Conferir o token antes de instalar

```bash
node <pasta desta skill>/scripts/verificar.mjs        # na pasta do app
```

O script confere o `components.json`, acha o token como o shadcn acharia,
testa o token no registro e diz o que o código HTTP quer dizer, sem mostrar o
token. Depois de instalar, ele também confere as variáveis e o `proxy.ts`. Use
`--sem-rede` para pular o teste no registro.

### 4. Instalar

```bash
pnpm dlx shadcn@latest add @elinsa/auth-kit          # ou npx / bunx, conforme o app
```

Para ver antes o que vai mudar, use `--dry-run`. O comando:

- instala `better-auth@1.7.10` (versão exata, a mesma do Sextans) e `jose`;
- traz o `button` e o `card` do shadcn, no estilo do app (se o app já os tem,
  ele pergunta antes de sobrescrever);
- acrescenta as variáveis vazias ao arquivo de env. Ele usa o `.env.local` ou,
  se o app já tiver outro arquivo de env (como o `.env`), esse outro.

| Arquivo | O que faz |
|---|---|
| `lib/sextans/config.ts` | lê as variáveis (só no servidor) |
| `lib/sextans/auth.ts` | Better Auth sem banco, com o Sextans como provedor OIDC (PKCE) |
| `lib/sextans/proxy.ts` | `sextansProxy()`: manda quem não entrou para `/entrar` e renova os tokens |
| `lib/sextans/session.ts` | `getSession()`, `requireSession()` e `requireOrganization()` |
| `lib/sextans/actions.ts` | `signOut()`: sai do app e do Sextans |
| `lib/sextans/auth-client.ts` | cliente do Better Auth para a página de entrar |
| `lib/sextans/README.md` | o que falta fazer no app (o mesmo deste passo a passo) |
| `app/api/auth/[...all]/route.ts` | rotas do Better Auth (a volta do Sextans chega aqui) |
| `app/entrar/page.tsx` | botão "Entrar com a conta Elinsa" e os avisos |
| `components/menu-usuario.tsx` | iniciais, nome, e-mail e "Sair" |

Os caminhos seguem os aliases do `components.json` de quem instala, e os
imports são reescritos para eles (ex.: `@/lib/sextans/auth`). Num app com
`src/`, confira se os arquivos caíram no lugar certo.

### 5. Preencher as variáveis

| Variável | Valor |
|---|---|
| `SEXTANS_URL` | `https://auth.elinsadobrasil.com.br` (Sextans local: `http://localhost:3003`) |
| `SEXTANS_CLIENT_ID`, `SEXTANS_CLIENT_SECRET` | o que a TI devolveu |
| `BETTER_AUTH_SECRET` | `openssl rand -hex 32`, um por app e por ambiente |
| `BETTER_AUTH_URL` | a origem do app, sem barra no fim (ex.: `http://localhost:3000`) |

Pode gerar o `BETTER_AUTH_SECRET` você mesmo. O segredo do aplicativo só a TI
tem.

O `BETTER_AUTH_URL` precisa bater com o endereço de volta cadastrado
(protocolo, host e porta). A diferença mais comum é a porta do `next dev`.

Nenhuma dessas variáveis leva `NEXT_PUBLIC_`, porque todas ficam só no
servidor. Em produção, elas vão nas configurações do servidor do app (Vercel,
Container Apps etc.), não num arquivo. Depois de mudar o env, reinicie o
`next dev`.

### 6. Criar o `proxy.ts` na raiz do app (ou em `src/`)

```ts
import type { NextRequest } from "next/server";
import { sextansProxy } from "@/lib/sextans/proxy";

export function proxy(request: NextRequest) {
  // Caminhos que não pedem login (o /entrar e o /api/auth já são abertos).
  return sextansProxy(request, { publicPaths: ["/"] });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
```

- O `"/"` em `publicPaths` libera só a página inicial. Os outros caminhos
  liberam também o que vem embaixo deles (`"/sobre"` libera `/sobre/equipe`).
- O `matcher` precisa cobrir **toda** página que lê a sessão. O
  `getSession()` lê um cabeçalho que só o proxy põe, então numa rota fora do
  matcher ele devolve sempre `null`.
- Se o app já tem um `proxy.ts`, junte os dois: chame o `sextansProxy` e
  devolva a resposta dele, ou encadeie a sua lógica antes. Não troque um pelo
  outro sem combinar.

### 7. Proteger no servidor

O proxy é só a primeira barreira, e esconder um link não protege nada. A
checagem de verdade vai em cada página, layout, route handler e server action
restritos:

- `requireSession(voltar)`: só quem entrou; quem não entrou vai para
  `/entrar?voltar=...`;
- `requireOrganization("ti" | ["ti", "diretoria"], voltar)`: só quem está numa
  das organizações; quem não está vai para `/entrar?erro=sem-acesso`;
- `getSession()`: a pessoa ou `null`, para mostrar quem entrou.

Apps novos do `create-next-app` 16.4 vêm com **Cache Components**. Com ele,
quem lê a sessão precisa ficar dentro de um `<Suspense>`, senão o
`next build` falha com erro de dado de runtime fora do Suspense:

```tsx
import { Suspense } from "react";
import { requireOrganization } from "@/lib/sextans/session";

export default function EstoquePage() {
  return (
    <Suspense fallback={<p>Carregando…</p>}>
      <Estoque />
    </Suspense>
  );
}

async function Estoque() {
  const { user } = await requireOrganization("almoxarifado", "/estoque");
  return <p>Olá, {user.name}.</p>;
}
```

Em server actions, chame o `require*` na primeira linha. Em route handlers
chamados por `fetch`, um redirect para uma página HTML não ajuda quem chamou.
Prefira o `getSession()` e devolva `401` ou `403`:

```ts
const session = await getSession();
if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
if (!session.user.organizations.some((o) => o.slug === "ti")) {
  return Response.json({ error: "forbidden" }, { status: 403 });
}
```

A sessão traz `user.id` (o mesmo em todos os apps), `user.name`, `user.email`
e `user.organizations` (`[{ slug, role }]`).

### 8. Mostrar quem entrou

```tsx
import { Suspense } from "react";
import Link from "next/link";
import { MenuUsuario } from "@/components/menu-usuario";
import { getSession } from "@/lib/sextans/session";

export function Header() {
  return (
    <header>
      {/* ...navegação... */}
      <Suspense fallback={<div className="h-8" />}>
        <UserArea />
      </Suspense>
    </header>
  );
}

async function UserArea() {
  const session = await getSession();
  if (session) return <MenuUsuario user={session.user} />;
  return <Link href="/entrar">Entrar</Link>;
}
```

### 9. Testar

1. Rode o typecheck, o lint e o `next build`, e depois o `verificar.mjs` de
   novo (agora ele confere as variáveis e o proxy). Se o lint acusar
   `react-hooks/set-state-in-effect` na `app/entrar/page.tsx`, o problema é do
   kit, e o [problemas.md](references/problemas.md) diz o que fazer.
2. No navegador, abra uma página protegida. O esperado: a tela da conta Elinsa
   com o nome do app, depois a volta logado à mesma página.
3. Teste uma página de organização com alguém de fora dela (deve aparecer o
   aviso de sem acesso) e o "Sair" (deve encerrar as duas sessões e voltar à
   página inicial).

## Atualizar o kit

```bash
pnpm dlx shadcn@latest add @elinsa/auth-kit --diff        # ver o que mudou
pnpm dlx shadcn@latest add @elinsa/auth-kit --overwrite   # aplicar
```

Revise o `git diff` antes de commitar.

- Não mude os arquivos de `lib/sextans/`: o `--overwrite` apaga as mudanças.
  O que é do app (proxy, páginas, cabeçalho) fica fora dessa pasta.
- O `app/entrar/page.tsx` pode ser adaptado ao visual do app. Nesse caso,
  atualize com `--diff` e junte à mão, sem `--overwrite` nesse arquivo.
- Commite os arquivos instalados: eles não têm segredo, e assim o CI e os
  outros devs não precisam do token do registro.

## Segurança

| Regra | Por quê |
|---|---|
| Token do registro só no `.env.local` ou no shell, nunca no `components.json`, no CI ou na conversa | é pessoal e cada uso sai na auditoria com o nome do dono. Se vazou, revogue em **Minha conta** e crie outro |
| `SEXTANS_CLIENT_SECRET` e `BETTER_AUTH_SECRET` só no servidor, sem `NEXT_PUBLIC_` | com eles, qualquer um se passa pelo app ou forja a sessão dele |
| Um `BETTER_AUTH_SECRET` por app e por ambiente | é a chave que cifra o cookie da sessão; repetir junta o risco de todos |
| Toda área restrita checa no servidor (`require*`) | o proxy é otimista e roda antes; ele não substitui a checagem na página |
| Não reaproveite o aplicativo de outro app | cada app tem endereços de volta, organizações e auditoria próprios |

## Monorepo

O `shadcn add` segue os aliases do `components.json` do app. Se o alias `ui`
aponta para um pacote compartilhado (como o `@workspace/ui`), as dependências
e o `button`/`card` vão para esse pacote e podem sobrescrever os componentes
dele. Rode antes com `-c apps/<app> --dry-run` e confira. No próprio
argo-navis, o `apps/sextans-exemplo` não usa o `shadcn add`: ele usa o
`pnpm --filter sextans-exemplo kit:sync`.

## Itens do registro

| Item | Tipo | Quando usar |
|---|---|---|
| `auth-kit` | block | quase sempre: tudo de uma vez |
| `sextans` | lib | só o conector, para quem faz a própria tela de entrar e o próprio menu |
| `entrar` | page | só a página `/entrar` (depende do `sextans`) |
| `menu-usuario` | component | só o menu (depende do `sextans`) |

`pnpm dlx shadcn@latest view @elinsa/auth-kit` mostra o conteúdo de um item
sem instalar. Um nome errado dá `[not_found] Este item não existe no registro
@elinsa.`

## Quando algo dá errado

Os erros mais comuns estão abaixo. A lista completa, organizada por onde o
erro aparece, está em [references/problemas.md](references/problemas.md).

| Sintoma | Causa provável |
|---|---|
| `[unauthorized] Token do registro ausente, inválido, vencido ou revogado` | token errado, vencido (90 dias) ou revogado, ou a variável não foi achada |
| `[forbidden] Este token é de quem não está mais na organização Desenvolvimento` | o dono do token saiu da `desenvolvimento`: peça à TI |
| Erro de `redirect_uri` na tela do Sextans | o endereço de volta não bate com o cadastrado (porta, `http`/`https`, caminho) |
| Fica no `/sem-acesso` do Sextans | a pessoa não está em nenhuma organização que o aplicativo aceita |
| `getSession()` sempre `null` | a rota está fora do `matcher` do proxy, ou faltam variáveis |

Como o kit funciona por dentro (sessão, renovação a cada 15 minutos, cabeçalho
interno, saída) e a referência de cada função estão em
[references/kit.md](references/kit.md). Leia esse arquivo quando precisar
mexer na integração além do passo a passo, ou explicar por que o acesso
demora a cair.

## Outro stack: converter o kit

Num projeto que não é Next 16, use o kit como implementação de referência e
reescreva no stack do projeto. Antes de escrever código, leia
[references/outros-stacks.md](references/outros-stacks.md) inteiro. Ele tem o
contrato, o mapa peça por peça e as armadilhas de cada caminho. Em resumo:

1. **Peça o token e o aplicativo** como em [Antes de começar](#antes-de-começar).
   O endereço de volta pode ser outro caminho, desde que seja o mesmo
   cadastrado na TI.
2. **Baixe o kit como referência**, com o token no `.env.local` ou no shell:
   `node <pasta desta skill>/scripts/baixar-kit.mjs`. Ele grava os arquivos
   numa pasta temporária, sem instalar nada. Leia `lib/sextans/*.ts` e a
   página `/entrar`.
3. **Escolha o caminho**:
   - JS/TS com servidor (SvelteKit, Nuxt, Astro, Remix, Express, Hono, Next
     antigo...): porte o kit com o mesmo `better-auth` sem banco;
   - outra linguagem: use a biblioteca OIDC do stack;
   - SPA sem servidor: precisa de um servidor pequeno ao lado (BFF), porque o
     segredo não pode ir para o navegador.
4. **Mantenha o contrato**:
   - PKCE `S256` com cliente confidencial;
   - sessão em cookie `HttpOnly` de até 8 h;
   - renovação a cada 15 minutos que derruba a sessão se o Sextans recusar;
   - organizações do ID token mais recente, com a assinatura conferida;
   - checagem no servidor em cada rota restrita;
   - `voltar` só com caminhos do app;
   - saída pelo `end-session` do Sextans, por `POST`.
5. **Confira** com a lista da seção 7 do guia e **documente** no README do app
   que o login é uma conversão do `@elinsa/auth-kit` (e de que data), para
   acompanhar as mudanças do kit depois.

O `verificar.mjs` também roda fora do Next. Ali ele confere só o token e o
acesso ao registro.

## Mudar o kit ou o Sextans

O fonte do kit fica no repositório argo-navis:
`apps/sextans/registry/elinsa/**` e `apps/sextans/registry.json`. O
`pnpm --filter sextans build` gera o `dist/r`, e depois é preciso rodar o
`pnpm --filter sextans-exemplo kit:sync`. O README do Sextans tem o resto.
Esta skill é para quem **usa** o kit num app.
