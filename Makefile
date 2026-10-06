.PHONY: install frontend build validate

install:
	cd frontend && npm install

frontend:
	cd frontend && npm run dev

# 单独重跑监测设备样例校验（只读，不补造样例）；build 里也会先跑一遍。
validate:
	cd frontend && npm run validate:seed

build:
	cd frontend && npm run build
