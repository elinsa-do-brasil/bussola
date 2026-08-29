#!/bin/bash
# Logs into one Starlink account via agent-browser, retrieves the OTP by
# subscribing to an AgentMail inbox over WebSocket (the Outlook mailbox has a
# forwarding rule that copies each OTP email there), reads the "saldo
# devedor" balance, and logs out.
#
# Usage: process_antenna.sh <ANTENNA_ID> <EMAIL> <PASS_FILE>
#   ANTENNA_ID free-form label used only in the output line (e.g. "M-0011")
#   EMAIL      login email for this Starlink account. Deployments that use
#              plus-addressing over a shared mailbox pass ti+N@domain.com;
#              deployments where every account has its own distinct email
#              just pass that email instead - nothing else changes.
#   PASS_FILE  path to a local file containing ONLY this account's password
#              (no trailing content besides the password/newline). If
#              passwords are shared across accounts, every call can point
#              at the same file; if each account has its own password,
#              write a fresh file per account before calling this script.
#
# Requires: a Chrome instance already running with --remote-debugging-port=9222
# (see ../references/browser-flow.md "1. Chrome via CDP" for why agent-browser's
# own bundled Chrome may be blocked and how to launch a system Chrome instead);
# AGENTMAIL_API_KEY set in the environment (or in a .env at the repo root -
# this script sources it automatically if not already set); and the Outlook
# mailbox that receives the 2FA code already has a forwarding rule copying
# those emails to the AgentMail inbox in AGENTMAIL_INBOX_ID (default
# raave@agentmail.to) - see ../references/browser-flow.md "3. Receber o
# código via AgentMail WebSocket" for how that rule is set up. No browser tab
# into Outlook is needed anymore for the OTP step.
#
# Prints exactly one line to stdout:
#   RESULT|<ANTENNA_ID>|<EMAIL>|<SALDO>   on success
#   FAIL|<ANTENNA_ID>|<EMAIL>|<REASON>    on failure (also exits 1)
set -uo pipefail

ANTENNA_ID="$1"
EMAIL="$2"
PASS_FILE="$3"
CDP=9222
AGENTMAIL_INBOX="${AGENTMAIL_INBOX_ID:-raave@agentmail.to}"
OTP_PID=""

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"

# AGENTMAIL_API_KEY isn't always exported in the caller's shell - fall back to
# the repo's own .env (same one the rest of the stargazer project uses).
if [ -z "${AGENTMAIL_API_KEY:-}" ] && [ -f "$REPO_ROOT/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$REPO_ROOT/.env"
  set +a
fi

ab() { agent-browser --cdp "$CDP" "$@"; }

fail() {
  # Kill the background OTP listener if one was started - otherwise it keeps
  # running (and holding a live WebSocket) past this script's exit.
  [ -n "$OTP_PID" ] && kill "$OTP_PID" >/dev/null 2>&1
  echo "FAIL|$ANTENNA_ID|$EMAIL|$1"
  exit 1
}

[ -n "${AGENTMAIL_API_KEY:-}" ] || fail "agentmail_api_key_missing"

starlink_tab() {
  agent-browser --cdp "$CDP" tab list 2>/dev/null | grep -oE '\[t[0-9]+\].*starlink\.com' | grep -oE 't[0-9]+' | head -1
}

# agent-browser's accessibility-based `find role button click` is UNRELIABLE
# on starlink.com (a MUI/React app) — clicks silently land on nothing and the
# page never advances, with no error. A direct JS .click() on the real DOM
# button is reliable. Match by exact trimmed textContent.
js_click_button() {
  local text="$1"
  cat <<EOF | agent-browser --cdp "$CDP" eval --stdin
(function(){
  const els = Array.from(document.querySelectorAll('button, [role="button"]'));
  const btn = els.find(e => e.textContent.trim() === '$text');
  if (!btn) return 'not-found';
  btn.click();
  return 'clicked';
})()
EOF
}

# A previous run's tab can be left behind (e.g. this script killed by an
# external timeout mid-run). If more than one starlink.com tab exists,
# starlink_tab() would grab an unpredictable one - close extras first.
EXTRA_TABS=$(agent-browser --cdp "$CDP" tab list 2>/dev/null | grep -oE '\[t[0-9]+\].*starlink\.com' | grep -oE 't[0-9]+')
FIRST_KEPT=""
for t in $EXTRA_TABS; do
  if [ -z "$FIRST_KEPT" ]; then FIRST_KEPT="$t"; continue; fi
  agent-browser --cdp "$CDP" tab close "$t" >/dev/null 2>&1
done

# `cookies clear` and `open` below target "the bound tab" implicitly when no
# tab id is given. If the Chrome instance was restarted (new profile/PID)
# since agent-browser last ran, its persisted session state still points at
# a tab target from the OLD instance - that target no longer exists, and
# both commands fail with "tab_gone" even though `tab list` shows a
# perfectly good current tab. Explicitly (re)bind to an existing tab (or
# open one) first so there's never an implicit stale reference to resolve.
CUR_TAB=$(agent-browser --cdp "$CDP" tab list 2>/dev/null | grep -oE '\[t[0-9]+\]' | head -1 | grep -oE 't[0-9]+')
if [ -n "$CUR_TAB" ]; then
  agent-browser --cdp "$CDP" tab "$CUR_TAB" >/dev/null 2>&1
else
  agent-browser --cdp "$CDP" tab new "about:blank" >/dev/null 2>&1
fi

# --- Starlink login (force a clean, unauthenticated session first) ---
# Starlink's UI logout ("Sair" -> "Sim, sair agora") proved unreliable to
# drive by automation; `cookies clear` is the one method that reliably forces
# a fresh unauthenticated state, confirmed by reloading /auth/login afterward.
ab cookies clear >/dev/null 2>&1
ab open "https://www.starlink.com/auth/login" >/dev/null 2>&1
ab wait --load networkidle >/dev/null 2>&1
# Cookie-clear brings back the OneTrust consent banner, which covers the
# "Próximo" button. Click its real button by id directly via JS — the
# accessibility-based find/click on this banner is unreliable too.
cat <<'EOF' | agent-browser --cdp "$CDP" eval --stdin >/dev/null 2>&1
(function(){ const b=document.querySelector('#onetrust-accept-btn-handler'); if(b){b.click(); return 'ok';} return 'no-banner'; })()
EOF
ab wait 500 >/dev/null 2>&1
ab find role textbox fill "$EMAIL" --name "E-mail" >/dev/null 2>&1 || fail "email_fill_error"

# The JS click on "Próximo" is far more reliable than the accessibility-tree
# click it replaces, but not 100% - confirmed in a release-candidate run
# where the first click silently did nothing (page stayed on the email
# form, no error alert) and an identical retry advanced it normally a few
# seconds later. Retry a few times rather than fail on the first miss.
PROXIMO_OK=""
for attempt in 1 2 3; do
  js_click_button "Próximo" >/dev/null 2>&1
  ab wait --load networkidle >/dev/null 2>&1
  if ab snapshot -i 2>&1 | grep -q "Senha"; then
    PROXIMO_OK=1
    break
  fi
  ab wait 1000 >/dev/null 2>&1
done
[ -n "$PROXIMO_OK" ] || fail "proximo_click_failed"

ab find role textbox fill "$(cat "$PASS_FILE")" --name "Senha" >/dev/null 2>&1 || fail "senha_fill_error"

# --- Start listening for the OTP BEFORE submitting the login form ---
# The AgentMail WebSocket subscription must already be live before "Fazer
# login" is clicked, or the OTP email (and its message.received event) can
# arrive before anything is listening for it and be missed entirely.
OTP_OUT=$(mktemp)
pnpm --dir "$REPO_ROOT" exec tsx "$REPO_ROOT/src/wait-for-otp-cli.ts" \
  --inbox "$AGENTMAIL_INBOX" \
  --from "grupoamperelinsa.com" \
  --subject-contains "código de verificação" \
  --timeout-ms 90000 >"$OTP_OUT" 2>&1 &
OTP_PID=$!

SUBSCRIBED=""
for i in $(seq 1 50); do
  grep -q "^SUBSCRIBED" "$OTP_OUT" 2>/dev/null && { SUBSCRIBED=1; break; }
  sleep 0.2
done
[ -n "$SUBSCRIBED" ] || fail "agentmail_subscribe_timeout"

js_click_button "Fazer login" >/dev/null 2>&1
ab wait --load networkidle >/dev/null 2>&1

SNAP=$(ab snapshot -i 2>&1)
if ! echo "$SNAP" | grep -q "Verificação em duas etapas"; then
  if echo "$SNAP" | grep -qi "incorret\|inválid\|error"; then
    fail "login_error: $(echo "$SNAP" | grep -i 'incorret\|inválid\|error' | head -1)"
  fi
  fail "no_2fa_screen"
fi

ST_TAB=$(starlink_tab)
[ -n "$ST_TAB" ] || fail "starlink_tab_not_found"

# --- Wait for the OTP listener to receive and extract the code ---
# No purge-old-codes step and no "pick the newest by timestamp" sorting here
# (both were needed by the old Outlook-scraping approach): the WebSocket only
# ever delivers events for mail that arrives AFTER the subscription above, so
# a stale/leftover code from a previous run structurally can't be picked up.
wait "$OTP_PID"
CODE=$(grep -m1 "^CODE|" "$OTP_OUT" | cut -d'|' -f2)
REASON=$(grep -m1 "^FAIL|" "$OTP_OUT" | cut -d'|' -f2-)
rm -f "$OTP_OUT"
[ -n "$CODE" ] || fail "otp_not_found${REASON:+: $REASON}"

# --- Submit OTP on Starlink tab ---
# Re-resolve rather than trust the ST_TAB captured earlier: tab ids renumber
# whenever ANY tab opens/closes, so a stale id here silently fills the code
# into the wrong tab.
ST_TAB=$(starlink_tab)
[ -n "$ST_TAB" ] || fail "starlink_tab_not_found_before_submit"
agent-browser --cdp "$CDP" tab "$ST_TAB" >/dev/null 2>&1
agent-browser --cdp "$CDP" find role textbox fill "$CODE" --name "Código de acesso" >/dev/null 2>&1 || fail "otp_fill_error"
js_click_button "Verificar" >/dev/null 2>&1
agent-browser --cdp "$CDP" wait --load networkidle >/dev/null 2>&1

# After a successful verification, Starlink often redirects to the marketing
# homepage (starlink.com/br) instead of the dashboard - navigate explicitly.
agent-browser --cdp "$CDP" open "https://www.starlink.com/account/home" >/dev/null 2>&1
agent-browser --cdp "$CDP" wait --load networkidle >/dev/null 2>&1
HOME_SNAP=$(agent-browser --cdp "$CDP" snapshot -i -c 2>&1)
SALDO=$(echo "$HOME_SNAP" | grep -oE 'heading "R\$[0-9.,]+"' | head -1 | grep -oE 'R\$[0-9.,]+')

if [ -z "$SALDO" ]; then
  # verification may have failed silently (stale/expired code) - detect and fail clearly
  if echo "$HOME_SNAP" | grep -q "Fazer login"; then
    fail "otp_verification_failed"
  fi
  fail "saldo_not_found"
fi

echo "RESULT|$ANTENNA_ID|$EMAIL|$SALDO"

# --- Logout (cookies clear is the only reliable method — see above) ---
agent-browser --cdp "$CDP" tab "$ST_TAB" >/dev/null 2>&1
agent-browser --cdp "$CDP" cookies clear >/dev/null 2>&1
