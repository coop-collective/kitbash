FROM oven/bun:1.4.3-debian
WORKDIR /app
COPY --chown=root:root src/ ./src/
RUN mkdir -p /app-tmp && chown 1000:1000 /app-tmp && chmod 0700 /app-tmp
USER 1000:1000
ENV NODE_ENV=production PORT=8080
EXPOSE 8080
CMD ["bun", "src/server.ts"]
