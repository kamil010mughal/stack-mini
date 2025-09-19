FROM node:20-alpine
# ✅ TLS fix: Cloudflare R2 ke liye CA bundle install
RUN apk add --no-cache ca-certificates && update-ca-certificates

WORKDIR /app

# packages files
COPY package*.json ./

# SIMPLE: lock ho ya na ho — install chale
RUN npm install --omit=dev

# app code
COPY . .

EXPOSE 8000
CMD ["npm","start"]

