# Fluxo de navegador, passo a passo (com as armadilhas)

Leia isto quando: precisar reproduzir o fluxo manualmente (o script travou,
ou você está seguindo o [playbook de recuperação](troubleshooting.md)), ou
quando estiver construindo uma automação parecida de login + OTP por e-mail
em outro site — a maioria das armadilhas abaixo não é específica da
Starlink.

## Índice

1. [Chrome via CDP (contorna bloqueio de Application Control Policy)](#1-chrome-via-cdp)
2. [Login no portal Starlink + verificação em duas etapas](#2-login-no-portal-starlink--verificação-em-duas-etapas)
3. [Receber o código via AgentMail WebSocket](#3-receber-o-código-via-agentmail-websocket)
4. [Submeter o código e ler o saldo](#4-submeter-o-código-e-ler-o-saldo)
5. [Logout correto entre contas](#5-logout-correto-entre-contas)

## 1. Chrome via CDP

Em máquina Windows com Application Control Policy (comum em endpoint
corporativo), o Chrome baixado pelo próprio `agent-browser` é bloqueado ao
tentar abrir, com um erro citando "política de Controle de Aplicativo".

Isso é a política do SO, não algo pra contornar por engenharia reversa.
A saída correta: usar o Chrome **já instalado e assinado** do sistema
(`C:\Program Files\Google\Chrome\Application\chrome.exe`), que a política
já confia, e conectar o `agent-browser` nele via CDP:

```bash
"C:\Program Files\Google\Chrome\Application\chrome.exe" \
  --remote-debugging-port=9222 \
  --user-data-dir="./chrome-profile" \
  --no-first-run --no-default-browser-check about:blank &

curl -s http://localhost:9222/json/version   # confirma que subiu
```

A partir daqui, **todo** comando usa `--cdp 9222` em vez de `--session <nome>`:

```bash
agent-browser --cdp 9222 open "https://www.starlink.com/auth/login"
agent-browser --cdp 9222 tab list
agent-browser --cdp 9222 tab t1
agent-browser --cdp 9222 snapshot -i
```

Só a aba do portal Starlink precisa desse Chrome agora — a captura do OTP
(seção 3) não passa mais por nenhuma aba de e-mail.

**Armadilha — `--pin-tab` com `--cdp` deu `tab_gone` falso:** usar
`--session <nome> --pin-tab --cdp 9222` gerou erros intermitentes
`tab_gone` apontando pra uma URL que nunca existiu nesta sessão (parece
estado de pin cruzado entre invocações). Solução: **não usar `--pin-tab`**
quando há só um Chrome dedicado à automação — usar `--cdp 9222` puro e
resolver a aba certa via `tab list` toda vez.

**Armadilha — IDs de aba (`t1`, `t2`, `t3`) não são posições fixas:** depois
de abrir/fechar abas ou navegar, `t1` pode deixar de ser a aba certa.
Resolva a aba certa pela URL a cada vez, não assuma a posição:

```bash
agent-browser --cdp 9222 tab list | grep -oE '\[t[0-9]+\].*starlink\.com' | grep -oE 't[0-9]+' | head -1
```

**Armadilha — `cookies clear`/`open` sem aba vinculada dão `tab_gone` depois
de reiniciar o Chrome:** se o Chrome foi encerrado e reaberto (novo
processo/profile) desde a última vez que o `agent-browser` rodou, o estado
persistido do daemon ainda aponta pro *target* da instância antiga — que não
existe mais. `cookies clear` e `open` (chamados sem um id de aba explícito)
tentam essa referência velha e falham com `tab_gone`, mesmo com `tab list`
mostrando uma aba atual perfeitamente válida. Sintoma confirmado rodando
`process_antenna.sh` contra um Chrome recém-aberto: o script ficou preso
~1 minuto sem nenhum log (todo o output vai pra `/dev/null`), porque tanto
`cookies clear` quanto `open` falhavam silenciosamente em loop. `close --all`
+ `doctor --fix` **não resolvem** isso sozinhos — o fix é vincular
explicitamente numa aba existente (ou abrir uma) antes de qualquer comando
que dependa de "a aba vinculada":

```bash
agent-browser --cdp 9222 tab t1   # ou: agent-browser --cdp 9222 tab new "about:blank"
agent-browser --cdp 9222 cookies clear
```

`process_antenna.sh` já faz isso logo no início, antes do primeiro
`cookies clear`.

## 2. Login no portal Starlink + verificação em duas etapas

```bash
agent-browser --cdp 9222 tab new "https://www.starlink.com/auth/login"
agent-browser --cdp 9222 wait --load networkidle
agent-browser --cdp 9222 find role textbox fill "ti+11@grupoamperelinsa.com" --name "E-mail"
agent-browser --cdp 9222 find role button click --name "Próximo"
agent-browser --cdp 9222 wait --load networkidle
agent-browser --cdp 9222 find role textbox fill "<senha compartilhada>" --name "Senha"
# -> NÃO clique em "Fazer login" ainda: primeiro suba o listener do AgentMail
# (seção 3) e só clique depois que ele confirmar a subscrição.
agent-browser --cdp 9222 find role button click --name "Fazer login"
agent-browser --cdp 9222 wait --load networkidle
# -> heading "Verificação em duas etapas" + textbox "Código de acesso"
```

**Armadilha — sintaxe do `find` com role + fill:** a ordem certa é
`find role <role> fill <texto> --name <nome>` — **não**
`find role <role> fill --name <nome> <texto>` (essa segunda forma falha
silenciosamente / com erro de parsing). Confirme com `agent-browser find --help`
se tiver dúvida — a ordem dos argumentos posicionais muda por localizador.
Isso funciona bem para **preencher** campos de texto (`fill`).

**Armadilha grave — cliques em botão via accessibility tree são pouco
confiáveis nesse site:** `starlink.com` é uma app MUI/React. `find role
button click --name "..."` (e até `find text "..." click`) **falham
silenciosamente** com frequência — o comando retorna sucesso, mas o clique
não chega no handler real do botão e a página nunca avança. Isso vale pro
banner de cookies, "Próximo", "Fazer login", "Verificar" — qualquer botão do
fluxo de login.

Solução que funcionou de forma consistente: clicar via JavaScript direto no
elemento real, não pela árvore de acessibilidade:

```bash
cat <<'EOF' | agent-browser --cdp 9222 eval --stdin
(function(){
  const els = Array.from(document.querySelectorAll('button, [role="button"]'));
  const btn = els.find(e => e.textContent.trim() === 'Próximo');
  if (!btn) return 'not-found';
  btn.click();
  return 'clicked';
})()
EOF
```

O mesmo vale pro botão de aceitar cookies — em vez de `find`, clique direto
por id:

```bash
cat <<'EOF' | agent-browser --cdp 9222 eval --stdin
(function(){ const b=document.querySelector('#onetrust-accept-btn-handler'); if(b){b.click(); return 'ok';} return 'no-banner'; })()
EOF
```

Preenchimento de campos de texto (`find role textbox fill ...`) continua
confiável — o problema é especificamente com cliques em botão nesse site.

**Armadilha — mesmo o clique via JS falha de vez em quando:** confirmado
numa rodada release-candidate (2026-08-29): o clique em "Próximo" via JS não
teve efeito nenhum na primeira tentativa (a página ficou parada no form de
e-mail, sem nenhum alerta de erro visível), e um clique idêntico logo em
seguida avançou normalmente pra tela de senha. Não é regressão do clique via
JS nem sinal de conta com problema — é a mesma instabilidade transitória de
~1/3 descrita em [SKILL.md § Antes de tudo](../SKILL.md#antes-de-tudo-calibre-a-expectativa),
só que também alcança o clique via JS, não só o via accessibility tree.
`process_antenna.sh` já reflete isso: tenta o clique em "Próximo" até 3
vezes, checando se o campo "Senha" apareceu antes de desistir
(`FAIL|...|proximo_click_failed` só depois das 3 tentativas).

## 3. Receber o código via AgentMail WebSocket

A caixa de e-mail que recebe o OTP (`ti@grupoamperelinsa.com`) tem uma regra
de encaminhamento que copia todo e-mail "código de verificação da Starlink"
— não importa qual plus-address (`ti+11@...`, `ti+25@...`, etc.) foi o
destinatário original — pra uma inbox do AgentMail. Em vez de abrir uma aba
de e-mail e ler a UI, o script se inscreve nessa inbox via WebSocket com o
módulo `../../../../src/lib/wait-for-otp.ts` (SDK
[agentmail](../../agentmail/SKILL.md), ver
[references/websockets.md](../../agentmail/references/websockets.md) pra a
API completa) e recebe o código pelo evento `message.received` assim que o
e-mail chega.

**Armadilha crítica — sempre inscreva ANTES de disparar o e-mail, não
depois:** o e-mail do OTP só é enviado quando "Fazer login" é clicado (seção
2). Se a inscrição no WebSocket só começar depois desse clique, existe uma
janela real onde o e-mail pode chegar (e o evento `message.received` ser
emitido) antes de qualquer coisa estar escutando — e esse evento se perde
para sempre, não fica em fila. A ordem correta é sempre: conectar → confirmar
subscrição (evento `type: "subscribed"`) → **só então** clicar em "Fazer
login".

`process_antenna.sh` faz isso rodando o listener em background e esperando
uma linha `SUBSCRIBED` no stdout antes de prosseguir:

```bash
OTP_OUT=$(mktemp)
pnpm exec tsx src/wait-for-otp-cli.ts \
  --inbox raave@agentmail.to \
  --from "grupoamperelinsa.com" \
  --subject-contains "código de verificação" \
  --timeout-ms 90000 >"$OTP_OUT" 2>&1 &
OTP_PID=$!

for i in $(seq 1 50); do
  grep -q "^SUBSCRIBED" "$OTP_OUT" && break
  sleep 0.2
done
# -> só agora clicar em "Fazer login"

wait "$OTP_PID"
CODE=$(grep -m1 "^CODE|" "$OTP_OUT" | cut -d'|' -f2)
```

**Armadilha — o SDK confirma a conexão como já aberta antes que o handler
`on("open", ...)` do exemplo da doc consiga rodar**, e nesse caso o handler
nunca dispara e o `sendSubscribe` nunca é enviado (o socket fica conectado
mas mudo, sem erro nenhum). `wait-for-otp.ts` já cobre isso: subscreve
imediatamente se `sock.readyState === 1` (já aberto) e só usa o handler
`on("open", ...)` como fallback pro caso de ainda não estar aberto. Validado
rodando o listener de verdade e checando com `console.log` que a subscrição
só saía com esse ajuste — sem ele, o processo ficava preso até o timeout,
sem nunca receber nada.

**Armadilha — quedas de conexão no meio da espera não devem ser tratadas
como falha definitiva.** O transporte (`ReconnectingWebSocket`) tenta
reconectar sozinho (até 30 vezes, com backoff), mas ao reconectar a
subscrição anterior se perde — precisa reenviar `sendSubscribe` em **todo**
evento `open`, não só no primeiro. `wait-for-otp.ts` faz isso; só um evento
de erro de nível de aplicação (`type: "error"` vindo do servidor — API key
inválida, inbox inexistente) é tratado como falha imediata. Uma queda de
rede simples só falha se o timeout geral (`--timeout-ms`) esgotar antes da
reconexão se completar — coerente com o padrão do resto desta skill de não
desistir no primeiro sinal de instabilidade (ver
[troubleshooting.md](troubleshooting.md)).

Sem nenhuma pasta pra checar, nenhuma purga de código velho, e nenhuma
ordenação por horário: como o WebSocket só entrega eventos de e-mails que
chegam **depois** da subscrição, um código de uma tentativa anterior
estruturalmente não pode ser confundido com o novo — a classe inteira de bug
"pegou o código errado/velho" que existia na leitura via UI do Outlook não
se aplica mais aqui.

## 4. Submeter o código e ler o saldo

```bash
agent-browser --cdp 9222 tab t2   # aba do Starlink (resolvida por URL, ver seção 1)
agent-browser --cdp 9222 find role textbox fill "127795" --name "Código de acesso"
agent-browser --cdp 9222 find role button click --name "Verificar"
agent-browser --cdp 9222 wait --load networkidle
```

Depois de verificar, o portal costuma redirecionar pra `starlink.com/br`
(home de marketing), **não** direto pro dashboard — navegue explicitamente:

```bash
agent-browser --cdp 9222 open "https://www.starlink.com/account/home"
agent-browser --cdp 9222 wait --load networkidle
agent-browser --cdp 9222 snapshot -i -c | grep -oE 'heading "R\$[0-9.,]+"'
```

O primeiro heading `R$X,XX` da página é o **saldo devedor** — confirmado
pelo usuário que é a mesma coisa mostrada na aba "Faturamento" (o resumo no
topo). Não precisa abrir Faturamento.

## 5. Logout correto entre contas

**Clicar em "Sair" sozinho NÃO desloga de verdade**, e a tela de confirmação
que aparece depois ("Sim, sair agora" / "Voltar") também sofre do mesmo
problema de clique não confiável da seção 2. Se o logout via UI não for
100% confirmado, o cookie de sessão continua válido — a próxima tentativa
de login (mesmo indo direto pra `/auth/login`) **reautentica silenciosamente
na conta anterior**, sem mostrar formulário de e-mail. Isso gera exatamente
o sintoma de "campo de e-mail não encontrado" no próximo login.

Na prática, `cookies clear` sozinho — sem passar pela UI de "Sair" — se
provou o método mais simples e confiável. Confirmado navegando de volta pra
`/auth/login` logo em seguida e checando que aparece o formulário de e-mail
(não o dashboard):

```bash
agent-browser --cdp 9222 cookies clear
```

E toda conta nova começa com `cookies clear` antes de abrir `/auth/login` de
qualquer forma (independente do logout anterior ter rodado) — é o jeito
mais barato de garantir estado limpo.
