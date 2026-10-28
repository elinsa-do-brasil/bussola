# Problemas comuns

Organizado por onde o erro aparece. Antes de tudo, rode
`node <pasta da skill>/scripts/verificar.mjs` na pasta do app. Ele confere a
maior parte do que está abaixo sem mostrar segredo nenhum.

## Sumário

- [No `shadcn add`](#no-shadcn-add)
- [No `next dev` ou no `next build`](#no-next-dev-ou-no-next-build)
- [Na tela do Sextans](#na-tela-do-sextans)
- [No app, depois de entrar](#no-app-depois-de-entrar)
- [Token vazou](#token-vazou)

## No `shadcn add`

| Mensagem | O que fazer |
|---|---|
| `[unauthorized] Token do registro ausente, inválido, vencido ou revogado...` | O token não chegou ou não vale mais. Confira se o `components.json` tem `Bearer ${ELINSA_REGISTRY_TOKEN}` e se a variável está no `.env.local` (ou no shell) **da pasta onde o comando roda** (o `-c` muda essa pasta). Confira também se a URL do registro é a do Sextans onde o token foi criado: um token de homologação não vale em produção, e vice-versa. Se tudo isso está certo, o token venceu (90 dias) ou foi revogado: crie outro em **Minha conta → Tokens do registro** |
| O shadcn reclama que falta a variável `ELINSA_REGISTRY_TOKEN` | O token não está em nenhum dos arquivos que o shadcn lê (`.env.local`, `.env.development.local`, `.env.development`, `.env`) nem no shell. Veja também se não há espaço ou aspas sobrando na linha |
| `[forbidden] Este token é de quem não está mais na organização Desenvolvimento.` | O dono do token saiu da `desenvolvimento`. Peça à TI para pôr de volta; o token volta a valer sem precisar criar outro |
| `[not_found] Este item não existe no registro @elinsa.` | Nome errado. Os itens são `auth-kit`, `sextans`, `entrar` e `menu-usuario` |
| `[rate_limited] Muitas tentativas seguidas...` | Passou de 120 pedidos por minuto com o mesmo token. Espere um minuto |
| `fetch failed`, `ENOTFOUND`, timeout | A URL do `components.json` está errada ou o Sextans está fora do ar. Teste com `curl -s https://auth.elinsadobrasil.com.br/health`, que deve responder `{"ok":true}` |
| `Unknown registry "@elinsa"` ou parecido | A entrada `registries.@elinsa` não está no `components.json` daquela pasta |
| O comando pergunta se pode sobrescrever o `button.tsx` ou o `card.tsx` | O app já tem esses componentes. Responder "não" mantém os do app, e o kit funciona com eles se tiverem as mesmas exportações do shadcn |
| As dependências foram parar noutro `package.json` | Monorepo: o alias `ui` aponta para um pacote compartilhado. Veja a seção Monorepo do SKILL.md |

Para ver o que o servidor responde sem o shadcn no meio (o token sai do ambiente, nunca da linha de comando):

```bash
curl -s -o /dev/null -w '%{http_code}\n' \
  -H "Authorization: Bearer $ELINSA_REGISTRY_TOKEN" \
  https://auth.elinsadobrasil.com.br/r/registry.json
```

## No `next dev` ou no `next build`

| Mensagem | O que fazer |
|---|---|
| `Defina SEXTANS_URL no .env do app (veja o README do @elinsa/auth-kit).` (ou outra variável) | Falta a variável. Preencha e **reinicie** o `next dev`, que só lê o env ao subir. Em produção, ponha nas configurações do servidor |
| "uncached or runtime data during prerendering" / "accessed outside of `<Suspense>`" | Uma página lê a sessão fora de um `<Suspense>` com Cache Components ligado. Envolva o componente que chama `getSession`/`require*` |
| "unstable value Date.now() while prerendering" | Código próprio confere JWT ou usa a hora antes de ler os headers. Chame `await connection()` (de `next/server`) antes, como o `getSession()` faz |
| `Module not found: @/lib/sextans/...` | Os aliases do `components.json` não batem com os `paths` do `tsconfig.json`, ou o app usa `src/` e os arquivos caíram fora. Ajuste o alias ou mova os arquivos e reinstale |
| Erros de tipo no `better-auth` | Outra versão do `better-auth` no app. O kit é testado com a `1.7.10` exata |
| Existe `middleware.ts` e `proxy.ts` | No Next 16, o `middleware.ts` virou `proxy.ts`. Junte a lógica num `proxy.ts` só |
| `pnpm lint` acusa `react-hooks/set-state-in-effect` na `app/entrar/page.tsx` | Problema conhecido do kit: o `setError` dentro do `useEffect` que lê o `?erro=`. Desligue a regra só nessa linha (`// eslint-disable-next-line react-hooks/set-state-in-effect`), com um comentário dizendo que veio do kit, e atualize esse arquivo com `--diff` em vez de `--overwrite`. Avise quem cuida do Sextans para corrigir no registro |

## Na tela do Sextans

| O que aparece | O que fazer |
|---|---|
| Erro de `redirect_uri` / `invalid_redirect` | O endereço de volta não é exatamente o cadastrado. Compare `BETTER_AUTH_URL` + `/api/auth/callback/sextans` com o que a TI cadastrou: protocolo, host, **porta** e caminho. Para `http://localhost`, o aplicativo precisa estar marcado como de desenvolvimento |
| `invalid_client` / erro de autenticação do cliente | `SEXTANS_CLIENT_ID` ou `SEXTANS_CLIENT_SECRET` errados, ou a TI gerou um segredo novo (o antigo para na hora), ou o aplicativo foi desativado |
| A pessoa entra e para no `/sem-acesso` do Sextans | Ela não está em nenhuma organização que o aplicativo aceita. A TI resolve: põe a pessoa na organização ou muda as organizações do aplicativo |
| A tela de entrar não mostra o nome do app | O `SEXTANS_CLIENT_ID` não é de um aplicativo que existe |
| O "Sair" mostra erro em vez de voltar ao app | O endereço depois de sair cadastrado não é `<BETTER_AUTH_URL>/`, com a barra |

## No app, depois de entrar

| Sintoma | O que fazer |
|---|---|
| Volta para `/entrar` em loop | O cookie de sessão não está sendo gravado. Causas: `BETTER_AUTH_URL` com origem diferente da que está no navegador (ex.: `127.0.0.1` × `localhost`), `https` no `BETTER_AUTH_URL` servido em `http`, ou um proxy próprio que descarta os `set-cookie` do `sextansProxy` |
| `getSession()` devolve `null` numa página, mas a pessoa entrou | A rota está fora do `matcher` do `proxy.ts`. O cabeçalho com o token só existe nas rotas que passam pelo proxy |
| `/entrar?erro=sem-acesso` | O `requireOrganization` daquela página pede uma organização que a pessoa não tem. Confira o slug (é o identificador, ex.: `almoxarifado`, não o nome "Almoxarifado") |
| `/entrar?erro=sessao-encerrada` | O Sextans recusou a renovação: a pessoa saiu das organizações do aplicativo, foi bloqueada, saiu da conta Elinsa ou foi desconectada pela TI. É o comportamento esperado |
| Alguém tirado de uma organização continua entrando | Normal por até 15 minutos (a validade do token). Depois disso, a renovação traz as organizações novas |
| Depois de 8 horas, a pessoa passa pelo Sextans de novo | É o tempo máximo da sessão do app. Se a conta Elinsa ainda está aberta, ela volta sem digitar nada |
| A organização nova não aparece logo depois de a TI adicionar | Mesma coisa: aparece na próxima renovação, em até 15 minutos, ou ao entrar de novo |

## Token vazou

Se o token foi commitado, colado num chat, num log ou num `components.json`:

1. Revogue em **Minha conta → Tokens do registro**. Ele para de valer na hora.
2. Crie outro e ponha só no `.env.local`.
3. Troque o valor literal no `components.json` por `${ELINSA_REGISTRY_TOKEN}`.
4. Se ele foi para o git, apagar o commit não basta, porque o histórico e os
   clones guardam o valor. Revogar é o que resolve.

Se vazou o `SEXTANS_CLIENT_SECRET`, peça à TI um segredo novo (**Aplicativos →
gerar segredo**) e troque nas configurações do servidor. Se vazou o
`BETTER_AUTH_SECRET`, gere outro: todas as sessões do app caem, e as pessoas
entram de novo pelo Sextans.
