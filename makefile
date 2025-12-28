mig:
	uv run python manage.py makemigrations
	uv run python manage.py migrate

msg:
	uv run python manage.py makemessages -l en -l uz

icomp:
	uv run ./manage.py compilemessages -i .venv