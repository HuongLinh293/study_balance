FROM node:24-alpine AS build
WORKDIR /app
COPY . .
RUN npm ci && npm run build -w @studybalance/frontend
FROM nginx:stable-alpine
COPY --from=build /app/frontend/dist /usr/share/nginx/html
COPY infrastructure/nginx/frontend.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
