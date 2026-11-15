# The TCC workspace's entry points, with erp-v1/secrets loaded where each part expects it.
#
#   make dev        the whole stack: network (Go) -> web + api -> importer, vault, billing, tcc
#                   (tcc = this workspace's `pnpm run dev`: server + dashboard, both joined to the network)
#   make tcc        this workspace alone (server + dashboard), still joined to the network if one runs
#   make install    pnpm install here
#   make typecheck  pnpm -r typecheck
#   make exe        the packaged build (launcher xtask dist -> erp-v1/bin, with services/tcc/tcc-v2.exe)
#
# Secrets: erp-v1/secrets (this folder may be erp-v1/tcc-v2/tcc-v1/demo-monorepo-workspace or the source
# copy tcc-v2/tcc-v1/demo-monorepo-workspace beside erp-v1). Only what crosses process boundaries is
# exported: NETWORK_TOKEN (secrets/network_token), TCC_TOKEN + TCC_TELEMETRY_URL (secrets/tcc-server.env,
# for the ERP API) and TCC_SECRETS_DIR. DATABASE_URL & co. are NOT exported: the TCC server reads them from
# tcc-server.env itself, and the ERP API must keep its own.

# Recipes need bash. From PowerShell/cmd, make doesn't find "bash" on PATH and falls back to cmd.exe, so on
# Windows use Git Bash by its full path.
ifeq ($(OS),Windows_NT)
GIT_BASH := $(firstword $(wildcard C:/Program\ Files/Git/bin/bash.exe C:/Program\ Files/Git/usr/bin/bash.exe))
ifeq ($(GIT_BASH),)
$(error Git Bash not found (C:/Program Files/Git/bin/bash.exe); install Git for Windows)
endif
SHELL := C:/Program Files/Git/bin/bash.exe
else
SHELL := bash
endif
HERE  := $(patsubst %/,%,$(dir $(abspath $(lastword $(MAKEFILE_LIST)))))

ERP_V1 := $(firstword $(wildcard $(HERE)/../../../erp-v1/secrets/generate.ts $(HERE)/../../../secrets/generate.ts))
ERP_V1 := $(abspath $(patsubst %/secrets/generate.ts,%,$(ERP_V1)))
ifeq ($(ERP_V1),)
$(error erp-v1/secrets not found above $(HERE))
endif
SECRETS := $(ERP_V1)/secrets
ERP     := $(ERP_V1)/sample-ERP/sample-ERP

# KEY from tcc-server.env (the file is KEY=value lines)
tcc_env = $(strip $(shell sed -n 's/^$(1)=//p' "$(SECRETS)/tcc-server.env" 2>/dev/null | tr -d '\r"'))
TCC_PORT := $(or $(call tcc_env,PORT),8787)

export TCC_SECRETS_DIR   := $(SECRETS)
export TCC_DIR           := $(HERE)
export TCC_TOKEN         := $(call tcc_env,TCC_TOKEN)
export TCC_TELEMETRY_URL := http://127.0.0.1:$(TCC_PORT)/telemetry/host
export NETWORK_TOKEN     := $(strip $(shell tr -d '\r\n' < "$(SECRETS)/network_token" 2>/dev/null))
NETWORK_URL ?= http://127.0.0.1:7070

.PHONY: dev tcc install typecheck exe check-secrets

check-secrets:
	@test -f "$(SECRETS)/tcc-server.env" || { echo "missing $(SECRETS)/tcc-server.env"; exit 1; }
	@test -n "$$NETWORK_TOKEN" || { echo "missing $(SECRETS)/network_token (cd $(SECRETS) && bun run network-token)"; exit 1; }
	@echo "secrets: $(SECRETS)  tcc: http://127.0.0.1:$(TCC_PORT)  erp: $(ERP)"

dev: check-secrets
	cd "$(ERP)" && go run ./network/cmd/network dev

tcc: check-secrets
	NETWORK_URL=$(NETWORK_URL) pnpm run dev

install:
	pnpm install

typecheck:
	pnpm -r typecheck

exe:
	cd "$(ERP_V1)/launcher" && cargo xtask dist
