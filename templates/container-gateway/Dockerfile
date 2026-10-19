FROM node:22-bookworm-slim
WORKDIR /app
COPY --chown=root:root container/ ./
# Prepare only the write location. Application files need no runtime writes.
RUN mkdir -p /app-tmp && chown node:node /app-tmp && chmod 0700 /app-tmp
USER node
ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "server.mjs"]
