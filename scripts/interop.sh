#!/usr/bin/env bash
# Runs ledgerd (Go) and ledger-nest side by side on ONE database and checks
# that they are interchangeable: a transfer created by one is recognised as
# an idempotent replay by the other, and the shared books stay consistent.
#   GO_URL=http://localhost:8080 NEST_URL=http://localhost:3000 scripts/interop.sh
set -euo pipefail
GO=${GO_URL:-http://localhost:8080}
NEST=${NEST_URL:-http://localhost:3000}
json() { node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d)[process.argv[1]]))' "$1"; }
post() { curl -sf -X POST "$1" -H 'Content-Type: application/json' "${@:3}" -d "$2"; }

W=$(post "$NEST/v1/accounts" '{"name":"world","currency":"USD","allow_negative":true}' | json id)
A=$(post "$GO/v1/accounts" '{"name":"alice","currency":"USD"}' | json id)
KEY="interop-$RANDOM-$RANDOM"
BODY="{\"description\":\"cross-check <&>\",\"postings\":[{\"account_id\":\"$W\",\"amount\":-700},{\"account_id\":\"$A\",\"amount\":700}]}"

code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$GO/v1/transfers" -H "Idempotency-Key: $KEY" -d "$BODY")
[ "$code" = 201 ] || { echo "Go create: $code"; exit 1; }
hdrs=$(curl -s -D - -o /dev/null -X POST "$NEST/v1/transfers" -H 'Content-Type: application/json' -H "Idempotency-Key: $KEY" -d "$BODY")
echo "$hdrs" | grep -q '^HTTP/1.1 200' || { echo "Nest replay status: $hdrs"; exit 1; }
echo "$hdrs" | grep -qi '^idempotent-replayed: true' || { echo "Nest did not flag replay"; exit 1; }
[ "$(curl -sf "$NEST/v1/accounts/$A" | json balance)" = 700 ] || { echo "money moved twice"; exit 1; }
[ "$(curl -sf "$GO/v1/audit" | json consistent)" = true ] || { echo "audit failed"; exit 1; }
echo "interop OK: Go-created transfer replayed by NestJS; books consistent"
