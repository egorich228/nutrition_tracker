const API = 'http://localhost:3000/api';

let profile = null;
let norm = null;
let currentDate = today();
let entries = [];
let foundProducts = [];
let adminProducts = [];
let selectedProduct = null;
let editingEntryId = null;
let editingProductId = null;
let chart = null;
let statsDays = 1;

const MEALS = { breakfast: 'Завтрак', lunch: 'Обед', dinner: 'Ужин', snack: 'Перекус' };
const GENDERS = { male: 'Мужской', female: 'Женский' };
const ACTIVITIES = { low: 'Низкая', medium: 'Средняя', high: 'Высокая' };
const GOALS = { lose: 'Похудение', maintain: 'Поддержание', gain: 'Набор массы' };

async function api(url, method = 'GET', body) {
    const token = localStorage.getItem('token');
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;

    let res;
    try {
        res = await fetch(API + url, { method, headers, body: body && JSON.stringify(body) });
    } catch {
        throw new Error('Нет соединения с сервером');
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        if (res.status === 401) localStorage.removeItem('token');
        throw new Error(data.error || 'Ошибка ' + res.status);
    }
    return data;
}

function today() {
    return new Date().toLocaleDateString('en-CA');
}

function shiftDate(date, days) {
    const d = new Date(date + 'T00:00:00');
    d.setDate(d.getDate() + days);
    return d.toLocaleDateString('en-CA');
}

function formatDate(date) {
    return new Date(date + 'T00:00:00').toLocaleDateString('ru-RU', {
        day: 'numeric', month: 'long', year: 'numeric',
    });
}

function round1(n) {
    return Math.round(n * 10) / 10;
}

function portion(per100, grams) {
    return round1((per100 * grams) / 100);
}

function macrosText(proteins, fats, carbs) {
    return `Б: ${proteins} г | Ж: ${fats} г | У: ${carbs} г`;
}

function esc(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function setText(id, text) {
    document.getElementById(id).textContent = text;
}

function toast(message, type = '') {
    const old = document.querySelector('.toast');
    if (old) old.remove();

    const div = document.createElement('div');
    div.className = 'toast ' + type;
    div.textContent = message;
    document.body.appendChild(div);
    setTimeout(() => div.remove(), 3000);
}

function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
    window.scrollTo({ top: 0, behavior: 'smooth' });

    document.getElementById('main-nav').hidden = !document.querySelector(`[data-screen="${id}"]`);
    document.querySelectorAll('.nav-link').forEach(link => {
        link.classList.toggle('active', link.dataset.screen === id);
    });

    if (id === 'screen-diary') loadDiary();
    if (id === 'screen-search') {
        document.getElementById('search-input').value = '';
        loadProducts();
    }
    if (id === 'screen-stats') loadStats(statsDays);
    if (id === 'screen-profile') showProfile();
    if (id === 'screen-history') loadHistory();
    if (id === 'screen-admin') {
        clearAdminForm();
        loadAdminProducts();
    }
}

function openDiary(date) {
    currentDate = date || today();
    showScreen('screen-diary');
}

async function login() {
    setText('login-error', '');
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;

    if (!username || !password) {
        setText('login-error', 'Заполните все поля');
        return;
    }

    try {
        const data = await api('/login', 'POST', { username, password });
        localStorage.setItem('token', data.token);
        document.getElementById('login-password').value = '';
        await startApp();
    } catch (e) {
        setText('login-error', e.message);
    }
}

async function register() {
    setText('register-error', '');
    const username = document.getElementById('reg-username').value.trim();
    const password = document.getElementById('reg-password').value;
    const confirm = document.getElementById('reg-confirm').value;

    if (!username || !password || !confirm) {
        setText('register-error', 'Заполните все поля');
    } else if (username.length < 3) {
        setText('register-error', 'Логин должен быть не менее 3 символов');
    } else if (password.length < 6) {
        setText('register-error', 'Пароль должен быть не менее 6 символов');
    } else if (password !== confirm) {
        setText('register-error', 'Пароли не совпадают');
    } else {
        try {
            const data = await api('/register', 'POST', { username, password });
            localStorage.setItem('token', data.token);
            document.getElementById('reg-username').value = '';
            document.getElementById('reg-password').value = '';
            document.getElementById('reg-confirm').value = '';
            await startApp();
            toast('Аккаунт создан! Заполните профиль', 'success');
        } catch (e) {
            setText('register-error', e.message);
        }
    }
}

function logout() {
    localStorage.removeItem('token');
    profile = null;
    norm = null;
    document.getElementById('login-username').value = '';
    document.getElementById('login-password').value = '';
    showScreen('screen-login');
    toast('Вы вышли из аккаунта');
}

async function startApp() {
    await loadProfile();
    currentDate = today();

    document.querySelectorAll('.user-nav').forEach(b => b.hidden = profile.isAdmin);
    document.querySelector('.admin-nav').hidden = !profile.isAdmin;

    if (profile.isAdmin) {
        showScreen('screen-admin');
    } else if (norm) {
        showScreen('screen-diary');
    } else {
        showScreen('screen-profile-setup');
    }
}

async function loadProfile() {
    profile = await api('/profile');
    norm = profile.norm;
}

function showProfile() {
    const p = profile;
    document.getElementById('profile-info').innerHTML = `
        <div>Имя: ${esc(p.username)}</div>
        <div>Пол: ${GENDERS[p.gender] || '—'}</div>
        <div>Вес: ${p.weight || '—'} кг</div>
        <div>Рост: ${p.height || '—'} см</div>
        <div>Возраст: ${p.age || '—'} лет</div>
        <div>Активность: ${ACTIVITIES[p.activity] || '—'}</div>
        <div>Цель: ${GOALS[p.goal] || '—'}</div>
    `;
    if (norm) {
        setText('norm-kcal', Math.round(norm.calories) + ' ккал');
        setText('norm-macros', macrosText(Math.round(norm.proteins), Math.round(norm.fats), Math.round(norm.carbs)));
    }
}

function setRadio(name, value) {
    const radio = document.querySelector(`input[name="${name}"][value="${value}"]`);
    if (radio) radio.checked = true;
}

function editProfile() {
    document.getElementById('setup-age').value = profile.age || '';
    document.getElementById('setup-weight').value = profile.weight || '';
    document.getElementById('setup-height').value = profile.height || '';
    setRadio('gender', profile.gender);
    setRadio('activity', profile.activity);
    setRadio('goal', profile.goal);
    showScreen('screen-profile-setup');
}

async function saveProfile() {
    setText('setup-error', '');
    const gender = document.querySelector('input[name="gender"]:checked').value;
    const activity = document.querySelector('input[name="activity"]:checked').value;
    const goal = document.querySelector('input[name="goal"]:checked').value;
    const age = parseInt(document.getElementById('setup-age').value);
    const weight = parseFloat(document.getElementById('setup-weight').value);
    const height = parseFloat(document.getElementById('setup-height').value);

    if (!(age >= 10 && age <= 100)) {
        setText('setup-error', 'Возраст от 10 до 100 лет');
    } else if (!(weight >= 20 && weight <= 400)) {
        setText('setup-error', 'Вес от 20 до 400 кг');
    } else if (!(height >= 80 && height <= 250)) {
        setText('setup-error', 'Рост от 80 до 250 см');
    } else {
        try {
            await api('/profile', 'POST', { gender, age, weight, height, activity, goal });
            await loadProfile();
            toast('Норма рассчитана!', 'success');
            showScreen('screen-diary');
        } catch (e) {
            setText('setup-error', e.message);
        }
    }
}

async function loadDiary() {
    try {
        entries = await api('/diary?date=' + currentDate);
    } catch (e) {
        toast(e.message, 'error');
        return;
    }

    setText('diary-date', formatDate(currentDate));
    showRemaining();
    showMeals();
}

function showRemaining() {
    if (!norm) {
        setText('remaining-title', 'Норма не рассчитана');
        setText('remaining-value', 'Заполните профиль');
        setText('remaining-macros', '');
        return;
    }

    const eaten = { calories: 0, proteins: 0, fats: 0, carbs: 0 };
    for (const e of entries) {
        for (const key in eaten) eaten[key] += portion(e[key], e.portionGrams);
    }

    setText('remaining-title', 'Остаток на сегодня');
    setText('remaining-value', `${Math.round(norm.calories - eaten.calories)} / ${Math.round(norm.calories)} ккал`);
    setText('remaining-macros', macrosText(
        Math.round(norm.proteins - eaten.proteins),
        Math.round(norm.fats - eaten.fats),
        Math.round(norm.carbs - eaten.carbs)
    ));
}

function showMeals() {
    let html = '';
    for (const type in MEALS) {
        let items = '';
        for (const e of entries.filter(e => e.mealType === type)) {
            items += `
                <div class="product-item" onclick="editEntry(${e.id})">
                    <span class="product-name">${esc(e.name)}<br><small style="color:#9ca3af;">${e.portionGrams} г</small></span>
                    <span class="product-kcal">${Math.round(portion(e.calories, e.portionGrams))} ккал</span>
                </div>`;
        }
        if (!items) {
            items = '<div class="product-item empty"><span class="product-kcal">Нет записей</span></div>';
        }
        html += `
            <div class="card">
                <div class="card-title">${MEALS[type]}</div>
                <div class="product-list">${items}</div>
            </div>`;
    }
    document.getElementById('meals-grid').innerHTML = html;
}

async function loadProducts() {
    const q = document.getElementById('search-input').value;
    try {
        foundProducts = await api('/products?q=' + encodeURIComponent(q));
    } catch (e) {
        toast(e.message, 'error');
        return;
    }

    const list = document.getElementById('search-results');
    if (!foundProducts.length) {
        list.innerHTML = '<div style="padding:16px;color:#6b7280;text-align:center;">Ничего не найдено</div>';
        return;
    }
    list.innerHTML = foundProducts.map((p, i) => `
        <div class="product-item" onclick="openPortion(foundProducts[${i}])">
            <span class="product-name">${esc(p.name)}</span>
            <span class="product-kcal">${Math.round(p.calories)} ккал / 100 г</span>
        </div>
    `).join('');
}

function openPortion(product, entry) {
    selectedProduct = product;
    editingEntryId = entry ? entry.id : null;

    setText('portion-title', product.name);
    setText('portion-subtitle', entry ? 'Редактирование записи' : 'Укажите количество и приём пищи');
    document.getElementById('portion-grams').value = entry ? entry.portionGrams : 100;
    setRadio('meal', entry ? entry.mealType : 'breakfast');
    document.getElementById('delete-entry-btn').hidden = !entry;

    updatePreview();
    showScreen('screen-portion');
}

function editEntry(id) {
    const entry = entries.find(e => e.id === id);
    openPortion(entry, entry);
}

function closePortion() {
    showScreen(editingEntryId ? 'screen-diary' : 'screen-search');
}

function updatePreview() {
    const grams = parseFloat(document.getElementById('portion-grams').value) || 0;
    const p = selectedProduct;
    setText('preview-kcal', portion(p.calories, grams) + ' ккал');
    setText('preview-macros', macrosText(portion(p.proteins, grams), portion(p.fats, grams), portion(p.carbs, grams)));
}

async function saveEntry() {
    const portionGrams = parseFloat(document.getElementById('portion-grams').value);
    const mealType = document.querySelector('input[name="meal"]:checked').value;

    if (!(portionGrams > 0 && portionGrams <= 5000)) {
        toast('Порция должна быть от 1 до 5000 г', 'error');
        return;
    }

    try {
        if (editingEntryId) {
            await api('/diary/' + editingEntryId, 'PUT', { mealType, portionGrams });
            toast('Запись обновлена', 'success');
        } else {
            await api('/diary', 'POST', {
                productId: selectedProduct.id,
                date: currentDate,
                mealType,
                portionGrams,
            });
            toast('Продукт добавлен', 'success');
        }
        showScreen('screen-diary');
    } catch (e) {
        toast(e.message, 'error');
    }
}

async function deleteEntry() {
    if (!confirm('Удалить запись?')) return;

    try {
        await api('/diary/' + editingEntryId, 'DELETE');
        toast('Запись удалена', 'success');
        showScreen('screen-diary');
    } catch (e) {
        toast(e.message, 'error');
    }
}

async function loadStats(days) {
    statsDays = days;
    document.querySelectorAll('.period-btn').forEach(btn => {
        btn.classList.toggle('active', Number(btn.dataset.days) === days);
    });

    const to = today();
    const from = shiftDate(to, -(days - 1));
    let rows;
    try {
        rows = await api(`/diary/days?from=${from}&to=${to}`);
    } catch (e) {
        toast(e.message, 'error');
        return;
    }

    const avg = { calories: 0, proteins: 0, fats: 0, carbs: 0 };
    for (const row of rows) {
        for (const key in avg) avg[key] += row[key] / days;
    }
    setText('avg-kcal', Math.round(avg.calories) + ' ккал');
    setText('avg-macros', macrosText(Math.round(avg.proteins), Math.round(avg.fats), Math.round(avg.carbs)));

    let feedback = 'Недостаточно данных для анализа';
    if (norm) {
        const percent = ((avg.calories - norm.calories) / norm.calories) * 100;
        if (percent > 10) {
            feedback = `Перебор калорий на ${Math.round(percent)}%. Рекомендуется снизить калорийность.`;
        } else if (percent < -10) {
            feedback = `Недобор калорий на ${Math.round(-percent)}%. Рекомендуется увеличить калорийность.`;
        } else {
            feedback = 'Ваш рацион соответствует норме. Так держать!';
        }
    }
    setText('feedback', feedback);

    drawChart(rows);
}

function drawChart(rows) {
    const canvas = document.getElementById('stats-chart');
    if (chart) chart.destroy();
    chart = null;

    if (!rows.length) {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.font = '16px Segoe UI';
        ctx.fillStyle = '#9ca3af';
        ctx.textAlign = 'center';
        ctx.fillText('Нет данных за период', canvas.width / 2, canvas.height / 2);
        return;
    }

    const datasets = [{
        label: 'Калории',
        data: rows.map(r => r.calories),
        borderColor: '#6c63ff',
        backgroundColor: 'rgba(108, 99, 255, 0.1)',
        tension: 0.3,
        fill: true,
        pointBackgroundColor: '#6c63ff',
        pointRadius: 4,
    }];
    if (norm) {
        datasets.push({
            label: 'Норма',
            data: rows.map(() => norm.calories),
            borderColor: '#f59e0b',
            borderDash: [6, 6],
            pointRadius: 0,
        });
    }

    chart = new Chart(canvas, {
        type: 'line',
        data: {
            labels: rows.map(r => r.date.slice(8) + '.' + r.date.slice(5, 7)),
            datasets,
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'top' },
                tooltip: {
                    callbacks: {
                        label: (ctx) => `${ctx.dataset.label}: ${Math.round(ctx.parsed.y)} ккал`,
                    },
                },
            },
            scales: {
                y: { beginAtZero: true, title: { display: true, text: 'ккал' } },
                x: { title: { display: true, text: 'Дата' } },
            },
        },
    });
}

async function loadHistory() {
    const dateInput = document.getElementById('history-date');
    if (!dateInput.value) dateInput.value = today();

    const to = dateInput.value;
    const from = shiftDate(to, -30);
    const list = document.getElementById('history-list');

    try {
        const days = (await api(`/diary/days?from=${from}&to=${to}`)).reverse();
        if (!days.length) {
            list.innerHTML = '<div style="padding:16px;color:#6b7280;text-align:center;">Нет записей за период</div>';
            return;
        }
        list.innerHTML = days.map(d => `
            <div class="product-item" onclick="openDiary('${d.date}')">
                <span class="product-name">${formatDate(d.date)}</span>
                <span class="product-kcal">${Math.round(d.calories)} ккал</span>
            </div>
        `).join('');
    } catch (e) {
        toast(e.message, 'error');
    }
}

async function loadAdminProducts() {
    const q = document.getElementById('admin-search').value;
    try {
        adminProducts = await api('/admin/products?q=' + encodeURIComponent(q));
    } catch (e) {
        toast(e.message, 'error');
        return;
    }

    const list = document.getElementById('admin-list');
    if (!adminProducts.length) {
        list.innerHTML = '<div style="padding:16px;color:#6b7280;text-align:center;">Продукты не найдены</div>';
        return;
    }
    list.innerHTML = adminProducts.map((p, i) => `
        <div class="product-item" style="cursor:default;">
            <div style="flex:1;">
                <div class="product-name">${esc(p.name)}</div>
                <div class="product-kcal">${p.calories} ккал | Б: ${p.proteins} | Ж: ${p.fats} | У: ${p.carbs}</div>
            </div>
            <div class="flex gap-12" style="flex-shrink:0;">
                <button class="btn btn-secondary" style="padding:8px 16px; font-size:14px;" onclick="editProduct(${i})">✏️</button>
                <button class="btn btn-danger" style="padding:8px 16px; font-size:14px;" onclick="deleteProduct(${p.id})">🗑</button>
            </div>
        </div>
    `).join('');
}

function editProduct(index) {
    const p = adminProducts[index];
    editingProductId = p.id;
    document.getElementById('admin-name').value = p.name;
    document.getElementById('admin-calories').value = p.calories;
    document.getElementById('admin-proteins').value = p.proteins;
    document.getElementById('admin-fats').value = p.fats;
    document.getElementById('admin-carbs').value = p.carbs;
    setText('admin-form-title', 'Редактировать продукт');
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function clearAdminForm() {
    editingProductId = null;
    for (const field of ['name', 'calories', 'proteins', 'fats', 'carbs']) {
        document.getElementById('admin-' + field).value = '';
    }
    setText('admin-error', '');
    setText('admin-form-title', 'Добавить новый продукт');
}

async function saveAdminProduct() {
    const product = {
        name: document.getElementById('admin-name').value.trim(),
        calories: parseFloat(document.getElementById('admin-calories').value) || 0,
        proteins: parseFloat(document.getElementById('admin-proteins').value) || 0,
        fats: parseFloat(document.getElementById('admin-fats').value) || 0,
        carbs: parseFloat(document.getElementById('admin-carbs').value) || 0,
    };

    if (product.name.length < 2) {
        setText('admin-error', 'Название минимум 2 символа');
        return;
    }

    try {
        if (editingProductId) {
            await api('/admin/products/' + editingProductId, 'PUT', product);
            toast('Продукт обновлён', 'success');
        } else {
            await api('/admin/products', 'POST', product);
            toast('Продукт добавлен', 'success');
        }
        clearAdminForm();
        loadAdminProducts();
    } catch (e) {
        setText('admin-error', e.message);
    }
}

async function deleteProduct(id) {
    const ok = confirm(
        'Удалить продукт?\n\n' +
        'Внимание: все записи в дневниках пользователей, ' +
        'связанные с этим продуктом, тоже будут удалены.'
    );
    if (!ok) return;

    try {
        await api('/admin/products/' + id, 'DELETE');
        toast('Продукт удалён', 'success');
        loadAdminProducts();
    } catch (e) {
        toast(e.message, 'error');
    }
}

function onTyping(inputId, action) {
    let timer;
    document.getElementById(inputId).addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(action, 300);
    });
}
onTyping('search-input', loadProducts);
onTyping('admin-search', loadAdminProducts);

for (const id of ['login-username', 'login-password']) {
    document.getElementById(id).addEventListener('keydown', (e) => {
        if (e.key === 'Enter') login();
    });
}

if (localStorage.getItem('token')) {
    startApp().catch(() => {
        localStorage.removeItem('token');
        showScreen('screen-login');
    });
}