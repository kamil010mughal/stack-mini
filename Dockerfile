FROM node:20-alpine
WORKDIR /app

# packages files
COPY package*.json ./

# SIMPLE: lock ho ya na ho — install chale
RUN npm install --omit=dev

# app code
COPY . .

EXPOSE 8000
CMD ["npm","start"]
