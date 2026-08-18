#!/bin/zsh
cd "$(dirname "$0")"

echo "Starting Uman Transfer CRM with local database..."
echo "Database files will be stored in: $PWD/local-database"
echo ""

npx wrangler d1 migrations apply DB --local --persist-to ./local-database

echo ""
echo "Open CRM here after the server starts:"
echo "http://localhost:8788/login"
echo ""

npx wrangler pages dev public --persist-to ./local-database
