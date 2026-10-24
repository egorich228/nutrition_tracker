DROP TABLE IF EXISTS diary_entries CASCADE;
DROP TABLE IF EXISTS products CASCADE;
DROP TABLE IF EXISTS user_norms CASCADE;
DROP TABLE IF EXISTS users CASCADE;

CREATE TABLE users (
    id            SERIAL PRIMARY KEY,
    username      VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    is_admin      BOOLEAN NOT NULL DEFAULT FALSE,
    gender        VARCHAR(10),
    age           INTEGER,
    weight        NUMERIC(5,2),
    height        NUMERIC(5,2),
    activity      VARCHAR(10),
    goal          VARCHAR(10),
    created_at    TIMESTAMP DEFAULT NOW()
);

CREATE TABLE user_norms (
    user_id       INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    calories      NUMERIC(7,2) NOT NULL,
    proteins      NUMERIC(6,2) NOT NULL,
    fats          NUMERIC(6,2) NOT NULL,
    carbs         NUMERIC(6,2) NOT NULL,
    updated_at    TIMESTAMP DEFAULT NOW()
);

CREATE TABLE products (
    id            SERIAL PRIMARY KEY,
    name          VARCHAR(500) UNIQUE NOT NULL,
    calories      NUMERIC(7,2) NOT NULL,
    proteins      NUMERIC(6,2) NOT NULL,
    fats          NUMERIC(6,2) NOT NULL,
    carbs         NUMERIC(6,2) NOT NULL
);

CREATE INDEX idx_products_name ON products (name);

CREATE TABLE diary_entries (
    id            SERIAL PRIMARY KEY,
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    product_id    INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    entry_date    DATE NOT NULL,
    meal_type     VARCHAR(15) NOT NULL,
    portion_grams NUMERIC(7,2) NOT NULL,
    created_at    TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_diary_user_date ON diary_entries(user_id, entry_date);