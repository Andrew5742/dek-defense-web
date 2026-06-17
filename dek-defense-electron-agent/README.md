# DEK Defense Electron Agent

Це окрема Electron-апка для ПК захисту. Вона не замінює GitHub Pages веб-адмінку, а доповнює її:

- приймає презентації локально на ПК захисту;
- зберігає файли у локальну папку;
- конвертує PPTX/PPT/ODP у PDF через LibreOffice, якщо він встановлений;
- відкриває PDF fullscreen у режимі презентації: один клік/Space/ArrowRight = наступний слайд;
- слухає Firebase-команди `start_defense_display`, `open_presentation`, `open_zoom`;
- публікує `localUploadUrl` і heartbeat у Firestore.

## Швидкий запуск

1. Скопіюй `.env.example` у `.env` і заповни Firebase config.
2. Встанови залежності:

```bash
npm install
npm run dev
```

Windows:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\setup-win.ps1
```

macOS:

```bash
chmod +x setup-mac.sh
./setup-mac.sh
```

## Firestore колекції

Agent очікує такі колекції:

- `dek_stations`
- `station_commands`
- `dek_presentations`
- `dek_events`

Команда відкриття презентації:

```json
{
  "type": "open_presentation",
  "status": "pending",
  "sessionId": "...",
  "studentId": "...",
  "targetStationId": "defense-station-1"
}
```

Команда запуску Display:

```json
{
  "type": "start_defense_display",
  "status": "pending",
  "sessionId": "...",
  "targetStationId": "defense-station-1"
}
```

Команда Zoom:

```json
{
  "type": "open_zoom",
  "status": "pending",
  "sessionId": "...",
  "targetStationId": "defense-station-1",
  "zoomUrl": "zoommtg://... або https://..."
}
```
