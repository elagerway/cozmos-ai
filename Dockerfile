FROM python:3.12-slim

# System deps: pyvips + certs + tailscale dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    libvips42 \
    libglib2.0-0 \
    ca-certificates \
    curl \
    iptables \
    socat \
    iproute2 \
    && rm -rf /var/lib/apt/lists/*

# Tailscale (official install script — writes /usr/bin/tailscale + /usr/sbin/tailscaled)
RUN curl -fsSL https://tailscale.com/install.sh | sh

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
RUN playwright install chromium --with-deps

COPY . .
RUN chmod +x /app/start.sh

EXPOSE 8100

CMD ["/app/start.sh"]
