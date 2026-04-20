#!/bin/sh
# Brings up Tailscale in userspace-networking mode so the pipeline can reach
# the home-Mac exit node over the tailnet, then execs the pipeline server.
# NOT using `set -e` — tailscale config failure must not crash the container;
# we still want the pipeline to serve (IG scrape will just fail gracefully).

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
  # --exit-node expects an IP or a unique node name; hostnames like
  # "eriks-macbook-pro" get rejected as ambiguous. Use the Mac's tailnet IP.
  : "${TS_EXIT_NODE:=100.106.195.29}"
  /usr/bin/tailscale up \
    --authkey="$TS_AUTHKEY" \
    --hostname="${TS_HOSTNAME:-cozmos-pipeline}" \
    --accept-routes \
    --accept-dns=false \
    --exit-node="$TS_EXIT_NODE" \
    --exit-node-allow-lan-access=false || {
      echo "[tailscale] WARN: tailscale up failed; pipeline will continue without IG proxy"
    }
  /usr/bin/tailscale status || true

  # Diagnostic: what egress IP does SOCKS5 proxy exit through?
  # If this prints the Mac's home IP → exit node works → Instagram IP-blacklist
  # is the real issue. If it prints a Tailscale DERP / Railway IP → exit node
  # didn't apply.
  echo "[diag] egress IP via socks5h://localhost:1055:"
  curl --max-time 10 --silent --proxy socks5h://localhost:1055 https://api.ipify.org || echo "  (curl failed)"
  echo
  echo "[diag] egress IP direct (no proxy, for comparison):"
  curl --max-time 10 --silent https://api.ipify.org || echo "  (curl failed)"
  echo
else
  echo "[tailscale] TS_AUTHKEY not set, skipping tailnet join (IG proxy disabled)"
fi

echo "[pipeline] starting server..."
exec python3 server.py
