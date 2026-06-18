# DEK Defense Hybrid

Напівлокальна система організації захистів дипломних робіт.

## Архітектура

- `DEK Defense Station` запускає локальну SQLite-базу, HTTP/WebSocket API, студентський запис, Display і виконання команд.
- Адмінка комісії працює через локальну адресу Agent, наприклад `http://192.168.0.10:3050`.
- Презентації та відео зберігаються лише локально на ПК захисту.
- Firebase використовується лише для статичного Hosting. Firestore/Auth/Storage у runtime не використовуються.
- Якщо Agent вимкнений, локальна база та команди недоступні.

## Запуск Agent

Готові Windows-артефакти після збірки:

```text
dek-defense-electron-agent/dist/DEK Defense Station Setup 0.1.3.exe
dek-defense-electron-agent/dist/win-unpacked/DEK Defense Station.exe
```

Розробницький запуск:

```powershell
npm install
npm run build
cd dek-defense-electron-agent
npm install
npm run dev
```

## Перевірки

```powershell
npm run typecheck
npm run build
cd dek-defense-electron-agent
npm run test:local
npm run build:unpacked
```

`test:local` запускає ізольовану тимчасову базу й перевіряє 64 студентів, паралельні записи, мобільні сторінки, дедуплікацію, повтори та всі типи команд. Робоча база користувача під час тесту не змінюється.

## Firebase Hosting

Скопіюйте `.env.production.example` у локальний `.env.production` і задайте публічний URL. Реальний `.env.production` не комітиться.

```powershell
npm run deploy:firebase
```

Команда збирає лише статичний сайт і виконує `firebase deploy --only hosting`.
