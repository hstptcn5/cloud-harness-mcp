# Separate execution image; does not modify the CloudHarness API/Runner/executor.
FROM node:24.11.0-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && git config --system --add safe.directory /work
COPY scripts/local-ci-worker.mjs /opt/local-ci/worker.mjs
USER node
WORKDIR /work
ENTRYPOINT ["node", "/opt/local-ci/worker.mjs"]
CMD ["node-basic"]
