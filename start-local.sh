#!/bin/zsh
# Sobe a cópia local do Builders Bot (build de desenvolvimento, perfil isolado).
# Modelo padrão dos agentes: culturabuilder-rtx/deepseek-v4.1-flash-1017-uncensored
# Esforço de raciocínio precisa ser "high" (low também vale); "medium" é recusado pelo gateway.
set -e
cd "$(dirname "$0")"
export BUILDERSBOT_API_PORT="${BUILDERSBOT_API_PORT:-3110}"
exec bun run dev
