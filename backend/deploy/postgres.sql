-- Rode uma vez como superusuário:  sudo -u postgres psql -f postgres.sql
-- Troque a senha antes. As tabelas a API cria sozinha quando sobe.
CREATE ROLE cdg LOGIN PASSWORD 'TROQUE_A_SENHA';
CREATE DATABASE calldosgames OWNER cdg ENCODING 'UTF8' TEMPLATE template0;
