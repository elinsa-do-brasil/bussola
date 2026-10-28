# Converter o kit para outro stack

O registro `@elinsa` só tem a versão para Next.js 16 (App Router). Num projeto
de outro stack, o `shadcn add` não serve. Faça uma conversão:

1. baixe o kit como **referência**;
2. mantenha o **contrato** (abaixo);
3. troque as peças do Next pelas equivalentes do stack do projeto.

O resultado vira código do app, e não um item do registro. Por isso ele não se
atualiza com o `shadcn add --overwrite`; a seção 8 diz como acompanhar as
mudanças do kit.

## Sumário

1. [Baixar o kit como referência](#1-baixar-o-kit-como-referência)
2. [O contrato](#2-o-contrato)
3. [Escolher o caminho](#3-escolher-o-caminho)
4. [JS/TS com o Better Auth: peça por peça](#4-jsts-com-o-better-auth-peça-por-peça)
5. [Outra linguagem: biblioteca OIDC](#5-outra-linguagem-biblioteca-oidc)
6. [SPA sem backend](#6-spa-sem-backend)
7. [Conferir](#7-conferir)
8. [Documentar e acompanhar o kit](#8-documentar-e-acompanhar-o-kit)

## 1. Baixar o kit como referência

O token do registro é o mesmo da instalação em Next. Ele fica no
`.env.local`, no `.env` ou no shell, e o arquivo de env precisa estar fora do
git. Com ele:

```bash
node <pasta da skill>/scripts/baixar-kit.mjs                 # grava numa pasta temporária
node <pasta da skill>/scripts/baixar-kit.mjs --destino /tmp/kit-elinsa
```

O script baixa do Sextans do app: usa o `SEXTANS_URL` do env e, sem ele, o de
produção (`--url` escolhe outro). O token precisa ser desse mesmo Sextans.
Ele grava os arquivos do kit e um `_item.json` com as dependências e as
variáveis, e lista o que gravou. Ele não mostra o token. Os imports dos
arquivos baixados apontam para `@/registry/elinsa/...`, porque é o fonte antes
da reescrita do shadcn.

Leia `lib/sextans/*.ts` e `app/entrar/page.tsx` antes de escrever qualquer
coisa. Eles são a implementação de referência e respondem as dúvidas de
detalhe.

Não commite a pasta de referência no app.

## 2. O contrato

Qualquer conversão precisa manter estes pontos. Cada um existe por um motivo,
e pular um abre uma falha de segurança ou quebra o acesso.

| # | O que manter | Por quê |
|---|---|---|
| 1 | Fluxo **authorization code + PKCE `S256`**, com o app como **cliente confidencial** (`client_secret_basic`) e o segredo só no servidor | o Sextans exige PKCE e só cria clientes confidenciais; segredo no navegador deixa qualquer um se passar pelo app |
| 2 | Escopos `openid profile email offline_access` | sem `offline_access` não vem refresh token, e o app não consegue rechecar as organizações |
| 3 | Endereço de volta igual ao cadastrado (o kit usa `<origem>/api/auth/callback/sextans`; outro caminho serve se a TI cadastrar esse) | o Sextans compara o endereço de forma exata |
| 4 | **Sessão no servidor do app**: cookie `HttpOnly`, `Secure` em `https`, `SameSite=Lax`, de no máximo 8 h. Os tokens ficam no servidor ou num cookie cifrado, nunca em `localStorage` | o token no navegador fica exposto a qualquer script injetado |
| 5 | **Renovar** com o refresh token quando o access token vencer (15 min). Se o Sextans recusar, encerre a sessão do app e mande para `/entrar?erro=sessao-encerrada` | é assim que quem saiu da organização, foi bloqueado ou saiu do Sextans perde o acesso em até 15 min |
| 6 | Organizações lidas do **ID token mais recente** (claim `orgs`, `[{ slug, role }]`), com a assinatura conferida pelo JWKS (`<SEXTANS_URL>/api/auth/jwks`), o `iss`, o `aud` (o client ID) e o `exp` | um token sem conferência pode ser forjado; um token antigo traz organizações que a pessoa já não tem |
| 7 | **Checagem no servidor** de cada rota restrita, com equivalentes de `requireSession` e `requireOrganization` | o filtro da borda (middleware) é otimista; esconder o link não protege nada |
| 8 | `/entrar` com os avisos `sem-acesso` e `sessao-encerrada`. O `voltar` só aceita caminhos do próprio app (começa com `/`, sem `//` e sem `\`) | sem essa regra, o `voltar` vira redirecionamento aberto |
| 9 | **Sair** encerra a sessão do app e vai ao `end_session_endpoint` do Sextans com `id_token_hint` e `post_logout_redirect_uri` = `<origem>/`. Faça por `POST` | sair só do app deixa a conta Elinsa aberta no navegador; um `GET` deixa qualquer site deslogar a pessoa |
| 10 | Não usar `prompt=none` | o Sextans recusa (`interaction_required`), porque toda autorização passa pela conferência das organizações |
| 11 | O `sub` como chave do usuário no banco do app | é o mesmo em todos os apps; o e-mail pode mudar |

Os nomes das variáveis podem seguir o padrão do stack, mas prefira os mesmos
do kit. Assim a TI e os outros devs reconhecem:

- `SEXTANS_URL`;
- `SEXTANS_CLIENT_ID` e `SEXTANS_CLIENT_SECRET`;
- `BETTER_AUTH_SECRET`, ou um `SESSION_SECRET` se o stack não usar o Better
  Auth;
- `BETTER_AUTH_URL`, ou `APP_URL`.

## 3. Escolher o caminho

| Projeto | Caminho |
|---|---|
| JS/TS com servidor: SvelteKit, Nuxt, Astro, React Router/Remix, TanStack Start, SolidStart, Hono, Express, Fastify, Elysia, NestJS | **porte o kit com o Better Auth** (seção 4). O `config.ts` e o `auth.ts` mudam pouco, porque o Better Auth roda em todos esses |
| Next.js 15 ou anterior | também a seção 4. O `proxy.ts` volta a ser o `middleware.ts`; no Pages Router, as checagens vão no `getServerSideProps` ou nas API routes |
| SPA sem servidor (Vite + React, Vue, Angular) | precisa de um servidor pequeno ao lado (seção 6) |
| Outra linguagem: Python, PHP, .NET, Go, Java, Ruby | **biblioteca OIDC do stack** (seção 5), com o mesmo contrato |
| App de celular ou desktop | fale com a TI antes: o Sextans hoje só tem clientes confidenciais |

## 4. JS/TS com o Better Auth: peça por peça

Use o `better-auth` na **mesma versão do kit** (veja o `_item.json`; hoje
`1.7.10`) e copie a configuração **sem banco** exatamente como está no
`auth.ts`:

- `session.cookieCache` com `strategy: "jwe"`;
- `account.storeStateStrategy: "cookie"` e `account.storeAccountCookie: true`;
- o `genericOAuth` com `discoveryUrl`, `pkce: true`,
  `tokenEndpointAuth: { method: "client_secret_basic" }` e
  `requireIdTokenVerification: true`.

Essas opções são o que faz o login funcionar sem banco. Se o app já tem banco,
ele pode guardar a sessão lá, mas não é preciso.

| Peça do kit | No Next | No seu stack |
|---|---|---|
| `config.ts` | `process.env` | o mesmo, lendo o env **só no servidor** (ex.: `$env/static/private` no SvelteKit, `useRuntimeConfig()` no Nuxt, `import.meta.env` sem `PUBLIC_` no Astro) |
| `auth.ts` | `betterAuth` + `genericOAuth` + `nextCookies()` | o mesmo **sem** o `nextCookies()`. Onde houver, use o plugin de cookies do framework (`sveltekitCookies`, `tanstackStartCookies`, `solidStartCookies`) |
| `app/api/auth/[...all]/route.ts` | `GET`/`POST` → `auth.handler` | monte `auth.handler(request)` em `/api/auth/*`. Exemplos: Hono `app.on(["GET","POST"], "/api/auth/*", (c) => auth.handler(c.req.raw))`; Express `app.all("/api/auth/*splat", toNodeHandler(auth))` (de `better-auth/node`), **antes** do `express.json()`; SvelteKit `svelteKitHandler` no `hooks.server.ts`; Nuxt `server/api/auth/[...all].ts`; Astro `pages/api/auth/[...all].ts` |
| `proxy.ts` → `sextansProxy` | proxy do Next | o middleware ou hook que roda em todo pedido e **pode gravar cookies**: `handle` no `hooks.server.ts` (SvelteKit), middleware de servidor (Nuxt, Astro, React Router, Hono, Express). A lógica é a mesma: sem sessão e fora de um caminho aberto, mandar para `/entrar?voltar=`; com sessão, `auth.api.getAccessToken({ body: { useAccountCookie: true }, headers, returnHeaders: true })`, repassar os `set-cookie` e, se falhar, `auth.api.signOut` e `/entrar?erro=sessao-encerrada` |
| cabeçalho `x-sextans-id-token` | o proxy passa o ID token às páginas por cabeçalho | **não copie esse truque.** Ele só existe porque o proxy do Next não consegue entregar objetos aos componentes de servidor. Guarde o ID token conferido (ou o usuário já montado) no contexto do pedido: `event.locals`, `c.set()`, `res.locals`, `Astro.locals`, `context` do loader |
| `session.ts` | `headers()`, `redirect()`, `connection()` | leia do contexto do pedido; use o redirect do framework; o `connection()` é só do Next e sai. A conferência com o `jose` (JWKS, `iss`, `aud`, `exp`, 30 s de folga) fica igual |
| `actions.ts` → `signOut` | server action | uma rota `POST /sair` com os mesmos passos (pegar o `idToken`, `auth.api.signOut`, redirect ao `end-session`) |
| `app/entrar/page.tsx` | componente de cliente com `authClient.signIn.social` | uma página do stack. Use o cliente do Better Auth do framework (`better-auth/client`, `/react`, `/vue`, `/svelte`, `/solid`) com `signIn.social({ provider: "sextans", callbackURL, errorCallbackURL: "/entrar" })`. Mantenha a validação do `voltar` e os três avisos |
| `components/menu-usuario.tsx` | componente de servidor React | um componente do stack com nome, e-mail e um `<form method="post" action="/sair">` |
| `button`, `card` | shadcn | os componentes que o projeto já usa |

## 5. Outra linguagem: biblioteca OIDC

Use a biblioteca OIDC mais comum do stack, ou a que o projeto já usa:

| Stack | Biblioteca |
|---|---|
| Python | Authlib (Flask, Django, Starlette/FastAPI) ou mozilla-django-oidc |
| PHP / Laravel | Socialite com um provedor OpenID Connect genérico, ou jumbojett/openid-connect-php |
| .NET | `Microsoft.AspNetCore.Authentication.OpenIdConnect` com autenticação por cookie |
| Go | `github.com/coreos/go-oidc` com `golang.org/x/oauth2` |
| Java / Spring | `spring-boot-starter-oauth2-client` |
| Ruby | omniauth_openid_connect |

Configure com a descoberta (`<SEXTANS_URL>/api/auth/.well-known/openid-configuration`)
e confira o que costuma vir diferente do padrão:

- **PKCE `S256`**: ligue explicitamente se a biblioteca não ligar sozinha;
- **`client_secret_basic`**: algumas usam `client_secret_post` por padrão;
- **o claim `orgs`** é uma lista de objetos. Converta para os papéis ou claims
  do framework (ex.: uma lista de slugs na sessão) e escreva o equivalente de
  `requireOrganization`;
- **a renovação**: muitas bibliotecas de servidor **não** renovam sozinhas.
  Antes de usar a sessão, se o access token venceu:
  1. chame o `token_endpoint` com `grant_type=refresh_token` e
     autenticação básica;
  2. se der certo, guarde os tokens novos e releia o `orgs` do ID token novo;
  3. se o Sextans recusar, encerre a sessão e mande para
     `/entrar?erro=sessao-encerrada`.

  Pedidos paralelos com o mesmo refresh token, dentro de 60 s, recebem a mesma
  resposta;
- **sair**: o `end_session_endpoint` com `id_token_hint`. Guarde o ID token na
  sessão (no .NET, `SaveTokens = true`).

## 6. SPA sem backend

Não ponha o segredo no SPA e não peça à TI um "cliente público" sem conversar
antes. O Sextans só tem clientes confidenciais, e token no navegador fica
exposto a qualquer script injetado.

Acrescente um servidor pequeno ao lado (o padrão BFF). Ele faz o papel do kit,
e o SPA nunca vê token nenhum:

1. Um servidor Hono ou Express com o Better Auth, como na seção 4. Ele serve o
   SPA e o `/api/auth/*`.
2. Um `GET /api/me` devolve `{ user }` ou `401`. O SPA chama ao abrir e, com
   `401`, manda para `/entrar` (que pode ser uma rota do próprio SPA usando o
   `better-auth/client`).
3. As APIs do app passam pelo mesmo servidor, com o cookie da sessão, e
   conferem a organização lá.
4. SPA e servidor na **mesma origem**, com o servidor entregando o SPA ou um
   proxy reverso na frente. Origens diferentes trazem problemas de cookie e de
   CORS.

Se o projeto é um meta-framework rodando só como SPA (ex.: Vite SPA do React
Router), ligar o modo com servidor dele costuma ser mais simples que um BFF à
parte.

## 7. Conferir

Antes de dizer que está pronto:

- [ ] uma página protegida sem sessão leva à conta Elinsa (com o nome do app)
      e volta logado à mesma página;
- [ ] uma página de organização com alguém de fora dela mostra o aviso de sem
      acesso;
- [ ] alguém tirado da organização perde o acesso na renovação seguinte. Para
      testar sem esperar 15 minutos, suba um Sextans local com
      `SEXTANS_TOKEN_LIFETIME_SECONDS=60`;
- [ ] "Sair" encerra a sessão do app e a da conta Elinsa e volta à página
      inicial;
- [ ] `/entrar?voltar=//exemplo.com` e `/entrar?voltar=https://exemplo.com`
      voltam para `/`;
- [ ] o segredo do app não aparece no que vai para o navegador (procure o
      valor do `SEXTANS_CLIENT_SECRET` no build do cliente).

## 8. Documentar e acompanhar o kit

No README do app, deixe:

- que o login é uma conversão do `@elinsa/auth-kit`, e de que data;
- onde ficou cada peça (a tabela da seção 4 preenchida serve);
- as variáveis e os endereços cadastrados na TI.

Quando o kit mudar, baixe de novo com o `baixar-kit.mjs` numa pasta nova e
compare com a anterior (`diff -r`). Leve para o app só o que mudou de
comportamento.
