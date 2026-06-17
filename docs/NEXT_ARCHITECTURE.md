# Наступний етап архітектури

## Web App на GitHub Pages

Routes:
- /admin
- /student?session=...
- /display?session=...

## Firebase

Колекції:
- dek_sessions
- dek_groups
- dek_students
- dek_registrations
- dek_queue
- dek_presentations
- station_commands
- dek_events
- dek_protocols
- dek_stations

## Local Defense Agent

Окрема desktop/Node програма:
- авторизація station token;
- вибір активної сесії;
- локальний HTTP upload endpoint;
- папка сесії на диску;
- збереження версій презентацій;
- LibreOffice conversion to PDF;
- fullscreen PDF viewer;
- слухає station_commands у Firestore;
- виконує open_presentation саме на пристрої доповідача.

## Обовʼязково перед реальною експлуатацією

- Preflight check;
- Recovery Center;
- atomic backups;
- event log;
- retry queue;
- нормальні Firebase rules;
- Auth для секретаря;
- окремі student tokens;
- заборона небезпечних файлів;
- Local Agent з реальною файловою системою.
