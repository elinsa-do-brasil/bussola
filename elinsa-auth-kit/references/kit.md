# Como o kit funciona por dentro

Leia quando precisar ir além do passo a passo: explicar um comportamento,
juntar o kit a um `proxy.ts` que já existe, ou integrar um app que não é Next.

## Sumário

- [O caminho de um pedido](#o-caminho-de-um-pedido)
- [Tempos](#tempos)
- [Referência das funções](#referência-das-funções)
- [A página /entrar](#a-página-entrar)
- [Cache Components](#cache-components)
- [O registro](#o-registro)
- [OIDC sem o kit](#oidc-sem-o-kit)

## O caminho de um pedido

1. **Entrar.** O botão da `/entrar` chama
   `authClient.signIn.social({ provider: "sextans", callbackURL })`. O Better
   Auth do app manda a pessoa ao `authorize` do Sextans, com PKCE. O
   `callbackURL` vem do `?voltar=` e só aceita caminhos do próprio app.
2. **No Sextans.** A pessoa entra (ou já está dentro). O Sextans confere se
   ela está em pelo menos uma organização do aplicativo. Se não está, ela fica
   no `/sem-acesso` do Sextans e o app nem recebe a volta.
3. **Volta.** Ela chega a `/api/auth/callback/sextans`. O app troca o código
   pelos tokens com o ID e o segredo (`client_secret_basic`) e confere o ID
   token.
4. **Sessão do app.** É um cookie criptografado (JWE) do próprio app, **sem
   banco**. Os tokens do Sextans também ficam em cookie (`storeAccountCookie`).
5. **A cada pedido**, o `sextansProxy`:
   - apaga o cabeçalho `x-sextans-id-token` que vier de fora, para ninguém
     forjar a sessão por ele;
   - manda quem não tem sessão para `/entrar?voltar=<caminho>`, a não ser nos
     caminhos abertos;
   - chama `getAccessToken({ useAccountCookie: true })`. O Better Auth só
     renova no Sextans quando o access token está vencendo, e os cookies
     novos voltam na resposta;
   - põe o ID token mais recente no cabeçalho interno `x-sextans-id-token`;
   - se o Sextans recusar a renovação, encerra a sessão do app e manda para
     `/entrar?erro=sessao-encerrada`.
6. **Nas páginas**, o `getSession()` lê esse cabeçalho e confere a assinatura
   com o JWKS do Sextans (`<SEXTANS_URL>/api/auth/jwks`), além do emissor, da
   audiência (o client ID) e da validade, com 30 s de folga. As organizações
   vêm do claim `orgs` desse token.
7. **Sair.** A server action `signOut()` encerra a sessão do app e manda ao
   `end-session` do Sextans com `id_token_hint` e `post_logout_redirect_uri`
   igual a `<BETTER_AUTH_URL>/`. O Sextans encerra a sessão dele e volta à
   página inicial do app. Por isso o endereço depois de sair precisa estar
   cadastrado exatamente assim, com a barra.

Por que a renovação fica no proxy e não no `requireSession()`: componentes de
servidor não gravam cookies, então só o proxy consegue guardar o token
renovado numa sessão sem banco.

## Tempos

| O quê | Quanto | Efeito |
|---|---|---|
| Access token e ID token | 15 min (`SEXTANS_TOKEN_LIFETIME_SECONDS` no Sextans) | é o tempo máximo até um acesso retirado cair no app |
| Refresh token | 8 h, rotativo | o Sextans confere de novo as organizações a cada renovação |
| Sessão do app | 8 h (`SESSION_MAX_AGE_SECONDS`) | depois, a pessoa passa de novo pelo Sextans; se a conta Elinsa ainda estiver aberta, volta sem digitar nada |
| Reuso do refresh token | 60 s | pedidos paralelos do Next renovam com o mesmo token sem serem tratados como roubo |

Quando alguém sai de uma organização, o app só descobre na próxima renovação,
em até 15 minutos. Isso é o esperado, não um bug. Para testar sem esperar,
suba um Sextans local com `SEXTANS_TOKEN_LIFETIME_SECONDS=60`.

A renovação deixa de funcionar quando a pessoa:

- sai de todas as organizações do aplicativo;
- é bloqueada;
- sai do Sextans;
- é desconectada pela TI.

## Referência das funções

### `lib/sextans/session.ts` (só servidor)

```ts
type Organization = { slug: string; role: string };
type SextansUser = { id: string; name: string; email: string; organizations: Organization[] };

getSession(): Promise<{ user: SextansUser } | null>
requireSession(returnTo = "/"): Promise<{ user: SextansUser }>
requireOrganization(slugs: string | string[], returnTo = "/"): Promise<{ user: SextansUser }>
```

- O `getSession()` chama `await connection()` antes de conferir o token. A
  conferência depende da hora, e sem isso o Next reclama de `Date.now()`
  durante o prerender. Se você escrever código próprio que confere JWT com o
  `jose`, faça o mesmo.
- O `requireSession()` manda para `/entrar?voltar=<returnTo>` quando não há
  sessão.
- O `requireOrganization()` aceita uma organização ou uma lista (basta estar
  em uma) e manda para `/entrar?erro=sem-acesso`.
- O `user.id` é o `sub` do Sextans, o mesmo em todos os apps. Use-o como
  chave do usuário no banco do app, e não o e-mail.

### `lib/sextans/proxy.ts`

```ts
sextansProxy(request: NextRequest, { publicPaths?: string[] }): Promise<NextResponse>
```

O `/entrar` é sempre aberto, e o `/api/auth/*` passa direto. Para juntar a
outro proxy, chame o `sextansProxy` e trabalhe sobre a resposta dele, sem
descartar os `set-cookie` que ele acrescenta. Sem esses cookies, a renovação
não fica guardada e o Sextans é chamado de novo a cada pedido.

### `lib/sextans/actions.ts`

`signOut()` é uma server action. Use num `<form action={signOut}>`, como o
`MenuUsuario` faz.

### `lib/sextans/config.ts`

O `sextansConfig()` lê as variáveis e falha com
`Defina <VAR> no .env do app (veja o README do @elinsa/auth-kit).` quando uma
falta.

Constantes:

- `SEXTANS_PROVIDER_ID = "sextans"`;
- `SESSION_MAX_AGE_SECONDS = 8 * 60 * 60`;
- `ID_TOKEN_HEADER = "x-sextans-id-token"`.

### `components/menu-usuario.tsx`

`<MenuUsuario user={session.user} />` é um componente de servidor simples:
iniciais, nome e e-mail (escondidos no celular) e o botão "Sair". Ele não usa
`avatar` nem `dropdown-menu`, para caber em qualquer estilo do shadcn. Para um
menu mais rico, escreva o seu componente usando o `signOut` e o `SextansUser`,
fora de `lib/sextans/`.

## A página /entrar

É um componente de cliente com o botão "Entrar com a conta Elinsa" e os
avisos de cada `?erro=`:

| `?erro=` | Aviso |
|---|---|
| `sem-acesso` | "A sua conta não está liberada para esta área. Peça o acesso à TI." |
| `sessao-encerrada` | "A sua sessão terminou. Entre de novo." |
| `?error=` do Better Auth | "Não foi possível entrar. Tente de novo." |

O `?voltar=` é lido no clique, e não num efeito, porque o clique pode chegar
antes de a página terminar de carregar. Ele só aceita caminhos que começam com
`/`, e recusa `//` e `\`, para não virar redirecionamento aberto. Mantenha
essas regras se adaptar a página.

## Cache Components

O `create-next-app` 16.4 liga `cacheComponents: true` e
`partialPrefetching: true`. Com isso:

- quem chama `getSession()` ou `require*` fica dentro de um `<Suspense>`;
  senão o `next build` falha com "uncached or runtime data during
  prerendering";
- o Next mantém a rota anterior escondida no DOM (Activity). Nos testes com
  Playwright, um `locator("main")` pode achar dois elementos; use
  `getByRole("main")`.

## O registro

- `GET <SEXTANS_URL>/r/<item>.json` e `GET <SEXTANS_URL>/r/registry.json`
  respondem só com `Authorization: Bearer <token do registro>`.
- Sempre com `Cache-Control: private, no-store`, e cada leitura sai na
  auditoria (quem, qual token, qual item).
- Os tokens são do plugin `@better-auth/api-key`:
  - prefixo `elinsa_reg_`;
  - validade de 90 dias;
  - só a permissão `registry:read`;
  - 120 pedidos por minuto;
  - o banco guarda só o hash.
- O dono do token precisa continuar na organização `desenvolvimento` e não
  pode estar bloqueado.
- Os erros vêm como `{ error, message }`, que o shadcn mostra como
  `[error] message`.

## OIDC sem o kit

São os dados do Sextans como provedor OpenID Connect, para quem converte o kit
para outro stack. O passo a passo da conversão está em
[outros-stacks.md](outros-stacks.md).

| Item | Valor |
|---|---|
| Emissor (`iss`) | `<SEXTANS_URL>/api/auth` |
| Descoberta | `<SEXTANS_URL>/api/auth/.well-known/openid-configuration` |
| Fluxo | authorization code com PKCE `S256` (obrigatório) |
| Autenticação do cliente | `client_secret_basic` |
| Escopos | `openid profile email offline_access` (o último para ganhar refresh token) |
| ID token | RS256, chaves em `<SEXTANS_URL>/api/auth/jwks`; claims `sub`, `email`, `email_verified`, `name`, `orgs` (`[{ slug, role }]`) |
| Access token | opaco; serve no `userinfo`, que devolve também a foto e o `orgs` |
| Sair | `end_session_endpoint` com `id_token_hint` e um `post_logout_redirect_uri` cadastrado |

Limites:

- `prompt=none` não é aceito (devolve `interaction_required`), porque toda
  autorização passa pela conferência das organizações;
- não há registro dinâmico de clientes;
- não há tela de consentimento, porque a TI cadastra cada aplicativo.

O app deve conferir as organizações também no servidor dele, pelo claim
`orgs`, e renovar quando o access token vencer, para o acesso cair em até 15
minutos.
