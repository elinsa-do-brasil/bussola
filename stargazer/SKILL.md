---
name: starlink-saldo-devedor
description: Automatiza a checagem de saldo devedor de contas Starlink ("antenas") via automação de navegador (agent-browser) com login + 2FA por e-mail (OTP recebido via WebSocket do AgentMail) e escreve o resultado numa planilha. Nesta implantação as credenciais vêm do Proton Pass (pass-cli), as contas usam plus-addressing (ti+N@grupoamperelinsa.com) sobre uma caixa Outlook compartilhada, e essa caixa tem uma regra de encaminhamento que copia cada e-mail de código pra uma inbox do AgentMail (é ali que o script escuta, via WebSocket, em vez de ler a UI do Outlook) — mas o método se adapta a outras fontes de credencial (.env, outro gerenciador de senhas), a outros esquemas de conta (e-mail e senha próprios por conta), e a outros jeitos de entregar o OTP pro AgentMail. Use esta skill sempre que o usuário pedir para checar, atualizar ou reprocessar saldo devedor de antenas Starlink, processar uma planilha de antenas, ou mencionar qualquer parte desse fluxo (login + 2FA por e-mail no portal da Starlink, Proton Pass, AgentMail/WebSocket, encaminhamento de OTP) — mesmo sem citar a skill pelo nome, sem repetir os detalhes técnicos de sessões anteriores, ou com uma fonte de credencial/planilha diferente da usada da primeira vez. Também serve de referência para qualquer automação de agent-browser com login + código por e-mail (2FA/OTP) fora do contexto Starlink, já que as armadilhas documentadas (cliques MUI/React não confiáveis via accessibility tree, IDs de aba instáveis, race condition ao subscrever um WebSocket antes de disparar o e-mail) são genéricas desse tipo de fluxo.
---

# Saldo devedor das antenas Starlink (plus-addressing + OTP por e-mail)

Tutorial de ponta a ponta: da credencial até o valor "Saldo devedor" lido do
portal da Starlink, para cada antena. Escrito a partir de sessões reais onde
cada passo quebrou pelo menos uma vez antes de funcionar — as notas de "por
que" existem para não repetir os mesmos erros.

A implantação original usa Proton Pass (`pass-cli`) como fonte de
credencial e plus-addressing (`ti+N@grupoamperelinsa.com`) como esquema de
conta — é o que os exemplos de comando abaixo mostram. **Isso é só a
configuração de uma implantação, não um requisito da skill.** O núcleo
reutilizável é o fluxo de navegador (login → 2FA por e-mail → leitura do
saldo) e suas armadilhas, que não dependem de nenhuma dessas duas escolhas.
Veja [Adaptando pra outro ambiente](#adaptando-pra-outro-ambiente) antes de
assumir que precisa replicar Proton Pass ou plus-addressing.

**Status:** o fluxo de captura de OTP via AgentMail WebSocket (o que troca a
leitura da UI do Outlook) foi validado de ponta a ponta contra uma conta real
(`ti+p1@grupoamperelinsa.com`) em 2026-08-29 — login, 2FA com código
capturado ao vivo, e leitura de saldo funcionaram sem nenhum código velho ou
aba de e-mail. Dois problemas achados nesse teste já estão corrigidos no
script: uma race de `tab_gone` após reiniciar o Chrome, e falta de retry no
clique em "Próximo" (que já falhou uma vez transitoriamente durante o
próprio teste). Detalhes em
[references/troubleshooting.md § Relato de campo](references/troubleshooting.md#relato-de-campo-release-candidate-do-fluxo-agentmail-2026-08-29).

## Antes de tudo: calibre a expectativa

Numa rodada real com 47 antenas, **cerca de 1/3 das primeiras tentativas
falhou de forma transitória** — queda de conexão, daemon do `agent-browser`
travando, ou a árvore de acessibilidade lendo a página um instante cedo
demais. Todas foram resolvidas repetindo a mesma técnica na hora, sem mudar
de abordagem. Uma conta chegou a falhar 3 vezes seguidas antes de funcionar
na 4ª — não é sinal de conta com problema, é sinal de ambiente instável.
Antes de concluir que algo está genuinamente quebrado, veja
[references/troubleshooting.md](references/troubleshooting.md).

## Modelo mental

- Login no portal Starlink = e-mail da conta + senha + código de 6 dígitos
  enviado por e-mail, que precisa ser capturado e colado de volta no portal.
- O saldo devedor aparece **direto na tela inicial pós-login** (`/account/home`),
  como um heading `R$X,XX`. Não precisa abrir "Faturamento".
- **Na implantação original**: um vault no Proton Pass ("Agente") guarda um
  item de login "Starlink" (senha **compartilhada** por todas as antenas);
  cada antena tem um e-mail próprio via **plus-addressing**
  (`ti+11@grupoamperelinsa.com`, `ti+25@grupoamperelinsa.com`, etc.) sobre
  uma caixa Outlook compartilhada (`ti@grupoamperelinsa.com`). Isso é uma
  escolha de configuração, não uma regra do fluxo — ver abaixo.
- **Captura do OTP**: a caixa Outlook tem uma regra de encaminhamento que
  copia todo e-mail "código de verificação da Starlink" (não importa o
  plus-address de destino) pra uma inbox do AgentMail. O script se inscreve
  nessa inbox via WebSocket (`client.websockets.connect()`, SDK
  [agentmail](../agentmail/SKILL.md)) **antes** de clicar
  em "Fazer login", e recebe o código via evento `message.received` assim
  que o e-mail chega — sem precisar de nenhuma aba do Outlook aberta. Ver
  [references/browser-flow.md § 3](references/browser-flow.md#3-receber-o-código-via-agentmail-websocket).

## Adaptando pra outro ambiente

As duas peças abaixo são plugáveis. O resto da skill (login no portal,
extração do código 2FA, leitura do saldo, as armadilhas) funciona igual
independente de qual escolha você fizer aqui.

**Fonte de credencial.** O `scripts/process_antenna.sh` não sabe nem se
importa de onde a senha veio — ele só recebe um caminho de arquivo local
contendo a senha (terceiro argumento). [references/proton-pass-setup.md](references/proton-pass-setup.md)
mostra como popular esse arquivo a partir do Proton Pass, mas é só **um
exemplo**. Se o usuário fornecer um `.env`, outro gerenciador de senhas, ou
qualquer outra fonte, o padrão é o mesmo: leia a credencial pra um
arquivo/variável local sem nunca imprimi-la à toa (ver
[Boas práticas de credencial](#boas-práticas-de-manuseio-de-credencial)), e
passe o caminho do arquivo pro script. Se ler a credencial exigir liberação
explícita do ambiente (comum com gerenciadores de senha que bloqueiam por
segurança), a segunda metade de `proton-pass-setup.md` cobre esse padrão de
forma genérica, não específica do Proton Pass.

**Esquema de conta.** Plus-addressing com senha compartilhada é conveniente
quando existe, mas não é premissa do fluxo — é só um jeito de dizer "uma
credencial serve pra N contas". Se cada conta tem e-mail **e** senha
próprios (sem compartilhamento nenhum), a única mudança é: cada chamada do
script recebe seu próprio arquivo de senha, não o mesmo arquivo reaproveitado
pra todas. Numa planilha, isso normalmente significa ler e-mail e senha da
mesma linha, escrever a senha num arquivo temporário por conta, chamar o
script, apagar o arquivo — em vez de preparar um arquivo de senha compartilhado
uma vez só no início do lote.

**Entrega do OTP pro AgentMail.** O script só precisa que o e-mail de código
chegue, mais cedo ou mais tarde, numa inbox do AgentMail — não importa por
qual caminho. Aqui é uma regra de encaminhamento do Outlook sobre uma caixa
compartilhada com plus-addressing; poderia igualmente ser cada conta com
e-mail próprio já configurado para encaminhar direto pro AgentMail, ou até o
e-mail de login da conta Starlink **ser** o próprio endereço do AgentMail
(sem encaminhamento nenhum). Ajuste `--from`/`--subject-contains` na chamada
de `wait-for-otp-cli.ts` dentro do script pra bater com o remetente/assunto
real que chega nessa inbox, e `AGENTMAIL_INBOX_ID` se não for
`raave@agentmail.to`.

**Planilha de origem/destino.** Os nomes de coluna (`Nome`, `E-mail`,
`Saldo devedor`) e o nome da aba (`Antenas`) no exemplo de
[Escrever os resultados](#escrever-os-resultados-de-volta-na-planilha) são
os dessa planilha específica. Ajuste os nomes de coluna/aba no trecho Python
pra bater com a planilha real — a lógica (de-dupe pegando o `RESULT` mais
recente por ID) continua igual.

## Configuração (uma vez só)

Se ainda não há uma fonte de credencial configurada com acesso à conta do
portal, siga [references/proton-pass-setup.md](references/proton-pass-setup.md)
(Proton Pass é o exemplo documentado; adapte pra outra fonte conforme a seção
acima).

Também é preciso:

- Chrome do sistema rodando com `--remote-debugging-port=9222` (não o Chrome
  baixado pelo próprio `agent-browser`, que costuma ser bloqueado por
  política corporativa) — detalhes em
  [references/browser-flow.md § 1](references/browser-flow.md#1-chrome-via-cdp).
- `AGENTMAIL_API_KEY` disponível (no `.env` da raiz do repo, ou já exportada
  no ambiente) e a regra de encaminhamento do e-mail de código já configurada
  na caixa que recebe o OTP, apontando pra uma inbox do AgentMail — nenhuma
  aba de e-mail precisa ficar aberta no Chrome pra isso, só o Chrome pro
  próprio portal Starlink.

## Rodando: use o script

Todo o fluxo de login → 2FA → leitura do saldo → limpeza está encapsulado em
`scripts/process_antenna.sh`, parametrizado por antena:

```bash
bash scripts/process_antenna.sh "M-0011" "ti+11@grupoamperelinsa.com" "<arquivo com a senha>"
# stdout: RESULT|M-0011|ti+11@grupoamperelinsa.com|R$0,00
#     ou: FAIL|M-0011|ti+11@grupoamperelinsa.com|<motivo>
```

Pré-requisitos: Chrome do sistema já rodando na porta 9222, `AGENTMAIL_API_KEY`
disponível (via `.env` na raiz do repo ou já exportada), a regra de
encaminhamento do OTP já configurada apontando pro AgentMail, e um arquivo
local só com a senha dessa conta (compartilhada entre várias contas ou
própria de uma só — ver [Adaptando pra outro ambiente](#adaptando-pra-outro-ambiente);
nunca a senha solta na linha de comando, ver
[Boas práticas de credencial](#boas-práticas-de-manuseio-de-credencial)).

Para uma lista de antenas, rode uma de cada vez em lotes pequenos (≈10 com
checkpoint) — ver [references/troubleshooting.md § Rodando em lote](references/troubleshooting.md#rodando-em-lote)
para o padrão de loop e por que lotes grandes são arriscados.

**Se o script falhar (`FAIL|...`) ou travar**, não assuma que a conta tem
problema — na prática a grande maioria das falhas foi transitória (rede,
timing) e resolvida na hora. Veja
[references/troubleshooting.md](references/troubleshooting.md) para a
tabela de motivos de falha e o playbook de recuperação passo a passo (o que
já resgatou 100% das contas que falharam numa rodada real).

**Quer entender ou reproduzir cada passo manualmente** (o script travou no
meio, ou você está construindo um fluxo parecido pra outro site)? Veja
[references/browser-flow.md](references/browser-flow.md) — cobre login no
Starlink + 2FA, recebimento do código via AgentMail WebSocket, leitura do
saldo e logout, com o comando exato de cada armadilha.

## Escrever os resultados de volta na planilha

Exemplo abaixo usa `antenas.xlsx`, aba `Antenas`, colunas `Nome` e `Saldo
devedor` — **os nomes exatos são dessa planilha específica; ajuste pra
bater com a planilha real** (nome do arquivo, da aba, das colunas — a skill
`xlsx` cobre a mecânica geral de leitura/escrita com `openpyxl` se a
estrutura for muito diferente disso).

O de-dupe importa independente da planilha: se uma conta foi reprocessada,
guarde o `RESULT|...` mais recente associado àquele ID, não o primeiro. Um
padrão que funcionou bem: cada chamada do script imprime uma linha
`RESULT|<ID>|<email>|<saldo>` ou `FAIL|<ID>|<email>|<motivo>` — junte tudo
num arquivo (`>>` append), depois processe em Python pegando **a última**
ocorrência de `RESULT` por ID (ignorando `FAIL`/`PENDING`):

```python
import re, openpyxl

results = {}
with open("resultados.txt", encoding="utf-8") as f:
    for line in f:
        if line.startswith("RESULT|"):
            _, aid, email, saldo = line.strip().split("|")
            results[aid] = saldo   # sobrescreve com o mais recente

wb = openpyxl.load_workbook("antenas.xlsx")           # <- ajuste o nome do arquivo
ws = wb["Antenas"]                                     # <- ajuste o nome da aba
headers = [c.value for c in ws[1]]
name_idx = headers.index("Nome") + 1                   # <- ajuste o nome da coluna de ID
saldo_idx = headers.index("Saldo devedor") + 1          # <- ajuste o nome da coluna de saldo
for r in range(2, ws.max_row + 1):
    name = ws.cell(row=r, column=name_idx).value
    if name in results:
        ws.cell(row=r, column=saldo_idx).value = results[name]
wb.save("antenas.xlsx")                                # <- ajuste o nome do arquivo
```

Confira ao final: contagem de linhas atualizadas deve bater com o total de
antenas processadas (nenhuma faltando, nenhum ID não reconhecido).

## Boas práticas de manuseio de credencial

- Não imprimir senha/token em texto solto no output "só pra debugar".
  Capture em arquivo local, use via substituição de comando, apague depois.
- Não conceder acesso amplo demais na fonte de credencial quando só é
  preciso um item (no Proton Pass, isso é `agent access grant --item-id`,
  em vez de dar acesso ao vault inteiro).
- Não reaproveitar a senha fora do arquivo temporário do lote em execução.
- Qualquer arquivo de configuração que libere leitura de credenciais deve
  ficar no escopo pessoal/local, não em algo versionado e compartilhado.
