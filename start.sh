#!/bin/sh
# Brings up Tailscale in userspace-networking mode so the pipeline can reach
# the home-Mac IG proxy over the tailnet, then execs the pipeline server.
set -e

if [ -n "$TS_AUTHKEY" ]; then
  echo "[tailscale] starting userspace daemon..."
  /usr/sbin/tailscaled \
    --tun=userspace-networking \
    --state=mem: \
    --socket=/var/run/tailscale/tailscaled.sock \
    --socks5-server=localhost:1055 \
    --outbound-http-proxy-listen=localhost:1055 \
    >/var/log/tailscaled.log 2>&1 &

  # Wait briefly for the socket
  for i in 1 2 3 4 5 6 7 8 9 10; do
    [ -S /var/run/tailscale/tailscaled.sock ] && break
    sleep 0.3
  done

  echo "[tailscale] joining tailnet..."
  # --exit-node: route public-IP traffic via the Mac (residential IP).
  #   In userspace-networking mode this only affects packets that go through
  #   tailscaled's SOCKS5/HTTP proxy (localhost:1055). Direct socket calls
  #   (YouTube scrape, fal.ai upload, Blockade API) bypass it and use
  #   Railway's normal network — so only Instagram, which we explicitly
  #   route via IG_PROXY_URL=socks5h://localhost:1055, exits via the Mac.
  : "${TS_EXIT_NODE:=eriks-macbook-pro}"
  /usr/bin/tailscale up \
    --authkey="$TS_AUTHKEY" \
    --hostname="${TS_HOSTNAME:-cozmos-pipeline}" \
    --accept-routes \
    --accept-dns=false \
    --exit-node="$TS_EXIT_NODE" \
    --exit-node-allow-lan-access=false
  /usr/bin/tailscale status || true
else
  echo "[tailscale] TS_AUTHKEY not set, skipping tailnet join (IG proxy disabled)"
fi

echo "[pipeline] starting server..."
exec python3 server.py
