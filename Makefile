# Cadence - local run control.
# Quickstart from a fresh clone: `make up`

COMPOSE := docker compose
API_URL := http://localhost:3000
DEV_DATABASE_URL ?= postgresql://cadence:cadence@localhost:5433/cadence

# Load .env (when present) and pass it to the processes, so overrides like
# SMS_PROVIDER=twilio take effect. Absent .env keeps the zero-config mock path.
ifneq (,$(wildcard .env))
include .env
export
endif

.DEFAULT_GOAL := help
.PHONY: help up up-build down reset logs \
	dev-db migrate dev-api dev-worker dev-admin \
	test test-integration test-admin lint typecheck build

help: ## Show available commands
	@echo "Cadence - local run control"
	@echo ""
	@grep -hE '^[a-zA-Z_-]+:.*## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'
	@echo ""
	@echo "Mock SMS is the zero-config default; no secrets needed."

# Install only when the manifests change so re-runs stay fast.
node_modules: package.json pnpm-lock.yaml
	pnpm install
	@touch node_modules

up: node_modules ## Start the full stack (Postgres, api, worker) in containers
	$(COMPOSE) up -d --wait
	@echo ""
	@echo "Stack up. Admin + API: $(API_URL)"

up-build: node_modules ## Rebuild images, then start the full stack
	$(COMPOSE) up -d --build --wait
	@echo ""
	@echo "Stack up. Admin + API: $(API_URL)"

down: ## Stop the stack; keeps the Postgres volume
	$(COMPOSE) down

reset: ## Stop the stack and drop the Postgres volume
	$(COMPOSE) down -v

logs: ## Follow logs from every service
	$(COMPOSE) logs -f

dev-db: node_modules ## Start Postgres in Docker and apply migrations (for host dev)
	$(COMPOSE) up -d --wait postgres
	DATABASE_URL=$(DEV_DATABASE_URL) pnpm db:migrate
	@echo ""
	@echo "Postgres ready at $(DEV_DATABASE_URL)"

migrate: node_modules ## Apply database migrations against the local dev Postgres
	DATABASE_URL=$(DEV_DATABASE_URL) pnpm db:migrate

dev-api: node_modules ## Run the API on the host with reload (needs 'make dev-db')
	pnpm dev:api

dev-worker: node_modules ## Run the worker on the host with reload (needs 'make dev-db')
	pnpm dev:worker

dev-admin: node_modules ## Run the admin frontend dev server with reload
	pnpm admin:dev

test: node_modules ## Run backend unit tests
	pnpm test

test-integration: node_modules ## Run backend integration tests (needs Docker)
	pnpm test:integration

test-admin: node_modules ## Run admin frontend tests
	pnpm admin:test

lint: node_modules ## Lint the whole repository
	pnpm lint

typecheck: node_modules ## Type-check the backend
	pnpm typecheck

build: node_modules ## Build the backend
	pnpm build
