FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    libvips42 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
RUN playwright install chromium --with-deps

COPY . .

EXPOSE 8100

CMD ["python3", "server.py"]
