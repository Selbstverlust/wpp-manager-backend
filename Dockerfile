# --- base ---
FROM node:20-alpine AS base
WORKDIR /usr/src/app

# --- deps ---
FROM base AS deps
COPY package*.json ./
RUN npm ci

# --- build ---
FROM deps AS build
COPY . .
RUN npm run build

# --- prod ---
FROM node:20-alpine AS prod
ENV NODE_ENV=production
WORKDIR /usr/src/app
COPY --from=deps /usr/src/app/node_modules ./node_modules
COPY --from=build /usr/src/app/dist ./dist
EXPOSE 4000
CMD ["node", "dist/main.js"]


