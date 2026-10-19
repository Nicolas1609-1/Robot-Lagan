#!/usr/bin/env bash
set -euo pipefail

tools_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
runtime_bin="${ROBOT_NODE_BIN:-$HOME/.local/share/robot-node/current/bin}"
if ! command -v node >/dev/null 2>&1 && [[ -x "$runtime_bin/node" ]]; then
  export PATH="$runtime_bin:$PATH"
fi
if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  printf '%s\n' 'Instala Node.js 22.12 o superior antes de iniciar la web.' >&2
  exit 1
fi

cd -- "$tools_dir"
if [[ ! -d node_modules/vite ]]; then
  printf '%s\n' 'Faltan las dependencias. Ejecuta npm ci en la carpeta tools.' >&2
  exit 1
fi
exec npm run dev -- "$@"
