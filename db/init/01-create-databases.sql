-- Auto-creates one database per service on first Postgres startup.
-- Runs only when the data directory is empty (docker-entrypoint-initdb.d).
CREATE DATABASE user_service_database;
CREATE DATABASE admin_service_database;
CREATE DATABASE booking_service_database;
CREATE DATABASE payment_service_database;
CREATE DATABASE inventory_service_database;
