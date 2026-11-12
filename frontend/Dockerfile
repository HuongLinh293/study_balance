FROM node:24-alpine AS build
WORKDIR /app
COPY . .
# npm cache survives between builds (BuildKit cache mount) and downloads retry,
# so a flaky connection resumes instead of starting over.
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund --prefer-offline --fetch-retries=5 --fetch-retry-mintimeout=20000 --fetch-retry-maxtimeout=120000 && npm run build -w @studybalance/frontend
FROM nginx:stable-alpine
COPY --from=build /app/frontend/dist /usr/share/nginx/html
COPY infrastructure/nginx/frontend.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
