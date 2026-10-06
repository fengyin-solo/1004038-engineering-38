.PHONY: install frontend build validate

install:
	cd frontend && npm install

frontend:
	cd frontend && npm run dev

build:
	cd frontend && npm run build

validate:
	cd frontend && npm run validate:seed
