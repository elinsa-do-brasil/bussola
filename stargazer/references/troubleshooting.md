# Troubleshooting e execução em lote

Leia isto quando o script (`../scripts/process_antenna.sh`) reportar `FAIL`,
travar, ou quando for rodar várias antenas seguidas.

## Motivos de falha (`FAIL|...|<motivo>`)

- `email_fill_error` — provavelmente ainda autenticado numa conta anterior
  (ver [browser-flow.md § 5](browser-flow.md#5-logout-correto-entre-contas))
  e a página não é o form de login. Também pode ser só uma queda de conexão
  momentânea durante o preenchimento.
- `proximo_click_failed` — o clique em "Próximo" (via JS, ver
  [browser-flow.md § 2](browser-flow.md#2-login-no-portal-starlink--verificação-em-duas-etapas))
  não teve efeito depois de 3 tentativas. O script já retenta sozinho antes
  de chegar nesse `FAIL`; se mesmo assim falhar, é sinal de algo mais
  persistente que a instabilidade transitória usual — vale checar
  manualmente se o portal mudou (novo texto de botão, novo layout).
- `senha_fill_error` — o campo "Senha" não foi encontrado mesmo depois do
  retry de `proximo_click_failed` acima ter confirmado que ele apareceu;
  bem mais raro que o antigo (antes de existir o retry, era o sintoma direto
  do clique flaky em "Próximo" não ter avançado a página).
- `no_2fa_screen` — o clique em "Fazer login" pode não ter chegado a tempo
  (queda de conexão) ou a leitura da tela rodou um instante cedo demais (a
  tela de 2FA às vezes demora uma fração de segundo a renderizar depois do
  clique — na prática, ao checar manualmente logo em seguida, a tela de 2FA
  quase sempre **já estava lá**, ou seja, isso costuma ser falso negativo,
  não falha real).
- `otp_not_found` — o listener do AgentMail rodou até o timeout (90s) sem
  receber um `message.received` que batesse com o filtro `--from`/
  `--subject-contains`; **o mais comum de todos**, geralmente resolvido só
  reprocessando a mesma conta (o e-mail pode legitimamente levar mais de 90s
  às vezes, ou a regra de encaminhamento do Outlook pode ter atrasado). A
  razão detalhada (se o listener imprimiu um `FAIL|...` próprio, ex. erro de
  autenticação do AgentMail) vem concatenada depois de `otp_not_found: `.
- `agentmail_subscribe_timeout` — o listener não confirmou a subscrição
  (linha `SUBSCRIBED`) a tempo, antes do script tentar clicar em "Fazer
  login". Normalmente é `AGENTMAIL_API_KEY` ausente/inválida ou o processo
  `tsx` não subiu — cheque `$OTP_OUT` seria útil, mas o script já apaga o
  arquivo temporário; rode `pnpm exec tsx src/wait-for-otp-cli.ts --inbox ...`
  manualmente pra ver o erro real.
- `otp_fill_error` — o ID da aba do Starlink mudou entre o login e o envio
  do código (abrir/fechar qualquer aba renumera os IDs) e o preenchimento
  foi tentado na aba errada. A versão atual do script re-resolve a aba do
  Starlink logo antes de preencher o código para mitigar isso.
- `otp_verification_failed` — código errado foi usado, ou a verificação
  falhou por outro motivo no portal (não deveria mais ser um código velho:
  ver a nota sobre isso em
  [browser-flow.md § 3](browser-flow.md#3-receber-o-código-via-agentmail-websocket)).
- `saldo_not_found` — a página pode não ter terminado de carregar; considere
  um `wait` extra antes de ler o heading.
- Falhas genéricas em qualquer passo também podem ser só **queda de
  conexão** (aconteceu com frequência numa sessão real, incluindo erros
  `Failed to connect: ... recusou ativamente`) — sempre vale reprocessar
  antes de investigar mais a fundo.

## Playbook de recuperação (ordem recomendada ao ver um `FAIL`)

1. **Cheque o estado real do navegador antes de assumir que falhou de
   verdade.** Rode `agent-browser --cdp 9222 tab list` — muitas vezes uma
   aba do Starlink já está em `/account/home` com o saldo certo, e a falha
   reportada foi só no passo de logout, *depois* do sucesso. Isso aconteceu
   repetidamente: o script chegou a reportar `FAIL` numa conta que, na
   prática, já tinha logado com sucesso.
2. **Se não há aba autenticada, reprocesse a mesma conta direto.** Na
   prática isso resolveu a maioria dos casos sem precisar de nenhum
   diagnóstico mais fundo — é a primeira coisa a tentar, não a última.
3. **Se o processo em segundo plano está rodando muito além do tempo
   normal** (uma conta leva 30–90s; se passar de ~3min, algo travou), pare
   o processo e assuma o controle manual — não fique esperando
   indefinidamente. Depois cheque `agent-browser --cdp 9222 tab list` e
   `curl -s http://localhost:9222/json/version` pra confirmar que o Chrome
   ainda está de pé (geralmente está — quem trava é o daemon do
   `agent-browser` ou a conexão de rede, não o Chrome em si).
4. **Se qualquer comando `agent-browser` retornar "A daemon for session
   'default' started concurrently with different daemon configuration"**,
   `agent-browser close --all` e `agent-browser doctor --fix` às vezes não
   resolvem sozinhos. Mate os processos travados diretamente:
   ```powershell
   Get-Process | Where-Object { $_.ProcessName -like "agent-browser*" } | Stop-Process -Force
   ```
   Depois reconecte normalmente (`agent-browser --cdp 9222 tab list`) — o
   Chrome continua rodando o tempo todo, só o daemon precisa reiniciar.
   **Se em vez disso o erro for `tab_gone`** (não esse acima) logo depois de
   reiniciar o Chrome, é outra causa — ver
   [browser-flow.md § 1](browser-flow.md#1-chrome-via-cdp). `process_antenna.sh`
   já se protege disso vinculando numa aba explicitamente antes do primeiro
   `cookies clear`; só reaparece se estiver rodando um trecho manual solto
   (fora do script) depois de reiniciar o Chrome.
5. **Recuperação manual (quando o script trava no meio ou falha
   repetidamente):** siga [browser-flow.md](browser-flow.md) passo a passo
   à mão — login limpo (`cookies clear` + abrir `/auth/login`), aceitar
   cookies via JS, preencher e-mail/senha, subir o listener do AgentMail e
   esperar `SUBSCRIBED` **antes** de clicar em "Fazer login", pegar o código
   da linha `CODE|...` que ele imprime, voltar e submeter via JS, abrir
   `/account/home` e ler o heading `R$...`. Essa sequência, feita
   manualmente, resgatou toda conta que o script sozinho não conseguiu.
6. **Não trate uma conta como "com problema real" antes de pelo menos 2-3
   tentativas.** Numa sessão real, uma conta pareceu quebrada por 3
   tentativas seguidas e funcionou normalmente na 4ª — o ambiente é que
   estava instável naquele momento, não a conta.

## Rodando em lote

Para uma lista de N antenas, rode uma de cada vez (o script já lida com
login/logout/cookies por conta) e agregue a saída:

```bash
while IFS=, read -r id email; do
  bash scripts/process_antenna.sh "$id" "$email" "<arquivo com a senha>"
done < antenas.csv | tee resultados.txt
```

Recomendado: processar em lotes pequenos (≈10) com checkpoint entre eles —
dezenas de logins seguidos num provedor externo têm risco real de
rate-limit/bloqueio por fraude, e cada conta já leva 30–90s (a maior parte é
esperar o e-mail do código chegar).

Rodando via um agente (não um humano no terminal): cada chamada do script
tende a passar de ~150s por causa do polling do OTP, então o runner de
comando em background costuma mover a execução pra segundo plano
automaticamente — isso é esperado, não é sinal de problema. Espere o
resultado (ferramenta de block/wait no task, não polling manual) e, se
passar de ~3min sem terminar, trate como travado e siga o passo 3 do
playbook acima em vez de esperar indefinidamente.

## Relato de campo (release candidate do fluxo AgentMail, 2026-08-29)

Validação de ponta a ponta do fluxo novo (WebSocket em vez de leitura do
Outlook) contra a conta real `ti+p1@grupoamperelinsa.com`, antes de
considerá-lo pronto pra produção:

- **Achado e corrigido durante o teste:** `cookies clear`/`open` falhavam
  com `tab_gone` num Chrome recém-aberto (aba do daemon presa numa instância
  antiga) — travou o script ~1 minuto sem nenhum log antes de eu perceber e
  matar o processo. Corrigido vinculando explicitamente numa aba no início
  do script (ver [browser-flow.md § 1](browser-flow.md#1-chrome-via-cdp)).
  Só apareceu porque o Chrome foi reiniciado entre sessões de teste; num
  lote de produção contínuo (Chrome sobe uma vez só, processa todas as
  antenas) não deveria se repetir.
- **Confirmado nesse mesmo teste:** o clique em "Próximo" (via JS) não teve
  efeito na 1ª tentativa e funcionou normal na 2ª — motivou o retry de até 3
  tentativas que o script agora faz sozinho (`proximo_click_failed` /
  `senha_fill_error` acima).
- **O pipeline novo (a parte que este teste existia pra validar) funcionou
  de primeira, sem nenhum ajuste:** subscrição no AgentMail confirmada em
  ~4s, código real da Starlink capturado via `message.received` poucos
  segundos depois de clicar em "Fazer login", verificação aceita, saldo lido
  (`R$0,00`) — nenhum código velho, nenhuma purga necessária, nenhuma
  aba de e-mail aberta em momento nenhum.

## Relato de campo (rodada real, 2026-08-28, 47 antenas)

**Nota:** esta rodada usou a versão anterior do fluxo, que lia o OTP direto
da UI do Outlook (purga de códigos velhos, ordenação por horário) em vez do
WebSocket do AgentMail descrito agora em
[browser-flow.md § 3](browser-flow.md#3-receber-o-código-via-agentmail-websocket).
Os números abaixo (contagem de saldo, proporção de falha na 1ª tentativa)
continuam relevantes como referência de escala; os *motivos* de falha
específicos do Outlook (código velho, aba "Outros") não se aplicam mais.

- 10 antenas com saldo R$0,00, 37 com saldo em aberto (~R$14.200 somados).
- Primeira tentativa falhou em ~1/3 das contas; **100% delas** funcionaram
  ao reprocessar (uma via retry automático, a maioria via a sequência
  manual de recuperação do playbook).
- Motivo mais comum de falha na primeira tentativa: `otp_not_found` (código
  não chegou dentro da janela de polling) — não `otp_verification_failed`
  nem erro de conta.
- O maior consumo de tempo não foi nenhuma etapa de login — foi
  diagnosticar reconexões e travamentos de daemon no meio do lote.
