#!/bin/sh
# Brings up Tailscale in userspace-networking mode so the pipeline can reach
# the home-Mac exit node over the tailnet, then execs the pipeline server.
# NOT using `set -e` — tailscale config failure must not crash the container;
# we still want the pipeline to serve (IG scrape will just fail gracefully).

if [ -n "$TS_AUTHKEY" ]; then
  echo "[tailscale] starting userspace daemon..."
  # Bind SOCKS5 + HTTP on explicit 127.0.0.1 (localhost resolution in the
  # container may land on ::1 which tailscaled doesn't listen on).
  # Separate ports so neither server silently loses the bind.
  /usr/sbin/tailscaled \
    --tun=userspace-networking \
    --state=mem: \
    --socket=/var/run/tailscale/tailscaled.sock \
    --socks5-server=127.0.0.1:1055 \
    --outbound-http-proxy-listen=127.0.0.1:1056 \
    >/var/log/tailscaled.log 2>&1 &

  # Wait briefly for the socket
  for i in 1 2 3 4 5 6 7 8 9 10; do
    [ -S /var/run/tailscale/tailscaled.sock ] && break
    sleep 0.3
  done

  echo "[tailscale] joining tailnet..."
  # We use tailscale ONLY to reach the Mac's tailnet IP (100.106.195.29).
  # No exit-node — userspace-networking has a known limitation where
  # --exit-node doesn't route public traffic through SOCKS5 proxies.
  # Instead, tinyproxy on the Mac handles the actual public-internet hop,
  # and a small socat forwarder in this container bridges Python's
  # localhost to tinyproxy over the tailnet SOCKS5.
  /usr/bin/tailscale up \
    --authkey="$TS_AUTHKEY" \
    --hostname="${TS_HOSTNAME:-cozmos-pipeline}" \
    --accept-routes \
    --accept-dns=false || {
      echo "[tailscale] WARN: tailscale up failed; pipeline will continue without IG proxy"
    }
  /usr/bin/tailscale status || true

  # Give tailscaled a few seconds to fully bring up the proxy listeners
  # after tailnet auth — they don't start accepting until the node is ready.
  sleep 5

  echo "[diag] listeners on 127.0.0.1 (socks5 + http proxy):"
  (command -v ss >/dev/null && ss -tln 2>/dev/null | grep -E "1055|1056") || \
    (command -v netstat >/dev/null && netstat -tln 2>/dev/null | grep -E "1055|1056") || \
    echo "  (no ss/netstat available)"

  echo "[diag] tailscale ping 100.106.195.29 (Mac):"
  /usr/bin/tailscale ping --timeout=8s --c=3 100.106.195.29 2>&1 | sed 's/^/  /'

  echo "[diag] tailscale debug prefs:"
  /usr/bin/tailscale debug prefs 2>&1 | grep -iE "exitnode|exit_node|advertiseexit" | sed 's/^/  /'

  # Socat bridge: Python's localhost:8888 → SOCKS5 → tailnet → Mac tinyproxy:8888.
  # Instagram traffic enters this bridge via IG_PROXY_URL=http://...@localhost:8888,
  # traverses the tailnet, and egresses from the Mac's residential ISP.
  echo "[bridge] starting socat: localhost:8888 → SOCKS5(127.0.0.1:1055) → 100.106.195.29:8888"
  socat TCP-LISTEN:8888,fork,reuseaddr,bind=127.0.0.1 \
        SOCKS5:127.0.0.1:100.106.195.29:8888,socksport=1055 \
        >/var/log/socat.log 2>&1 &

  sleep 2
  echo "[diag] after bridge — egress IP via http://127.0.0.1:8888 (should be home IP):"
  curl --max-time 15 --silent --proxy "http://biosphere:NeverSt0pSwinging%21@127.0.0.1:8888" https://api.ipify.org \
    || echo "  (bridge curl failed)"
  echo

  echo "[diag] egress IP via SOCKS5 (socks5h://127.0.0.1:1055):"
  curl --max-time 20 --silent --proxy socks5h://127.0.0.1:1055 https://api.ipify.org || echo "  (socks5 curl failed)"
  echo
  echo "[diag] egress IP via HTTP proxy (http://127.0.0.1:1056):"
  curl --max-time 20 --silent --proxy http://127.0.0.1:1056 https://api.ipify.org || echo "  (http curl failed)"
  echo
  echo "[diag] egress IP direct (no proxy, Railway egress):"
  curl --max-time 10 --silent https://api.ipify.org || echo "  (direct curl failed)"
  echo
else
  echo "[tailscale] TS_AUTHKEY not set, skipping tailnet join (IG proxy disabled)"
fi

echo "[pipeline] starting server..."
exec python3 server.py
