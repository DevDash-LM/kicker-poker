FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Accounts are optional; pass these build args to bake Supabase into the client.
# (The anon key is public by design and protected by Row Level Security.)
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY src/game ./src/game
COPY --from=build /app/dist ./dist
EXPOSE 8787
CMD ["node", "server/index.js"]
