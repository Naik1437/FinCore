#!/usr/bin/env bash
# Create local-only Nginx demo-gate credentials and cookie mapping.
# Never commit docker/certs or print the generated secret.
set -euo pipefail

CERT_DIR="${CERT_DIR:-./docker/certs}"
GATE_USER="${GATE_USER:-fincore_demo}"

command -v htpasswd >/dev/null 2>&1 || { echo "htpasswd is required (apache2-utils)." >&2; exit 1; }
command -v openssl >/dev/null 2>&1 || { echo "openssl is required." >&2; exit 1; }
mkdir -p "${CERT_DIR}"

umask 077
htpasswd -B -C 12 -c "${CERT_DIR}/.htpasswd" "${GATE_USER}"
# Nginx/libcrypt builds commonly accept $2b$ more consistently than htpasswd's
# default $2y$ output. Convert only the bcrypt prefix; never weaken the hash.
sed -i 's/\$2y\$/\$2b\$/' "${CERT_DIR}/.htpasswd"
COOKIE_VALUE="$(openssl rand -hex 24)"
cat > "${CERT_DIR}/gate_map.conf" <<EOF
map \$cookie_fincore_demo_gate \$demo_gate_ok {
  default 0;
  "${COOKIE_VALUE}" 1;
}
EOF
cat > "${CERT_DIR}/gate_set_cookie.conf" <<EOF
add_header Set-Cookie "fincore_demo_gate=${COOKIE_VALUE}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=86400" always;
EOF
chmod 600 "${CERT_DIR}/.htpasswd" "${CERT_DIR}/gate_map.conf" "${CERT_DIR}/gate_set_cookie.conf"
echo "Demo gate files created under ${CERT_DIR}; password and cookie value were not displayed."
