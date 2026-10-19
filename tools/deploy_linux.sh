#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
export PATH="$HOME/.local/share/robot-node/current/bin:$PATH"
npm test
npm run build
install -D -m 644 samurai-web.service "$HOME/.config/systemd/user/samurai-web.service"
systemctl --user daemon-reload
systemctl --user enable samurai-web.service
systemctl --user restart samurai-web.service
curl --retry 8 --retry-delay 1 --retry-connrefused -fsS http://127.0.0.1:8090/healthz
printf '\nService URL de Cloudflare: http://localhost:8090\n'
if ! loginctl --no-ask-password enable-linger "$USER"; then
 printf 'Para iniciar también tras reiniciar el servidor: sudo loginctl enable-linger %s\n' "$USER"
fi
