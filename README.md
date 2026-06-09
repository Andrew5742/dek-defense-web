# DEK Defense Hybrid v1

Строга напівлокальна система для секретаря ДЕК:

- Admin: імпорт списку студентів, редагування, черга, протокол.
- Student: пошук себе у внутрішньому списку, запис, обовʼязкове завантаження презентації.
- Agent: локальний демо-модуль для презентацій. У фінальній версії буде окремий Local Defense Agent.
- Display: екран черги для аудиторії.

## Локальний запуск без GitHub Pages і без БД

### Windows PowerShell

```powershell
cd C:\Users\reonf\Desktop\dek-defense-hybrid-v1
npm install
npm run dev
```

### macOS Terminal

```bash
cd ~/Desktop/dek-defense-hybrid-v1
npm install
npm run dev
```

Після запуску відкрий адресу з терміналу, зазвичай:

```text
http://127.0.0.1:5173/
```

## Як тестувати

1. В адмінці створи сесію захисту.
2. Перейди в `Імпорт`.
3. Завантаж DOCX зі структурою: № / ПІБ / Тема / Керівник.
4. На екрані Import Review відредагуй тему, керівника або ПІБ.
5. Натисни `Підтвердити імпорт`.
6. Перейди у вкладку `Студенти` або `Черга`.
7. Перейди у верхньому меню `Студенти` — це студентська сторінка.
8. Знайди студента, обери його, завантаж презентацію.
9. В адмінці побачиш статус презентації.
10. Натисни `Відкрити презу` в черзі.
11. Перейди в `Agent`, виконай команду відкриття.
12. Протокол формується у вкладці `Протокол`.

## Важливе

Це локальна веб-версія для перевірки логіки і UI. Презентації зараз зберігаються у браузерному IndexedDB, а не в системній папці.

Фінальна архітектура:

```text
GitHub Pages Web App
  Admin / Student / Display
Firebase Firestore
  сесії, студенти, черга, статуси, event log, команди
Local Defense Agent
  локальне приймання презентацій, системна папка, конвертація в PDF, fullscreen показ
```

## Чому поки DOCX, не PDF

DOCX має чисту таблицю і краще підходить для автоматичного імпорту. PDF часто ламає переноси рядків. PDF імпорт буде окремим модулем через pdf.js або backend/agent parser.

## Підготовка до Firebase

У проєкті вже є `src/services/firebaseAdapter.ts` і `firebase/firestore.rules`. Поки використовується LocalRepository.

Для підключення Firebase пізніше:

1. Створити Firebase project.
2. Увімкнути Firestore.
3. Додати Web App у Firebase Console.
4. Створити `.env.local` з ключами.
5. Замінити LocalRepository на FirebaseRepository.

Приклад `.env.local`:

```env
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
```
