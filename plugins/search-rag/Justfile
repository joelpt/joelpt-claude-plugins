default:
    @just --list

test:
    uv run pytest tst/ -v

lint:
    uv run ruff check .

fmt:
    uv run ruff format .

sync:
    uv run python -m lance_rag.sync

query Q:
    uv run python -m lance_rag.query --question "{{Q}}" --top-k 5

status:
    uv run python -m lance_rag.status

smoke: test sync
    @echo "smoke complete"
