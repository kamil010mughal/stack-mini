FROM node:20-alpine
WORKDIR /app

# Dono files ko explicitly copy karo (wildcard se masla hota rehta hai)
COPY package.json package-lock.json ./

# Agar lock file hai to npm ci, warna npm install (fallback)
RUN [ -f package-lock.json ] && npm ci --omit=dev || npm install --omit=dev

# Baqi code copy
COPY . .

EXPOSE 8000
CMD ["npm","start"]
