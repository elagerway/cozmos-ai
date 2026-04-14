FROM pytorch/pytorch:2.1.0-cuda12.1-cudnn8-runtime

# Install libvips and system deps
RUN apt-get update && apt-get install -y \
    libvips libvips-dev \
    libgl1 libglib2.0-0 \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python deps (torch already in base image)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Download Real-ESRGAN model weights at build time
RUN python3 -c "\
import os, urllib.request; \
os.makedirs(os.path.expanduser('~/.cache/realesrgan'), exist_ok=True); \
urllib.request.urlretrieve( \
    'https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth', \
    os.path.expanduser('~/.cache/realesrgan/RealESRGAN_x4plus.pth') \
); print('Model downloaded')"

COPY . .

EXPOSE 8100

CMD ["python3", "server.py"]
