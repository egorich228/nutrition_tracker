require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { Pool, types } = require('pg');

types.setTypeParser(1700, parseFloat);
types.setTypeParser(1082, (value) => value);

const db = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
});

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'frontend')));

function safe(handler) {
    return async (req, res, next) => {
        try {
            await handler(req, res, next);
        } catch (e) {
            console.error(req.method, req.originalUrl, e);
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    };
}

function makeToken(userId) {
    return jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: '30d' });
}

function isDate(s) {
    return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function todayString() {
    return new Date().toLocaleDateString('en-CA');
}

function round2(n) {
    return Math.round(n * 100) / 100;
}

function checkAuth(req, res, next) {
    const header = req.headers.authorization || '';
    if (!header.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Требуется авторизация' });
    }
    try {
        const data = jwt.verify(header.slice(7), process.env.JWT_SECRET);
        req.userId = data.id;
        next();
    } catch {
        res.status(401).json({ error: 'Неверный или истёкший токен' });
    }
}

const checkAdmin = safe(async (req, res, next) => {
    const result = await db.query('SELECT is_admin FROM users WHERE id = $1', [req.userId]);
    if (!result.rows.length || !result.rows[0].is_admin) {
        return res.status(403).json({ error: 'Доступ только для администратора' });
    }
    next();
});

function calculateNorm({ gender, age, weight, height, activity, goal }) {
    let bmr = 10 * weight + 6.25 * height - 5 * age;
    bmr += gender === 'male' ? 5 : -161;

    const activityK = { low: 1.2, medium: 1.55, high: 1.725 }[activity];
    const goalK = { lose: 0.8, maintain: 1, gain: 1.15 }[goal];
    const calories = bmr * activityK * goalK;

    return {
        calories: round2(calories),
        proteins: round2((calories * 0.30) / 4),
        fats: round2((calories * 0.30) / 9),
        carbs: round2((calories * 0.40) / 4),
    };
}

app.post('/api/register', safe(async (req, res) => {
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');

    if (username.length < 3 || username.length > 50 || password.length < 6) {
        return res.status(400).json({ error: 'Логин от 3 до 50 символов, пароль от 6 символов' });
    }

    const exists = await db.query('SELECT id FROM users WHERE username = $1', [username]);
    if (exists.rows.length) {
        return res.status(409).json({ error: 'Логин уже занят' });
    }

    const hash = await bcrypt.hash(password, 10);
    const result = await db.query(
        'INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id',
        [username, hash]
    );

    res.status(201).json({ token: makeToken(result.rows[0].id) });
}));

app.post('/api/login', safe(async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: 'Введите логин и пароль' });
    }

    const result = await db.query('SELECT * FROM users WHERE username = $1', [username]);
    const user = result.rows[0];

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
        return res.status(401).json({ error: 'Неверное имя или пароль' });
    }

    res.json({ token: makeToken(user.id) });
}));

app.get('/api/profile', checkAuth, safe(async (req, res) => {
    const user = await db.query(
        `SELECT username, is_admin AS "isAdmin", gender, age, weight, height, activity, goal
         FROM users WHERE id = $1`,
        [req.userId]
    );
    if (!user.rows.length) {
        return res.status(404).json({ error: 'Пользователь не найден' });
    }

    const norm = await db.query(
        'SELECT calories, proteins, fats, carbs FROM user_norms WHERE user_id = $1',
        [req.userId]
    );

    res.json({ ...user.rows[0], norm: norm.rows[0] || null });
}));

app.post('/api/profile', checkAuth, safe(async (req, res) => {
    const { gender, activity, goal } = req.body;
    const age = Number(req.body.age);
    const weight = Number(req.body.weight);
    const height = Number(req.body.height);

    const ok =
        ['male', 'female'].includes(gender) &&
        ['low', 'medium', 'high'].includes(activity) &&
        ['lose', 'maintain', 'gain'].includes(goal) &&
        Number.isInteger(age) && age >= 10 && age <= 100 &&
        weight >= 20 && weight <= 400 &&
        height >= 80 && height <= 250;
    if (!ok) {
        return res.status(400).json({ error: 'Проверьте правильность полей' });
    }

    await db.query(
        `UPDATE users
         SET gender = $1, age = $2, weight = $3, height = $4, activity = $5, goal = $6
         WHERE id = $7`,
        [gender, age, weight, height, activity, goal, req.userId]
    );

    const norm = calculateNorm({ gender, age, weight, height, activity, goal });
    await db.query(
        `INSERT INTO user_norms (user_id, calories, proteins, fats, carbs)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (user_id) DO UPDATE
         SET calories = $2, proteins = $3, fats = $4, carbs = $5, updated_at = NOW()`,
        [req.userId, norm.calories, norm.proteins, norm.fats, norm.carbs]
    );

    res.json({ norm });
}));

app.get('/api/products', checkAuth, safe(async (req, res) => {
    const q = String(req.query.q || '').trim();

    const order = q ? 'CASE WHEN name ILIKE $2 THEN 0 ELSE 1 END, length(name), name' : 'name';

    const result = await db.query(
        `SELECT id, name, calories, proteins, fats, carbs
         FROM products
         WHERE name ILIKE $1 AND calories > 0
         ORDER BY ${order}
         LIMIT 50`,
        q ? [`%${q}%`, `${q}%`] : ['%']
    );
    res.json(result.rows);
}));

app.get('/api/diary', checkAuth, safe(async (req, res) => {
    const date = isDate(req.query.date) ? req.query.date : todayString();

    const result = await db.query(
        `SELECT d.id, d.meal_type AS "mealType", d.portion_grams AS "portionGrams",
                p.id AS "productId", p.name, p.calories, p.proteins, p.fats, p.carbs
         FROM diary_entries d
         JOIN products p ON p.id = d.product_id
         WHERE d.user_id = $1 AND d.entry_date = $2
         ORDER BY d.created_at`,
        [req.userId, date]
    );
    res.json(result.rows);
}));

app.get('/api/diary/days', checkAuth, safe(async (req, res) => {
    const { from, to } = req.query;
    if (!isDate(from) || !isDate(to)) {
        return res.status(400).json({ error: 'Укажите from и to в формате ГГГГ-ММ-ДД' });
    }

    const result = await db.query(
        `SELECT d.entry_date AS date,
                ROUND(SUM(p.calories * d.portion_grams / 100), 1) AS calories,
                ROUND(SUM(p.proteins * d.portion_grams / 100), 1) AS proteins,
                ROUND(SUM(p.fats     * d.portion_grams / 100), 1) AS fats,
                ROUND(SUM(p.carbs    * d.portion_grams / 100), 1) AS carbs
         FROM diary_entries d
         JOIN products p ON p.id = d.product_id
         WHERE d.user_id = $1 AND d.entry_date BETWEEN $2 AND $3
         GROUP BY d.entry_date
         ORDER BY d.entry_date`,
        [req.userId, from, to]
    );
    res.json(result.rows);
}));

function checkEntry(mealType, portionGrams) {
    if (!['breakfast', 'lunch', 'dinner', 'snack'].includes(mealType)) {
        return 'Неверный приём пищи';
    }
    if (!(portionGrams > 0 && portionGrams <= 5000)) {
        return 'Некорректная порция';
    }
    return null;
}

app.post('/api/diary', checkAuth, safe(async (req, res) => {
    const { productId, date, mealType, portionGrams } = req.body;

    const error = checkEntry(mealType, portionGrams);
    if (!productId || !isDate(date) || error) {
        return res.status(400).json({ error: error || 'Все поля обязательны, дата в формате ГГГГ-ММ-ДД' });
    }

    await db.query(
        `INSERT INTO diary_entries (user_id, product_id, entry_date, meal_type, portion_grams)
         VALUES ($1, $2, $3, $4, $5)`,
        [req.userId, productId, date, mealType, portionGrams]
    );
    res.status(201).json({ success: true });
}));

app.put('/api/diary/:id', checkAuth, safe(async (req, res) => {
    const { mealType, portionGrams } = req.body;

    const error = checkEntry(mealType, portionGrams);
    if (error) {
        return res.status(400).json({ error });
    }

    const result = await db.query(
        `UPDATE diary_entries SET meal_type = $1, portion_grams = $2
         WHERE id = $3 AND user_id = $4`,
        [mealType, portionGrams, req.params.id, req.userId]
    );
    if (!result.rowCount) {
        return res.status(404).json({ error: 'Запись не найдена' });
    }
    res.json({ success: true });
}));

app.delete('/api/diary/:id', checkAuth, safe(async (req, res) => {
    const result = await db.query(
        'DELETE FROM diary_entries WHERE id = $1 AND user_id = $2',
        [req.params.id, req.userId]
    );
    if (!result.rowCount) {
        return res.status(404).json({ error: 'Запись не найдена' });
    }
    res.json({ success: true });
}));

const adminOnly = [checkAuth, checkAdmin];

function readProduct(body) {
    const product = {
        name: String(body.name || '').trim(),
        calories: Number(body.calories),
        proteins: Number(body.proteins),
        fats: Number(body.fats),
        carbs: Number(body.carbs),
    };
    const ok =
        product.name.length >= 2 && product.name.length <= 500 &&
        product.calories >= 0 && product.calories <= 10000 &&
        product.proteins >= 0 && product.proteins <= 1000 &&
        product.fats >= 0 && product.fats <= 1000 &&
        product.carbs >= 0 && product.carbs <= 1000;
    return ok ? product : null;
}

app.get('/api/admin/products', adminOnly, safe(async (req, res) => {
    const q = String(req.query.q || '').trim();

    const result = await db.query(
        `SELECT id, name, calories, proteins, fats, carbs
         FROM products
         WHERE name ILIKE $1
         ORDER BY ${q ? 'name' : 'id DESC'}
         LIMIT 200`,
        [`%${q}%`]
    );
    res.json(result.rows);
}));

app.post('/api/admin/products', adminOnly, safe(async (req, res) => {
    const p = readProduct(req.body);
    if (!p) {
        return res.status(400).json({ error: 'Проверьте правильность полей' });
    }

    try {
        await db.query(
            'INSERT INTO products (name, calories, proteins, fats, carbs) VALUES ($1, $2, $3, $4, $5)',
            [p.name, p.calories, p.proteins, p.fats, p.carbs]
        );
        res.status(201).json({ success: true });
    } catch (e) {
        if (e.code === '23505') {
            return res.status(409).json({ error: 'Такой продукт уже есть в базе' });
        }
        throw e;
    }
}));

app.put('/api/admin/products/:id', adminOnly, safe(async (req, res) => {
    const p = readProduct(req.body);
    if (!p) {
        return res.status(400).json({ error: 'Проверьте правильность полей' });
    }

    try {
        const result = await db.query(
            `UPDATE products SET name = $1, calories = $2, proteins = $3, fats = $4, carbs = $5
             WHERE id = $6`,
            [p.name, p.calories, p.proteins, p.fats, p.carbs, req.params.id]
        );
        if (!result.rowCount) {
            return res.status(404).json({ error: 'Продукт не найден' });
        }
        res.json({ success: true });
    } catch (e) {
        if (e.code === '23505') {
            return res.status(409).json({ error: 'Продукт с таким именем уже есть' });
        }
        throw e;
    }
}));

app.delete('/api/admin/products/:id', adminOnly, safe(async (req, res) => {
    const result = await db.query('DELETE FROM products WHERE id = $1', [req.params.id]);
    if (!result.rowCount) {
        return res.status(404).json({ error: 'Продукт не найден' });
    }
    res.json({ success: true });
}));

async function createAdmin() {
    try {
        const hash = await bcrypt.hash('12345', 10);
        await db.query(
            `INSERT INTO users (username, password_hash, is_admin)
             VALUES ('admin', $1, TRUE)
             ON CONFLICT (username) DO UPDATE SET is_admin = TRUE`,
            [hash]
        );
    } catch (e) {
        console.error('Не удалось создать админа:', e.message);
    }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Сервер запущен: http://localhost:${PORT}`);
    createAdmin();
});