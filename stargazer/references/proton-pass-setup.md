# Configuração de credenciais

Este arquivo documenta o Proton Pass (`pass-cli`) como **exemplo** de fonte
de credencial — foi o que a implantação original usou. Se o usuário tiver
as credenciais num `.env`, noutro gerenciador de senhas, ou em qualquer
outro lugar, o objetivo final é o mesmo (um arquivo local com a senha, pra
passar como terceiro argumento de `../scripts/process_antenna.sh`) e a
seção [Leitura de credenciais pode exigir liberação explícita](#leitura-de-credenciais-pode-exigir-liberação-explícita)
abaixo se aplica independente da fonte. Pule a parte específica do
`pass-cli` se não for o caso.

Setup único (não precisa repetir a cada rodada, só quando o token expira ou
muda de máquina). Cobre: criar um agente com acesso restrito, e o que fazer
quando o ambiente exige liberação explícita pra ler a senha.

## Agente com acesso restrito por item (específico do Proton Pass)

Não dê acesso ao vault inteiro. Crie um agente e conceda acesso só ao item
necessário (login "Starlink" com a senha compartilhada):

```bash
pass-cli agent create starwatcher --expiration 1w
# retorna um token de acesso pessoal. Guarde uma unica vez, nao e reexibido.

pass-cli agent access grant starwatcher \
  --share-id <VAULT_SHARE_ID> --item-id <ITEM_ID_STARLINK> --role viewer
```

O item "E-mail da TI" (login do Outlook `ti@grupoamperelinsa.com`) só é
necessário pra configuração única da regra de encaminhamento pro AgentMail —
ver [browser-flow.md § 3](browser-flow.md#3-receber-o-código-via-agentmail-websocket).
O script (`process_antenna.sh`) não faz mais login no Outlook, então não
precisa de acesso a esse item no dia a dia.

Depois, entre com esse token numa sessão isolada (não a sessão pessoal), via
`PROTON_PASS_SESSION_DIR` apontando pra um diretório dedicado e
`pass-cli login`. Confirme com `pass-cli info` que apareceu
"Personal Access Token: [Agent] starwatcher".

### Armadilha: `--vault-name` não funciona para acesso por item

Um agente com acesso **a nível de item** (não de vault) não enxerga o vault
pelo nome. `pass-cli item view --vault-name "Agente" --item-title "Starlink"`
falha com "Could not find vault". O grant por item cria um **novo share ID**
específico do item — descubra-o com:

```bash
pass-cli share list --output json
# -> [{"id": "<ITEM_SHARE_ID>", "name": "Starlink", "share_type": "Item", ...}]
```

Use esse `id` (não o `VAULT_SHARE_ID` original) como `--share-id` em
`pass-cli item view --share-id <ITEM_SHARE_ID> --item-id <ITEM_ID> --field password`,
com `PROTON_PASS_AGENT_REASON` setado (motivo obrigatório, até 300 caracteres).

Nomes de campo confirmados para um item `login`: `email`, `password`
(`username` costuma vir vazio quando o login usa e-mail).

## Leitura de credenciais pode exigir liberação explícita

Por padrão, o ambiente pode impedir que o valor de uma senha guardada no
Proton Pass chegue perto do contexto do agente, mesmo redirecionando a saída
pra um arquivo nunca lido — é uma proteção deliberada contra vazamento de
credencial pelo transcript.

Essa é uma decisão do **usuário**, não um bug a contornar sozinho. Pergunte
antes. Se o usuário topar liberar (ciente de que o valor passa a poder
aparecer no output dos comandos), adicione a regra de permissão pro comando
específico em `.claude/settings.local.json` (arquivo pessoal, não
versionado) e teste de novo.

Mesmo liberado, evite imprimir a senha à toa: capture em arquivo local e use
`"$(cat arquivo)"` diretamente no comando seguinte, sem exibir em nenhum
passo intermediário. Apague os arquivos assim que não forem mais
necessários.

## Alternativa: `.env` ou outro gerenciador de senhas

O script não sabe nem se importa de onde a senha veio — só espera um
caminho de arquivo contendo a senha em texto puro (terceiro argumento).
Pra qualquer fonte que não seja Proton Pass, o padrão é:

1. Ler a credencial da fonte (variável de `.env`, comando de outro CLI de
   gerenciador de senha, etc.) pra dentro de um arquivo local — nunca
   imprimindo o valor no meio do caminho.
2. Se ler dessa fonte também disparar alguma proteção do ambiente contra
   exposição de segredo (comum em CLIs de gerenciador de senha, e às vezes
   até em `.env` dependendo de como o ambiente está configurado), o mesmo
   raciocínio da seção anterior se aplica: é uma decisão do usuário
   liberar ou não, pergunte antes de tentar contornar.
3. Passar o caminho do arquivo como terceiro argumento de
   `../scripts/process_antenna.sh` — o resto do fluxo não muda.

Exemplo com `.env` (usando algo como `python-dotenv`, `direnv`, ou leitura
manual da linha) — a única parte que muda é como a senha chega no arquivo
local; tudo depois disso é idêntico ao fluxo com Proton Pass.
