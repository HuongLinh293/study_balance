FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
COPY frontend/package.json frontend/package.json
COPY services/user-service/package.json services/user-service/package.json
COPY services/task-service/package.json services/task-service/package.json
COPY services/planning-service/package.json services/planning-service/package.json
COPY services/notification-service/package.json services/notification-service/package.json
COPY services/analytics-service/package.json services/analytics-service/package.json
COPY packages/event-contracts/package.json packages/event-contracts/package.json
COPY packages/service-kit/package.json packages/service-kit/package.json
# npm cache survives between builds (BuildKit cache mount) and downloads retry,
# so a flaky connection resumes instead of starting over.
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund --prefer-offline --fetch-retries=5 --fetch-retry-mintimeout=20000 --fetch-retry-maxtimeout=120000
COPY tsconfig.base.json ./
COPY packages packages
COPY services/user-service services/user-service
RUN npm run build:packages && npm run build -w @studybalance/user-service
RUN npm prune --omit=dev
# Workspace packages are symlinks; replace them with their built output for the runtime image.
RUN rm -rf node_modules/@studybalance && for pkg in event-contracts service-kit; do \
      mkdir -p node_modules/@studybalance/$pkg && \
      cp -r packages/$pkg/package.json packages/$pkg/dist node_modules/@studybalance/$pkg/; \
    done
FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/services/user-service/package.json ./package.json
COPY --from=build /app/services/user-service/dist ./dist
USER node
EXPOSE 3001
CMD ["node", "dist/index.js"]
