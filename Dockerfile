FROM node:20-alpine
WORKDIR /app

# Lockfile ko HAMESHA copy karo (wildcard ke bajaye explicit)
COPY package.json package-lock.json ./

# Lock ho to ci (fast/stable), warna auto fallback to install
RUN [ -f package-lock.json ] && npm ci --omit=dev || npm install --omit=dev

# Ab baaki code
COPY . .

EXPOSE 8000
CMD ["npm","start"]
